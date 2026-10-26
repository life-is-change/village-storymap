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
import urllib.request
import urllib.error
import http.client
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[2]
PATCH='components-20261025-v1'
BLENDER='/opt/blender-runtime/blender-3.6.23-linux-x64/blender'
BLENDER_ARCHIVE_NAME='blender-3.6.23-linux-x64.tar.xz'
BLENDER_ARCHIVE_SHA256='0e9a18af4d0060b825e9617e24a775f759e0f9f67271c062f3d53a539030af00'
BLENDER_ARCHIVE_SIZE=272819000
BLENDER_DOWNLOAD_ROOTS=(
 'https://download.blender.org/release/Blender3.6/',
 'https://mirrors.aliyun.com/blender/release/Blender3.6/',
 'https://mirror.nju.edu.cn/blender/release/Blender3.6/')
CAMPUS_ROOT=Path('/media/gpu332/newapply/village-platform')
OBSERVED={
 'village-platform-facade-worker-1':'sha256:0cac700ae4a12c4808a95f98958547879b8ec311053bcb1cbe8ef75520610212',
 'village-platform-facade-ml-1':'sha256:623ffb0c4ba219f41865f32a80349226cd9095051a23266dedf471a09389f6d6',
 'village-autonomous-api':'sha256:73d6c74c1a387e0763b9920bb99846707038c08bfcc90456cf15a3c3fb808df7',
 'village-autonomous-web':'sha256:35b34a15ae8b2c2cb9e12d733b9fc95312977bfec20c722cd2ba40eb7333452f',
 'village-autonomous-postgres':'sha256:291367a26b42e028341d7f19b91dffa818c10e9ada6fa9022796a87b57028631'}

# Only the old texture workflow's human crop checkpoint is migration-compatible.
# No Worker may own a live lease here. All other unfinished work must drain.
LOCAL_TASKS_SNAPSHOT_SQL = """WITH pending AS (
 SELECT (kind='facade' AND phase='rectification' AND status='awaiting_crop'
         AND coalesce(input->>'generationMethod','texture')='texture'
         AND (lease_until IS NULL OR lease_until<=now())) AS preserve
 FROM api_private.local_gpu_runs WHERE status NOT IN('completed','failed','canceled')
)
SELECT json_build_object('blocking',count(*) FILTER (WHERE NOT preserve),
 'preserved_awaiting_crop',count(*) FILTER (WHERE preserve)) FROM pending;"""


def sha(value):return hashlib.sha256(value).hexdigest()
def environment(values):return dict(v.split('=',1) for v in values or [] if '=' in v)
def public_snapshot(row):return {'name':row['Name'],'image':row['Image'],'status':row.get('State',{}).get('Status')}


def check_cloud_task_quiescence(docker,error_code):
    counts=json.loads(docker.sql(LOCAL_TASKS_SNAPSHOT_SQL))
    if not isinstance(counts,dict) or set(counts)!={'blocking','preserved_awaiting_crop'} or any(type(v) is not int or v<0 for v in counts.values()):
        raise ValueError('INVALID_LOCAL_TASK_SNAPSHOT')
    if counts['blocking']:raise ValueError(error_code)
    return counts['preserved_awaiting_crop']


def worker_paths(source,commit,home,*,platform_root=CAMPUS_ROOT):
    """Plan only new component files; keep both historic checkouts and lock."""
    import business_storage_copy as storage
    root=Path(platform_root)
    if not root.is_dir() or root.is_symlink():raise ValueError('EXISTING_CENTRAL_PLATFORM_ROOT_REQUIRED')
    root=storage.no_links(root);base=root/'deploy/components'
    source=storage.no_links(source)
    if not source.is_relative_to(base/'releases'):raise ValueError('SOURCE_MUST_BE_IN_CENTRAL_RELEASES')
    if not re.fullmatch('[a-f0-9]{40}',commit):raise ValueError('INVALID_COMPONENT_BUNDLE')
    lock=Path(home)/'village-campus-autonomous'
    if not lock.is_dir() or lock.is_symlink():raise ValueError('EXISTING_CAMPUS_OPERATOR_LOCK_REQUIRED')
    state=storage.no_links(base/'state'/commit[:12])
    temporary=storage.no_links(state/'tmp')
    return {'state':state,'temporary':temporary,'lock':lock}


def worker_storage_report(docker,platform_root=CAMPUS_ROOT):
    """Report the real daemon store, never relocate it or prune other projects."""
    root=Path(platform_root);engine=Path(docker.run('info','--format','{{.DockerRootDir}}').strip())
    if not engine.is_absolute() or not engine.is_dir():raise ValueError('EXISTING_DOCKER_STORAGE_REQUIRED')
    project_free=shutil.disk_usage(root).free;engine_free=shutil.disk_usage(engine).free
    if engine_free<8*1024**3:raise ValueError('DOCKER_FREE_SPACE_BELOW_COMPONENT_RESERVE')
    if project_free<1024**3:raise ValueError('PROJECT_FREE_SPACE_BELOW_COMPONENT_RESERVE')
    return {'project_root':str(root),'project_free_bytes':project_free,'docker_root':str(engine),
            'docker_free_bytes':engine_free,'docker_images_inside_project_root':engine.resolve().is_relative_to(root.resolve()),
            'global_docker_migration':False}


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
    # Docker may serialize the same explicit mounts in a different order.
    # Preserve complete mount entries, options and duplicates in comparison.
    if isinstance(host.get('Mounts'),list):host['Mounts'].sort(key=lambda v:json.dumps(v,sort_keys=True))
    # Moby adapts an unspecified OomKillDisable to false. True must still differ.
    if host.get('OomKillDisable') is None:host['OomKillDisable']=False
    # Moby uses len(...) > 0 for these three DNS overrides. Unset/empty both
    # inherit daemon defaults; configured values and their order stay intact.
    for key in ('Dns','DnsOptions','DnsSearch'):
        if host.get(key) is None:host[key]=[]
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
        # create has no --no-deps option. The isolated document above already
        # contains only this service, with depends_on/build removed.
        docker.run('compose','--project-name',probe,'-f',file,'create','--no-build','--pull','never',service)
        candidate=docker.inspect(probe)
        if candidate['Config'].get('Labels',{}).get('village.component.probe')!='true':raise ValueError('PROBE_CONTAINER_IDENTITY_DIFFERS')
        before=resource_snapshot(row);planned=resource_snapshot(candidate)
        # A stopped container may not yet have network endpoints. Network names
        # were already compared to the actual running container by validate_rendered.
        before.pop('networks');planned.pop('networks')
        if before!=planned:
            fields=[]
            for section in sorted(set(before)|set(planned)):
                a,b=before.get(section),planned.get(section)
                if isinstance(a,dict) and isinstance(b,dict):
                    fields.extend(section+'.'+key for key in sorted(set(a)|set(b)) if key not in a or key not in b or a[key]!=b[key])
                elif a!=b:fields.append(section)
            # Print field names only; never commands, mount sources or env values.
            print(json.dumps({'resource_difference_fields':fields}))
            raise ValueError('PLANNED_CONTAINER_RESOURCES_DIFFER')
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


def source_context(path=None):
    global ROOT
    if path is not None:
        path=Path(path)
        if not path.is_absolute():raise ValueError('ABSOLUTE_VERIFIED_SOURCE_ROOT_REQUIRED')
        ROOT=path
    commit=check_source()
    # A separately checksum-pinned operator can reuse a verified payload; its
    # helpers and build inputs still come only from that complete payload.
    sys.path.insert(0,str(ROOT/'linux/scripts'))
    return commit


def operator_digest():return sha(Path(__file__).read_bytes())


def valid_blender_archive(path):
    if path.stat().st_size!=BLENDER_ARCHIVE_SIZE:return False
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024**2),b''):digest.update(block)
    return digest.hexdigest()==BLENDER_ARCHIVE_SHA256


def cached_blender_archive(state):
    """Download on the host, not in Docker; publish only checksum-pinned bytes."""
    import business_storage_copy as storage
    folder=storage.no_links(state/'downloads');folder.mkdir(mode=0o700,exist_ok=True)
    storage.private_path(folder,directory=True)
    archive=storage.no_links(folder/BLENDER_ARCHIVE_NAME)
    if archive.exists():
        storage.private_path(archive)
        if not valid_blender_archive(archive):raise ValueError('BLENDER_ARCHIVE_CHECKSUM_MISMATCH')
        print(json.dumps({'stage':'blender_archive','status':'verified_cache'}),flush=True)
        return archive
    for base in BLENDER_DOWNLOAD_ROOTS:
        part=folder/(BLENDER_ARCHIVE_NAME+'.'+secrets.token_hex(8)+'.part')
        try:
            print(json.dumps({'stage':'blender_download','source':urlsplit(base).hostname,'status':'started'}),flush=True)
            request=urllib.request.Request(base+BLENDER_ARCHIVE_NAME,headers={'User-Agent':'village-component-rollout/1.0','Accept':'application/octet-stream'})
            started=time.monotonic();size=0;next_progress=10
            with urllib.request.urlopen(request,timeout=30) as incoming,os.fdopen(os.open(part,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:
                while block:=incoming.read(1024**2):
                    size+=len(block)
                    if size>BLENDER_ARCHIVE_SIZE:raise ValueError('BLENDER_ARCHIVE_SIZE_MISMATCH')
                    if time.monotonic()-started>900:raise ValueError('BLENDER_DOWNLOAD_TIMEOUT')
                    output.write(block)
                    progress=size*100//BLENDER_ARCHIVE_SIZE
                    if progress>=next_progress:
                        print(json.dumps({'stage':'blender_download','percent':progress}),flush=True);next_progress=progress+10
                output.flush();os.fsync(output.fileno())
            if not valid_blender_archive(part):raise ValueError('BLENDER_ARCHIVE_CHECKSUM_MISMATCH')
            part.replace(archive)
            storage.write_private_json(folder/'blender-source.json',{'url':base+BLENDER_ARCHIVE_NAME,'sha256':BLENDER_ARCHIVE_SHA256,'size':size})
            return archive
        except (OSError,ValueError,http.client.HTTPException) as error:
            # Fixed public hosts and numeric HTTP status only, never proxy URLs.
            print(json.dumps({'stage':'blender_download','source':urlsplit(base).hostname,'status':'failed','category':type(error).__name__,'http_status':getattr(error,'code',None)}),flush=True)
        finally:
            if part.exists():part.unlink()  # Only this attempt's own incomplete file.
    raise ValueError('BLENDER_DOWNLOAD_UNAVAILABLE')


def runtime_copy_dockerfile(text):
    # Host contexts deliberately stay private (0700). COPY otherwise preserves
    # those modes with root ownership, hiding modules from runtime UID 10001.
    copies={
      'COPY server/src/village_processing /opt/village-components/village_processing':
        'COPY --chown=10001:10001 server/src/village_processing /opt/village-components/village_processing',
      'COPY rural_house_generator/backend /opt/village-components/rural_house_generator/backend':
        'COPY --chown=10001:10001 rural_house_generator /opt/village-components/rural_house_generator'}
    result='\n'.join(copies.get(line,line) for line in text.splitlines())+'\n'
    required='COPY --chown=10001:10001 rural_house_generator /opt/village-components/rural_house_generator'
    if result.splitlines().count(required)!=1:raise ValueError('RUNTIME_PACKAGE_COPY_REQUIRED')
    return result


def component_import_smoke(service):
    module,symbol=('rural_house_generator.backend.component_building.adapter','build_spec') if service=='facade-worker' else ('rural_house_generator.backend.ml_worker','FacadeMLRuntime')
    return ("import importlib; m=importlib.import_module("+repr(module)+");"
            "assert m.__file__.startswith('/opt/village-components/'), 'INHERITED_COMPONENT_MODULE_LOADED';"
            "assert callable(getattr(m,"+repr(symbol)+"))")


def prepare_worker_build(state,source):
    """Keep the verified r6 payload unchanged; make an isolated offline context."""
    import business_storage_copy as storage
    archive=cached_blender_archive(state)
    original=(source/'linux/Dockerfile.component-worker').read_text()
    add='ADD '+BLENDER_ARCHIVE_NAME+' /opt/blender-runtime/'
    # r6 used an in-build URL fetch. Only replace those three known lines;
    # fresh payloads already contain the equivalent local ADD instruction.
    prefixes=('ARG BLENDER_URL=','ARG BLENDER_SHA256=','RUN BLENDER_URL=')
    legacy=[line for line in original.splitlines() if line.startswith(prefixes)]
    if legacy:
        if len(legacy)!=3 or not all(sum(line.startswith(prefix) for line in legacy)==1 for prefix in prefixes):
            raise ValueError('UNSUPPORTED_BLENDER_DOCKERFILE')
        original='\n'.join(add if line.startswith(prefixes[2]) else line for line in original.splitlines() if not line.startswith(prefixes[:2]))+'\n'
    if original.splitlines().count(add)!=1 or 'urlretrieve' in original or 'BLENDER_URL' in original:
        raise ValueError('OFFLINE_BLENDER_DOCKERFILE_REQUIRED')
    original=runtime_copy_dockerfile(original)
    # Keep the failed v1 context as evidence; reuse its verified download cache.
    context=storage.no_links(state/'worker-build-context-v2');context.mkdir(mode=0o700,exist_ok=True)
    storage.private_path(context,directory=True)
    files={}
    for name in ('server/src/village_processing','rural_house_generator/backend'):
        tree=storage.no_links(source/name)
        if not tree.is_dir():raise ValueError('VERIFIED_WORKER_CODE_REQUIRED')
        for path in tree.rglob('*'):
            path=storage.no_links(path)
            if path.is_file():files[path.relative_to(source).as_posix()]=path
    marker='rural_house_generator/__init__.py'
    expected=set(files)|{BLENDER_ARCHIVE_NAME,'Dockerfile',marker}
    for path in context.rglob('*'):
        path=storage.no_links(path)
        if path.is_file() and path.relative_to(context).as_posix() not in expected:
            raise ValueError('UNEXPECTED_WORKER_BUILD_FILE')
    for name,path in files.items():write_public(context,storage.no_links(context/name).relative_to(context),path.read_bytes())
    # A namespace directory can lose to an inherited regular package even when
    # PYTHONPATH points here first. Make this complete overlay package explicit.
    write_public(context,marker,b'"""Pinned component runtime package."""\n')
    target=storage.no_links(context/BLENDER_ARCHIVE_NAME)
    if target.exists():
        if not valid_blender_archive(target):raise ValueError('PREPARED_BLENDER_ARCHIVE_CHANGED')
    else:
        shutil.copyfile(archive,target);target.chmod(0o600)
        if not valid_blender_archive(target):raise ValueError('PREPARED_BLENDER_ARCHIVE_CHANGED')
    dockerfile=write_public(context,'Dockerfile',original.encode())
    return context,dockerfile


def render_cloud_compose(docker,runtime):
    return json.loads(docker.run('compose','--project-name','village-autonomous',
        '--project-directory',runtime,'-f',runtime/'compose.json','config','--format','json'))


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
    # Paths come from the running container's Compose labels. The sudo Docker
    # client below must validate/read root-protected configs; a local stat by
    # the unprivileged operator can fail before Compose gets the file.
    if not directory or not Path(directory).is_absolute() or not files or any(not p or not Path(p).is_absolute() for p in files):
        raise ValueError('ORIGINAL_COMPOSE_FILES_REQUIRED')
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
    context,worker_dockerfile=prepare_worker_build(state,source)
    ml_dockerfile=write_public(state,'Dockerfile.component-ml-v2',runtime_copy_dockerfile((source/'linux/Dockerfile.component-ml').read_text()).encode())
    for name,row in rows.items():
        service='facade-worker' if name.endswith('worker-1') else 'facade-ml';suffix='component-worker' if service=='facade-worker' else 'component-ml'
        base='village-component-base:'+row['Image'][7:19];tag='village-'+suffix+':'+commit[:12]
        dockerfile=worker_dockerfile if service=='facade-worker' else ml_dockerfile
        docker.run('tag',row['Image'],base)
        docker.run('build','--pull=false','--build-arg','BASE_IMAGE='+base,'--label','village.component.source='+commit,
                   '-f',dockerfile,'-t',tag,context,timeout=1800)
        image=json.loads(docker.run('image','inspect',tag))[0]
        if image.get('Os')!='linux' or image.get('Architecture')!='amd64':raise ValueError('BUILT_IMAGE_PLATFORM_DIFFERS')
        images[name]=image['Id']
        code=component_import_smoke(service)
        docker.run('run','--rm','--pull=never','--network','none','--user',row['Config'].get('User') or '0','--entrypoint','python',image['Id'],'-c',code)
        if service=='facade-worker':docker.run('run','--rm','--pull=never','--network','none','--entrypoint',BLENDER,image['Id'],'--version')
        original=external_networks(copy.deepcopy(docs[name]));original['services'][service]['image']=row['Image']
        storage.write_private_json(state/(service+'-original.json'),original)
        storage.write_private_json(state/(service+'.json'),worker_document(docs[name],service,image['Id']))
    if before!=all_other(docker,names):raise ValueError('OTHER_SERVICES_CHANGED')
    receipt['images']=images
    write_public(state,'operator.py',Path(__file__).read_bytes());receipt['operator_sha256']=operator_digest()
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
    rendered=render_cloud_compose(docker,runtime)
    for name,service in [(API,'api'),(WEB,'web')]:
        image=json.loads(docker.run('image','inspect',rows[name]['Image']))[0]
        validate_rendered(rows[name],rendered,service,image);validate_candidate(docker,rows[name],rendered,service)
    if document['services']['web']['volumes'] and not any(v.get('source')==str(original) and v.get('target')=='/srv/village-web' for v in document['services']['web']['volumes']):raise ValueError('CURRENT_CLOUD_COMPOSE_CHANGED')
    baseline=json.loads((source/'linux/component-baseline.json').read_text())
    definitions=read_functions(docker,baseline['functions'])
    changes=baseline['changes'];bodies={n:r['body'] for n,r in definitions.items()}
    check_sql=sql_change(baseline['functions'],changes,bodies,apply=False);docker.sql(check_sql)
    preserved=check_cloud_task_quiescence(docker,'EXISTING_LOCAL_TASKS_MUST_FINISH_OR_BE_CANCELED')
    api_files=baseline['api_files'];query="const fs=require('fs'),c=require('crypto');const names="+json.dumps(list(api_files))+";console.log(JSON.stringify(Object.fromEntries(names.map(n=>[n,c.createHash('sha256').update(fs.readFileSync('/opt/village/'+n)).digest('hex')]))))"
    actual=json.loads(docker.run('exec',API,'node','-e',query))
    for name,expected in api_files.items():
        if actual.get(name) not in (expected,sha((source/name).read_bytes())):raise ValueError('API_CODE_BASELINE_DIFFERS')
    if not apply:return {'status':'component_cloud_preflight_passed','current_web_preserved':True,'api_files':len(api_files),'functions':len(changes),'active_tasks':0,'preserved_awaiting_crop':preserved}
    backup=load_script('backup-autonomous').backup(runtime,Path.home()/'village-autonomous-backups')
    receipt={'phase':'prepared','commit':commit,'kind':'cloud','backup':str(backup),'before':rows}
    write_public(state,'operator.py',Path(__file__).read_bytes());receipt['operator_sha256']=operator_digest()
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
        receipt['preserved_awaiting_crop']=check_cloud_task_quiescence(docker,'TASK_SUBMITTED_DURING_ROLLOUT')
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
    if receipt.get('operator_sha256')!=operator_digest():raise ValueError('ROLLOUT_OPERATOR_CHANGED')
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
    parser.add_argument('--source-root',type=Path,help='Reuse an already verified component payload without changing its files')
    action=parser.add_mutually_exclusive_group(required=True)
    for name in ('check','apply','verify'):action.add_argument('--'+name,action='store_true')
    args=parser.parse_args()
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        sys.dont_write_bytecode=True;os.umask(0o077);commit=source_context(args.source_root)
        import business_storage_copy as storage
        from autonomous_operator import Docker,operation_lock
        paths=worker_paths(ROOT,commit,Path.home()) if args.role=='worker' else None
        state=paths['state'] if paths else Path.home()/'village-autonomous/files'/PATCH/commit[:12]
        state.mkdir(parents=True,exist_ok=True,mode=0o700)
        storage.private_path(state,directory=True)
        if paths:
            paths['temporary'].mkdir(mode=0o700,exist_ok=True)
            storage.private_path(paths['temporary'],directory=True)
            os.environ.update({name:str(paths['temporary']) for name in ('TMPDIR','TMP','TEMP')})
        lock_root=paths['lock'] if paths else Path.home()/'village-autonomous'
        with operation_lock(lock_root):
            docker=Docker(state,temporary=paths['temporary']) if paths else Docker(state)
            location=worker_storage_report(docker) if paths else None
            if args.verify or (state/'receipt.json').exists():result=verify(state,docker,commit,args.role)
            else:result=(cloud if args.role=='cloud' else worker)(state,ROOT,commit,apply=args.apply,docker=docker)
            if location:result['storage']=location
        result.update(payload_commit=commit,operator_sha256=operator_digest())
        print(json.dumps(result));return 0
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError) as error:
        code=str(error) if re.fullmatch('[A-Z_]{1,100}',str(error)) else type(error).__name__
        print('STOP: COMPONENT_ROLLOUT '+code+'. Preserve current configuration, receipts and private logs; do not rerun initial installers.');return 1


if __name__=='__main__':raise SystemExit(main())
