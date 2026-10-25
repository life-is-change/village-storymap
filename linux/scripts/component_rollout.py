#!/usr/bin/env python3
"""Check/update only the observed Aliyun component route or two campus services."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import secrets

ROOT=Path(__file__).resolve().parents[2]
PATCH='components-20261025-v1'
BLENDER='/opt/blender-runtime/blender-3.6.23-linux-x64/blender'
OBSERVED={
 'village-platform-facade-worker-1':'sha256:0cac700ae4a12c4808a95f98958547879b8ec311053bcb1cbe8ef75520610212',
 'village-platform-facade-ml-1':'sha256:623ffb0c4ba219f41865f32a80349226cd9095051a23266dedf471a09389f6d6',
 'village-autonomous-api':'sha256:73d6c74c1a387e0763b9920bb99846707038c08bfcc90456cf15a3c3fb808df7',
 'village-autonomous-web':'sha256:35b34a15ae8b2c2cb9e12d733b9fc95312977bfec20c722cd2ba40eb7333452f',
 'village-autonomous-postgres':'sha256:291367a26b42e028341d7f19b91dffa818c10e9ada6fa9022796a87b57028631'}


def sha(value):return hashlib.sha256(value).hexdigest()
def environment(values):return dict(v.split('=',1) for v in values or [] if '=' in v)
def public_snapshot(row):return {'name':row['Name'],'image':row['Image'],'status':row.get('State',{}).get('Status')}


def validate_rendered(row,doc,name,image):
    service=doc['services'][name];base=image['Config'];actual=row['Config']
    env={**environment(base.get('Env')),**{k:str(v) for k,v in service.get('environment',{}).items() if v is not None}}
    if env!=environment(actual.get('Env')):raise ValueError('RENDERED_ENVIRONMENT_DIFFERS')
    mounts=[]
    for v in service.get('volumes',[]):
        if v.get('type')!='bind':raise ValueError('EXISTING_BIND_MOUNTS_REQUIRED')
        mounts.append([v['source'],v['target'],not v.get('read_only',False)])
    current=[[v['Source'],v['Destination'],v['RW']] for v in row['Mounts'] if v['Type']=='bind']
    if len(current)!=len(row['Mounts']) or sorted(mounts)!=sorted(current):raise ValueError('RENDERED_MOUNTS_DIFFER')
    if sorted(doc['networks'][n]['name'] for n in service.get('networks',{}))!=sorted(row['NetworkSettings']['Networks']):
        raise ValueError('RENDERED_NETWORKS_DIFFER')
    for key,field in [('command','Cmd'),('entrypoint','Entrypoint'),('working_dir','WorkingDir'),('user','User')]:
        expected=service.get(key)
        if expected is None:expected=None if key=='command' and service.get('entrypoint') is not None else base.get(field)
        if expected!=actual.get(field):raise ValueError('RENDERED_EXECUTION_DIFFERS')
    if bool(service.get('read_only'))!=row['HostConfig'].get('ReadonlyRootfs') or sorted(service.get('cap_drop',[]))!=sorted(row['HostConfig'].get('CapDrop') or []):
        raise ValueError('RENDERED_SECURITY_DIFFERS')


def external_networks(doc):
    for name,value in list(doc.get('networks',{}).items()):
        if not value.get('name'):raise ValueError('EXISTING_NETWORK_NAME_REQUIRED')
        doc['networks'][name]={'name':value['name'],'external':True}
    return doc


def worker_document(document,name,image):
    result=external_networks(copy.deepcopy(document));spec=result['services'][name]
    spec['image']=image;spec.pop('build',None);spec['working_dir']='/opt/village-components'
    # The new image supplies PYTHONPATH. An old Compose override must not hide it.
    env=spec.setdefault('environment',{})
    original=env.get('PYTHONPATH')
    if original is not None:env['PYTHONPATH']='/opt/village-components:'+str(original)
    if name=='facade-worker':env['BLENDER_EXECUTABLE']=BLENDER
    return result


def function_body(definition):
    match=re.search(r'AS\s+\$\$(.*?)\$\$;',definition,re.S|re.I)
    if not match:raise ValueError('KNOWN_FUNCTION_SOURCE_REQUIRED')
    return match[1]


def sql_change(baseline,changes,actual,*,apply=True):
    q=lambda value:"'"+value.replace("'","''")+"'"
    parts=['BEGIN;' if apply else 'BEGIN READ ONLY;',"SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';",
      "DO $g$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'WRONG_DATABASE';END IF;END$g$;"]
    for name,definition in changes.items():
        if not re.fullmatch('[a-z_]+',name):raise ValueError('FIXED_FUNCTION_NAME_REQUIRED')
        before,after=function_body(baseline[name]),function_body(definition)
        current=actual.get(name)
        if current not in (before,after):raise ValueError('DATABASE_FUNCTION_BASELINE_DIFFERS')
        statement=definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
        parts.append("DO $change$DECLARE actual text;BEGIN SELECT prosrc INTO STRICT actual FROM pg_proc WHERE pronamespace='api_private'::regnamespace AND proname="+q(name)+";IF actual IS DISTINCT FROM "+q(current)+" THEN RAISE EXCEPTION 'FUNCTION_CHANGED_DURING_UPDATE';END IF;"+(('EXECUTE '+q(statement)+';') if apply and current!=after else '')+'END$change$;')
    return '\n'.join(parts)+'\nCOMMIT;\n'


def inspect(docker,name):return docker.inspect(name)


def all_other(docker,names):
    ids=docker.run('ps','-aq').split()
    rows=json.loads(docker.run('inspect',*ids)) if ids else []
    return {r['Name']:{'id':r['Id'],'image':r['Image'],'running':r['State']['Running']} for r in rows if r['Name'].lstrip('/') not in names}


def resource_snapshot(row):
    # Compare all execution/resource controls after update, including GPUs and log options.
    host=copy.deepcopy(row['HostConfig'])
    for key in ('NetworkMode','ContainerIDFile'):host.pop(key,None)
    config={k:row['Config'].get(k) for k in ('Cmd','Entrypoint','User','Healthcheck','ExposedPorts','StopSignal')}
    return {'host':host,'config':config,'mounts':sorted((m['Type'],m['Source'],m['Destination'],m['RW']) for m in row['Mounts']),
            'networks':sorted(row['NetworkSettings']['Networks'])}


def validate_candidate(docker,row,document,service):
    """Create but never start a private candidate to compare actual Docker controls."""
    import business_storage_copy as storage
    probe='village-component-probe-'+secrets.token_hex(6)
    doc=external_networks(copy.deepcopy(document));spec=doc['services'][service]
    spec['image']=row['Image'];spec.pop('build',None);spec.pop('depends_on',None);spec.pop('profiles',None)
    spec['container_name']=probe;spec.setdefault('labels',{})['village.component.probe']='true'
    doc['services']={service:spec};doc['name']=probe
    file=docker.state/(probe+'.json');storage.write_private_json(file,doc)
    candidate=None
    try:
        docker.run('compose','--project-name',probe,'-f',file,'create','--no-deps','--no-build','--pull','never',service)
        candidate=docker.inspect(probe)
        if candidate['Config'].get('Labels',{}).get('village.component.probe')!='true':raise ValueError('PROBE_CONTAINER_IDENTITY_DIFFERS')
        before=resource_snapshot(row);planned=resource_snapshot(candidate)
        # A stopped container may not yet have network endpoints. Network names
        # were already compared to the actual running container by validate_rendered.
        before.pop('networks');planned.pop('networks')
        if before!=planned:raise ValueError('PLANNED_CONTAINER_RESOURCES_DIFFER')
    finally:
        if candidate and candidate['Config'].get('Labels',{}).get('village.component.probe')=='true':docker.run('rm',candidate['Id'])


def check_source():
    manifest=ROOT/'component-source.json'
    if not manifest.is_file():raise ValueError('VERIFIED_COMPONENT_BUNDLE_REQUIRED')
    doc=json.loads(manifest.read_text())
    if doc.get('kind')!='component-rollout' or not re.fullmatch('[a-f0-9]{40}',doc.get('commit','')):raise ValueError('INVALID_COMPONENT_BUNDLE')
    expected=doc['files'];actual={p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file()}
    if actual!=set(expected)|{'component-source.json'}:raise ValueError('BUNDLE_FILE_SET_CHANGED')
    for name,digest in expected.items():
        p=ROOT/name
        if p.is_symlink() or any(x.is_symlink() for x in p.parents) or sha(p.read_bytes())!=digest:raise ValueError('BUNDLE_SOURCE_CHANGED')
    return doc['commit']


def read_functions(docker,names):
    values=','.join("'"+n+"'" for n in names)
    rows=json.loads(docker.sql("SELECT coalesce(json_agg(json_build_object('name',proname,'body',prosrc,'definition',pg_get_functiondef(oid))),'[]') FROM pg_proc WHERE pronamespace='api_private'::regnamespace AND proname IN("+values+");").strip())
    if len(rows)!=len(names) or set(r['name'] for r in rows)!=set(names):raise ValueError('EXPECTED_DATABASE_FUNCTIONS_REQUIRED')
    return {r['name']:r for r in rows}


def write_public(root,name,value):
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.exists():
        if path.read_bytes()!=value:raise ValueError('PREPARED_SOURCE_CHANGED')
    else:path.write_bytes(value)
    path.chmod(0o644)
    return path


def wait_healthy(docker,name):
    initial=docker.inspect(name);health=initial.get('Config',{}).get('Healthcheck',{})
    seconds=lambda key,default:health.get(key,default*10**9)/10**9
    budget=min(1200,max(90,int(seconds('StartPeriod',0)+(seconds('Interval',10)+seconds('Timeout',3))*(health.get('Retries',3)+1)+30)))
    for _ in range(budget):
        row=docker.inspect(name)
        if row['State']['Running'] and row['State'].get('Health',{}).get('Status','healthy')=='healthy':return row
        time.sleep(1)
    raise ValueError('UPDATED_CONTAINER_NOT_HEALTHY')


def compose_config(docker,row):
    labels=row['Config'].get('Labels',{});files=labels.get('com.docker.compose.project.config_files','').split(',')
    directory=labels.get('com.docker.compose.project.working_dir')
    if not directory or not files or any(not Path(p).is_file() for p in files):raise ValueError('ORIGINAL_COMPOSE_FILES_REQUIRED')
    args=['compose','--project-name','village-platform','--project-directory',directory]
    env_files=labels.get('com.docker.compose.project.environment_file','')
    if env_files:
        for p in env_files.split(','):args+=['--env-file',p]
    elif row['Name'].endswith('facade-worker-1'):
        args+=['--env-file',str(Path(directory)/'linux/gpu.env')]
    # A current service image tag is a valid rendering hint when the historic
    # ML Compose had IMAGE_TAG in the operator shell rather than an env file.
    tag=row['Config'].get('Image','').rsplit(':',1)[-1]
    if re.fullmatch('[a-f0-9]{40}',tag):
        hint=docker.state/('image-hint-'+tag[:12]+'.env')
        if hint.exists() and hint.read_text()!='IMAGE_TAG='+tag+'\n':raise ValueError('IMAGE_HINT_CHANGED')
        hint.write_text('IMAGE_TAG='+tag+'\n');hint.chmod(0o600)
        args+=['--env-file',hint]
    for path in files:args+=['-f',path]
    return json.loads(docker.run(*args,'config','--format','json'))


def worker(state,source,commit,*,apply,docker):
    import business_storage_copy as storage
    names=['village-platform-facade-worker-1','village-platform-facade-ml-1']
    rows={name:inspect(docker,name) for name in names};docs={}
    for name,row in rows.items():
        if row['Image']!=OBSERVED[name] or not row['State']['Running']:raise ValueError('OBSERVED_CAMPUS_IMAGES_CHANGED')
        service='facade-worker' if name.endswith('worker-1') else 'facade-ml'
        doc=compose_config(docker,row);image=json.loads(docker.run('image','inspect',row['Image']))[0]
        validate_rendered(row,doc,service,image);validate_candidate(docker,row,doc,service);docs[name]=doc
    env=environment(rows[names[0]]['Config']['Env'])
    if env.get('VILLAGE_TASK_BACKEND')!='aliyun':raise ValueError('ALIYUN_WORKER_REQUIRED')
    check="from village_processing.local_task_http import LocalTaskHTTP;h=LocalTaskHTTP(key_file='/run/secrets/aliyun-worker-key',kind='facade');h.verify_identity();h.close()"
    docker.run('exec',names[0],'python','-c',check)
    # Test the shared lock without claiming or changing a task.
    lock="import os,fcntl; p=os.environ.get('PLATFORM_GPU_LOCK_PATH','/work/.locks/gpu-0.lock');f=open(p,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)"
    docker.run('exec',names[1],'python','-c',lock)
    before=all_other(docker,names)
    if not apply:return {'status':'component_worker_preflight_passed','separate_compose_configs':True,'services':[public_snapshot(r) for r in rows.values()]}
    receipt={'phase':'prepared','commit':commit,'kind':'worker','before':rows,'other':before}
    images={}
    for name,row in rows.items():
        service='facade-worker' if name.endswith('worker-1') else 'facade-ml';suffix='component-worker' if service=='facade-worker' else 'component-ml'
        base='village-component-base:'+row['Image'][7:19];tag='village-'+suffix+':'+commit[:12]
        docker.run('tag',row['Image'],base)
        docker.run('build','--pull=false','--build-arg','BASE_IMAGE='+base,'--label','village.component.source='+commit,
                   '-f',source/'linux'/('Dockerfile.'+suffix),'-t',tag,source,timeout=1800)
        image=json.loads(docker.run('image','inspect',tag))[0]
        if image.get('Os')!='linux' or image.get('Architecture')!='amd64':raise ValueError('BUILT_IMAGE_PLATFORM_DIFFERS')
        images[name]=image['Id']
        code='from rural_house_generator.backend.component_building.adapter import build_spec' if service=='facade-worker' else 'from rural_house_generator.backend.ml_worker import FacadeMLRuntime'
        docker.run('run','--rm','--pull=never','--network','none','--entrypoint','python',image['Id'],'-c',code)
        if service=='facade-worker':docker.run('run','--rm','--pull=never','--network','none','--entrypoint',BLENDER,image['Id'],'--version')
        original=external_networks(copy.deepcopy(docs[name]));original['services'][service]['image']=row['Image']
        storage.write_private_json(state/(service+'-original.json'),original)
        storage.write_private_json(state/(service+'.json'),worker_document(docs[name],service,image['Id']))
    if before!=all_other(docker,names):raise ValueError('OTHER_SERVICES_CHANGED')
    receipt['images']=images
    storage.write_private_json(state/'receipt.json',receipt)
    for name in reversed(names):
        service='facade-worker' if name.endswith('worker-1') else 'facade-ml'
        if docker.inspect(name)['Id']!=rows[name]['Id'] or compose_config(docker,rows[name])!=docs[name]:raise ValueError('CAMPUS_CHANGED_DURING_BUILD')
        docker.run('compose','-f',state/(service+'.json'),'up','-d','--no-deps','--no-build','--pull','never',service)
        current=wait_healthy(docker,name)
        if resource_snapshot(current)!=resource_snapshot(rows[name]):raise ValueError('UPDATED_WORKER_RESOURCES_CHANGED')
        actual=environment(current['Config']['Env']);old=environment(rows[name]['Config']['Env'])
        allowed={k:v for k,v in actual.items() if k not in ('PYTHONPATH','BLENDER_EXECUTABLE')}
        if allowed!={k:v for k,v in old.items() if k not in ('PYTHONPATH','BLENDER_EXECUTABLE')}:raise ValueError('UPDATED_WORKER_ENVIRONMENT_CHANGED')
    docker.run('exec',names[0],'python','-c',check)
    probe="import urllib.request,json;assert json.load(urllib.request.urlopen('http://facade-ml:8012/health'))['components_version']==1"
    docker.run('exec',names[0],'python','-c',probe)
    if before!=all_other(docker,names):raise ValueError('OTHER_SERVICES_CHANGED')
    receipt.update(phase='complete',images=images,after={n:docker.inspect(n)['Id'] for n in names})
    storage.write_private_json(state/'receipt.json',receipt)
    return {'status':'component_workers_updated_real_photo_test_pending','services':2,'other_services_unchanged':True}


def cloud(state,source,commit,*,apply,docker):
    import business_storage_copy as storage
    from autonomous_bundle import load_script
    from autonomous_operator import verified_runtime,API,WEB,AUTH,PG
    from autonomous_extract import tree_digest
    runtime=Path.home()/'village-autonomous';meta,_=verified_runtime(docker,runtime)
    rows={n:docker.inspect(n) for n in (API,WEB,PG)}
    if any(row['Image']!=OBSERVED[n] for n,row in rows.items()):raise ValueError('OBSERVED_CLOUD_IMAGES_CHANGED')
    original=runtime/'files/single-personal-20261024-v1/web'
    web=rows[WEB];mounts=[v for v in web['Mounts'] if v['Destination']=='/srv/village-web']
    if len(mounts)!=1 or mounts[0]['Source']!=str(original) or mounts[0]['RW']:raise ValueError('CURRENT_SINGLE_PERSONAL_WEB_REQUIRED')
    proof=storage.read_private_json(original.parent/'overlay-proof.json')
    if tree_digest(original)!=proof['tree_sha256']:raise ValueError('CURRENT_WEB_OVERLAY_CHANGED')
    document=storage.read_private_json(runtime/'compose.json')
    for name,service in [(API,'api'),(WEB,'web')]:
        image=json.loads(docker.run('image','inspect',rows[name]['Image']))[0]
        validate_rendered(rows[name],document,service,image);validate_candidate(docker,rows[name],document,service)
    if document['services']['web']['volumes'] and not any(v.get('source')==str(original) and v.get('target')=='/srv/village-web' for v in document['services']['web']['volumes']):raise ValueError('CURRENT_CLOUD_COMPOSE_CHANGED')
    baseline=json.loads((source/'linux/component-baseline.json').read_text())
    definitions=read_functions(docker,baseline['functions'])
    changes=baseline['changes'];bodies={n:r['body'] for n,r in definitions.items()}
    check_sql=sql_change(baseline['functions'],changes,bodies,apply=False);docker.sql(check_sql)
    busy=docker.sql("SELECT count(*) FROM api_private.local_gpu_runs WHERE status NOT IN('completed','failed','canceled');").strip()
    if busy!='0':raise ValueError('EXISTING_LOCAL_TASKS_MUST_FINISH_OR_BE_CANCELED')
    api_files=baseline['api_files'];query="const fs=require('fs'),c=require('crypto');const names="+json.dumps(list(api_files))+";console.log(JSON.stringify(Object.fromEntries(names.map(n=>[n,c.createHash('sha256').update(fs.readFileSync('/opt/village/'+n)).digest('hex')]))))"
    actual=json.loads(docker.run('exec',API,'node','-e',query))
    for name,expected in api_files.items():
        if actual.get(name) not in (expected,sha((source/name).read_bytes())):raise ValueError('API_CODE_BASELINE_DIFFERS')
    if not apply:return {'status':'component_cloud_preflight_passed','current_web_preserved':True,'api_files':len(api_files),'functions':len(changes),'active_tasks':0}
    backup=load_script('backup-autonomous').backup(runtime,Path.home()/'village-autonomous-backups')
    receipt={'phase':'prepared','commit':commit,'kind':'cloud','backup':str(backup),'before':rows}
    storage.write_private_json(state/'receipt.json',receipt);storage.write_private_json(state/'original-compose.json',document)
    write_public(state,'rollback-functions.sql',('\n'.join(r['definition'] for r in definitions.values())).encode())
    updated=copy.deepcopy(document)
    for name in api_files:
        path=write_public(state,'code/'+name,(source/name).read_bytes())
        target='/opt/village/'+name
        if any(v.get('target')==target for v in updated['services']['api']['volumes']):raise ValueError('API_ALREADY_HAS_CODE_OVERLAY')
        updated['services']['api']['volumes'].append({'type':'bind','source':str(path),'target':target,'read_only':True,'bind':{'create_host_path':False}})
    target_web=state/'web';shutil.copytree(original,target_web,copy_function=shutil.copyfile)
    for name in baseline['web_files']:
        path=target_web/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);path.write_bytes((source/name).read_bytes());path.chmod(0o600)
    for path in [target_web,*target_web.rglob('*')]:path.chmod(0o700 if path.is_dir() else 0o600)
    for v in updated['services']['web']['volumes']:
        if v.get('target')=='/srv/village-web':v['source']=str(target_web)
    receipt['web_sha256']=tree_digest(target_web)
    receipt['api_hashes']={name:sha((source/name).read_bytes()) for name in api_files}
    storage.write_private_json(state/'receipt.json',receipt)
    before=all_other(docker,(API,WEB))
    # Stop only the API writer while the exact function update commits. Auth,
    # PostgreSQL and all files stay in place. On failure retain the old service.
    docker.run('stop','--time','20',API)
    try:
        if docker.sql("SELECT count(*) FROM api_private.local_gpu_runs WHERE status NOT IN('completed','failed','canceled');").strip()!='0':raise ValueError('TASK_SUBMITTED_DURING_ROLLOUT')
        docker.sql(sql_change(baseline['functions'],changes,bodies))
    except Exception:
        docker.run('start',API);raise
    storage.write_private_json(runtime/'compose.json',updated)
    docker.run('compose','-f',runtime/'compose.json','up','-d','--no-deps','--no-build','--pull','never','api','web')
    wait_healthy(docker,API);wait_healthy(docker,WEB);docker.run('exec',WEB,'/usr/sbin/nginx','-t')
    browser=load_script('repair-autonomous-browser')
    for name in baseline['web_files']:browser.check_served(name,(source/name).read_bytes(),443)
    if before!=all_other(docker,(API,WEB)):raise ValueError('OTHER_CLOUD_SERVICES_CHANGED')
    receipt.update(phase='complete',after={n:docker.inspect(n)['Id'] for n in (API,WEB)})
    storage.write_private_json(state/'receipt.json',receipt)
    return {'status':'component_cloud_updated_worker_and_real_photo_test_pending','api_and_web_updated':True,'auth_database_retained':True}


def verify(state,docker,commit,role):
    import business_storage_copy as storage
    receipt=storage.read_private_json(state/'receipt.json')
    if receipt.get('phase')!='complete' or receipt.get('commit')!=commit or receipt.get('kind')!=role:raise ValueError('INCOMPLETE_ROLLOUT_REQUIRES_INSPECTION')
    for name,identifier in receipt['after'].items():
        row=wait_healthy(docker,name)
        if row['Id']!=identifier or not row['State']['Running']:raise ValueError('UPDATED_CONTAINER_CHANGED')
    if role=='cloud':
        from autonomous_extract import tree_digest
        if tree_digest(state/'web')!=receipt['web_sha256']:raise ValueError('UPDATED_WEB_CHANGED')
        for name,digest in receipt['api_hashes'].items():
            if sha((state/'code'/name).read_bytes())!=digest:raise ValueError('UPDATED_API_CHANGED')
        changes=json.loads((ROOT/'linux/component-baseline.json').read_text())['changes']
        actual=read_functions(docker,changes)
        if any(actual[n]['body']!=function_body(definition) for n,definition in changes.items()):raise ValueError('UPDATED_SQL_CHANGED')
    else:
        docker.run('exec','village-platform-facade-worker-1',BLENDER,'--version')
        docker.run('exec','village-platform-facade-worker-1','python','-c',"import urllib.request,json;assert json.load(urllib.request.urlopen('http://facade-ml:8012/health'))['components_version']==1")
    return {'status':'component_'+role+'_rollout_receipt_verified_real_photo_test_pending'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('role',choices=['cloud','worker'])
    action=parser.add_mutually_exclusive_group(required=True)
    for name in ('check','apply','verify'):action.add_argument('--'+name,action='store_true')
    args=parser.parse_args()
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        sys.dont_write_bytecode=True;os.umask(0o077);commit=check_source()
        import business_storage_copy as storage
        from autonomous_operator import Docker,operation_lock
        state=(Path.home()/'village-autonomous/files'/PATCH if args.role=='cloud' else Path.home()/'village-component-worker')/commit[:12]
        state.mkdir(parents=True,exist_ok=True,mode=0o700)
        lock_root=Path.home()/('village-autonomous' if args.role=='cloud' else 'village-campus-autonomous')
        with operation_lock(lock_root):
            docker=Docker(state)
            if args.verify or (state/'receipt.json').exists():result=verify(state,docker,commit,args.role)
            else:result=(cloud if args.role=='cloud' else worker)(state,ROOT,commit,apply=args.apply,docker=docker)
        print(json.dumps(result));return 0
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError) as error:
        code=str(error) if re.fullmatch('[A-Z_]{1,100}',str(error)) else type(error).__name__
        print('STOP: COMPONENT_ROLLOUT '+code+'. Preserve current configuration, receipts and private logs; do not rerun initial installers.');return 1


if __name__=='__main__':raise SystemExit(main())
