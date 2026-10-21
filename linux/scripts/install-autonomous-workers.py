#!/usr/bin/env python3
"""Switch only the two existing campus Workers, retaining pipelines and other services."""
import argparse
import hashlib
import json
import os
from pathlib import Path,PurePosixPath
import re
import shutil
import subprocess
import tarfile
import time
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_operator import Docker,clean_environment,operation_lock

KINDS=('geo','facade')
NAMES={kind:'village-platform-'+kind+'-worker-1' for kind in KINDS}
ROOT=Path(__file__).resolve().parents[2]


def validate_worker(row,kind):
    labels=row.get('Config',{}).get('Labels') or {}
    if kind not in KINDS or row.get('Name')!='/'+NAMES[kind] or labels.get('com.docker.compose.project')!='village-platform' or labels.get('com.docker.compose.service')!=kind+'-worker' or row.get('Config',{}).get('User')!='10001:10001' or not row.get('State',{}).get('Running') or not re.fullmatch('sha256:[a-f0-9]{64}',row.get('Image','')):
        raise ValueError('EXISTING_CAMPUS_WORKER_IDENTITY_REQUIRED')
    if 'village-platform_egress' not in row.get('NetworkSettings',{}).get('Networks',{}):raise ValueError('WORKER_EGRESS_NETWORK_REQUIRED')


def overlay(images,key_root):
    if set(images)!=set(KINDS) or any(not re.fullmatch('sha256:[a-f0-9]{64}',value) for value in images.values()):raise ValueError('EXACT_LOCAL_WORKER_IMAGES_REQUIRED')
    return {'services':{kind+'-worker':{'image':images[kind],'environment':{
        'VILLAGE_TASK_BACKEND':'aliyun','VILLAGE_LOCAL_ORIGIN':'https://8.148.248.237','VILLAGE_WORKER_KEY_FILE':'/run/secrets/aliyun-worker-key',
        'SUPABASE_URL':'','SUPABASE_SERVICE_ROLE_KEY':''},'volumes':[{'type':'bind','source':str(Path(key_root)/('aliyun-'+kind+'.key')),
            'target':'/run/secrets/aliyun-worker-key','read_only':True,'bind':{'create_host_path':False}}]} for kind in KINDS}}


def compose_args(root,extra=None):
    args=['compose','--project-name','village-platform','--project-directory',str(root),'--env-file',str(Path(root)/'linux/gpu.env'),'-f',str(Path(root)/'linux/compose.gpu.yaml')]
    return args+(['-f',str(extra)] if extra else [])


def update_args(root,extra):return compose_args(root,extra)+['up','-d','--no-deps','--no-build','--pull','never','geo-worker','facade-worker']


def assert_others(before,after):
    if before!=after:raise ValueError('OTHER_CONTAINER_CHANGED')


def other_containers(docker):
    identifiers=docker.run('ps','-aq').split();rows=json.loads(docker.run('inspect',*identifiers)) if identifiers else []
    return {row['Name']:{'Id':row['Id'],'Image':row['Image'],'State':{'Running':row['State']['Running']}} for row in rows if row['Name'] not in ['/'+value for value in NAMES.values()]}


def credentials(bundle,state):
    bundle=storage.private_path(bundle)
    if bundle.stat().st_size>65536:raise ValueError('FIXED_WORKER_CREDENTIAL_BUNDLE_REQUIRED')
    root=Path(state)/'credentials'
    if root.exists():raise ValueError('RETAIN_EXISTING_WORKER_INPUTS')
    root.mkdir(mode=0o700)
    expected={'aliyun-'+kind+ext for kind in KINDS for ext in ('.key','.json')}
    with tarfile.open(bundle,'r:gz') as tar:
        members=tar.getmembers()
        if len(members)!=4 or {m.name for m in members}!=expected or any(not m.isfile() or m.size>4096 for m in members):raise ValueError('FIXED_WORKER_CREDENTIAL_BUNDLE_REQUIRED')
        for member in members:
            with os.fdopen(os.open(root/member.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:output.write(tar.extractfile(member).read())
    provision=load_script('provision-local-workers')
    for kind in KINDS:provision.credential(root,kind)
    return root


def install_keys(source,destination,state):
    # stdin carries key bytes. No raw credentials in arguments, stdout or logs.
    script='''import hashlib,json,os,re,sys
from pathlib import Path
root=Path(sys.argv[1]);assert re.fullmatch(r'/etc/village-platform/aliyun-[a-f0-9]{12}',str(root))
assert not any(p.is_symlink() for p in (root,*root.parents))
if not root.exists():root.mkdir(mode=0o700)
s=root.stat();assert s.st_uid==0 and s.st_mode&0o777==0o700
values=json.load(sys.stdin);assert set(values)=={'geo','facade'}
for kind,value in values.items():
 assert re.fullmatch(r'village_worker_[a-f0-9-]{36}\\.[A-Za-z0-9_-]{43}\\n',value)
 p=root/('aliyun-'+kind+'.key');assert not p.is_symlink()
 if p.exists():
  s=p.stat();assert s.st_uid==10001 and s.st_gid==10001 and s.st_mode&0o777==0o600 and s.st_nlink==1 and p.read_text()==value
 else:
  fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.fchown(fd,10001,10001)
  with os.fdopen(fd,'w') as f:f.write(value);f.flush();os.fsync(f.fileno())
'''
    log=Path(state)/'key-install-error.log'
    with os.fdopen(os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as errors:
        result=subprocess.run(['sudo','-n','python3','-c',script,str(destination)],input=json.dumps({kind:storage.private_path(source/('aliyun-'+kind+'.key')).read_text() for kind in KINDS}).encode(),stdout=subprocess.DEVNULL,stderr=errors,env=clean_environment(),timeout=30)
    if result.returncode:raise ValueError('PRIVATE_WORKER_KEY_INSTALL_FAILED')


def snapshot_worker(row):
    return {'user':row['Config']['User'],'mounts':sorted((m['Source'],m['Destination'],m.get('RW')) for m in row['Mounts'] if m['Destination']!='/run/secrets/aliyun-worker-key'),
        'networks':sorted(row['NetworkSettings']['Networks']),'cmd':row['Config'].get('Cmd'),'entrypoint':row['Config'].get('Entrypoint')}


def validate_rendered(row,service,networks,image):
    actual=row['Config'];base=image['Config']
    env=dict(value.split('=',1) for value in base.get('Env',[]) if '=' in value)
    env.update(service.get('environment',{}));env={k:str(v) for k,v in env.items() if v is not None}
    current=dict(value.split('=',1) for value in actual.get('Env',[]) if '=' in value)
    mounts=[]
    for mount in service.get('volumes',[]):
        if mount.get('type')!='bind':raise ValueError('EXISTING_BIND_MOUNTS_REQUIRED')
        mounts.append((str(PurePosixPath(mount['source'])),mount['target'],not mount.get('read_only',False)))
    if env!=current or sorted(mounts)!=snapshot_worker(row)['mounts'] or sorted(networks[name]['name'] for name in service.get('networks',{}))!=snapshot_worker(row)['networks']:
        raise ValueError('RENDERED_WORKER_RESOURCES_DIFFER')
    for key,field in [('command','Cmd'),('entrypoint','Entrypoint')]:
        if service.get(key,base.get(field))!=actual.get(field):raise ValueError('RENDERED_WORKER_PIPELINE_DIFFERS')
    if service.get('user',base.get('User'))!=actual['User'] or bool(service.get('read_only'))!=row['HostConfig'].get('ReadonlyRootfs') or sorted(service.get('cap_drop',[]))!=sorted(row['HostConfig'].get('CapDrop') or []):raise ValueError('RENDERED_WORKER_SECURITY_DIFFERS')


def verify(docker,receipt):
    for kind in KINDS:
        row=docker.inspect(NAMES[kind]);validate_worker(row,kind)
        if row['Image']!=receipt['images'][kind] or snapshot_worker(row)!=receipt['workers'][kind]:raise ValueError('WORKER_RUNTIME_DIFFERS')
        # Use the actual container's CA/network/key/UID. This reads sources only;
        # it does not claim, submit, cancel or run a GPU task.
        command="from village_processing.local_task_http import LocalTaskHTTP; h=LocalTaskHTTP(key_file='/run/secrets/aliyun-worker-key',kind='"+kind+"'); h.call('sources'); h.close()"
        docker.run('exec',NAMES[kind],'python','-c',command,timeout=150)
    assert_others(receipt['others'],other_containers(docker))


def install(docker,state,bundle,commit,*,apply=False):
    rows={kind:docker.inspect(NAMES[kind]) for kind in KINDS}
    for kind,row in rows.items():validate_worker(row,kind)
    network=json.loads(docker.run('network','inspect','village-platform_egress'))[0]
    if network.get('Internal'):raise ValueError('WORKER_REAL_EGRESS_REQUIRED')
    config=json.loads(docker.run(*compose_args(ROOT),'config','--format','json'))
    for kind,row in rows.items():
        service=config['services'][kind+'-worker'];image=json.loads(docker.run('image','inspect',service['image']))[0]
        if image['Id']!=row['Image'] or service.get('user')!='10001:10001':raise ValueError('GPU_ENV_DOES_NOT_MATCH_RUNNING_WORKERS')
        validate_rendered(row,service,config['networks'],image)
    # HTTPS reaches the already accepted public site from inside each old
    # worker, before any recreation. Disable ambient proxies and redirects.
    check="import urllib.request; from urllib.error import HTTPError; o=urllib.request.build_opener(urllib.request.ProxyHandler({})); r=o.open('https://8.148.248.237/deployment-config.js',timeout=15); v=r.read(16384); assert b'local' in v and b'aliyun-village' in v"
    for kind in KINDS:docker.run('exec',NAMES[kind],'python','-c',check,timeout=30)
    if not apply:return {'status':'campus_preflight_only_not_switched'}
    before=other_containers(docker);source=credentials(bundle,state);key_root=Path('/etc/village-platform')/('aliyun-'+commit[:12])
    install_keys(source,key_root,state)
    context=state/'build';(context/'server/src').mkdir(parents=True,mode=0o700)
    shutil.copytree(ROOT/'server/src/village_processing',context/'server/src/village_processing',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    shutil.copy2(ROOT/'linux/Dockerfile.worker-local-overlay',context/'Dockerfile')
    images={}
    for kind in KINDS:
        tag='village-'+kind+'-aliyun:'+commit[:12]
        base='village-'+kind+'-existing:'+rows[kind]['Image'][7:19]
        docker.run('tag',rows[kind]['Image'],base)
        docker.run('build','--pull=false','--network=none','--build-arg','BASE_IMAGE='+base,'--label','village.autonomous.worker='+commit,'-t',tag,context,timeout=300)
        image=json.loads(docker.run('image','inspect',tag))[0]
        if image.get('Architecture')!='amd64' or image.get('Os')!='linux':raise ValueError('WORKER_IMAGE_PLATFORM_DIFFERS')
        images[kind]=image['Id']
        docker.run('run','--rm','--pull=never','--network','none','--entrypoint','python',image['Id'],'-c','from village_processing.queue.local_gateway import LocalGeoGateway; from village_processing.facade.local_gateway import LocalFacadeGateway')
    receipt={'version':1,'commit':commit,'images':images,'workers':{kind:snapshot_worker(row) for kind,row in rows.items()},'others':before,'status':'pending'}
    storage.write_private_json(state/'workers-switch.json',receipt);path=state/'overlay.json';storage.write_private_json(path,overlay(images,key_root))
    # Check other services again before the only mutation of existing containers.
    assert_others(before,other_containers(docker));docker.run(*update_args(ROOT,path),timeout=180)
    time.sleep(3);verify(docker,receipt);receipt['status']='two_workers_https_verified_real_gpu_jobs_pending';storage.write_private_json(state/'workers-switch.json',receipt)
    return {'status':receipt['status'],'changed_services':2,'other_containers_unchanged':True}


def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group(required=True)
    g.add_argument('--check',action='store_true');g.add_argument('--apply',action='store_true');g.add_argument('--verify',action='store_true')
    p.add_argument('--credentials',type=Path);p.add_argument('--source-workers-idle',action='store_true');a=p.parse_args()
    try:
        os.umask(0o077);state=Path.home()/'village-campus-autonomous';state.mkdir(mode=0o700,exist_ok=True)
        with operation_lock(state):
            docker=Docker(state)
            if a.verify:
                verify(docker,storage.read_private_json(state/'workers-switch.json'));print('CAMPUS_HTTPS_WORKERS_VERIFIED_REAL_GPU_JOBS_PENDING');return 0
            if (state/'workers-switch.json').exists():raise ValueError('EXISTING_WORKER_SWITCH_REQUIRES_VERIFY')
            if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,env=clean_environment()).strip():raise ValueError('CLEAN_CAMPUS_SOURCE_REQUIRED')
            commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
            if a.apply and (not a.credentials or not a.source_workers_idle):raise ValueError('IDLE_SOURCE_WORKERS_AND_PRIVATE_BUNDLE_REQUIRED')
            print(json.dumps(install(docker,state,a.credentials,commit,apply=a.apply)));return 0
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError,tarfile.TarError) as error:
        category=str(error) if re.fullmatch('[A-Z0-9_]{1,100}',str(error)) else 'CHECK_FAILED'
        print('STOP: CAMPUS_AUTONOMOUS_SWITCH_FAILED category='+category+'. Keep private receipts/logs and original images; no automatic source fallback or reset.');return 1


if __name__=='__main__':raise SystemExit(main())
