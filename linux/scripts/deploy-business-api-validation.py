#!/usr/bin/env python3
"""Guarded, manual Aliyun deployment of the internal read-only API candidate."""
import argparse
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('restore_copy',ROOT/'linux/scripts/restore-db-copy.py')
rd=importlib.util.module_from_spec(spec);spec.loader.exec_module(rd)
TARGET=rd.select_target('api-validation')
API='village-api-validation-api'
API_IMAGE='village-business-api:stage-a1'

def no_links(path):
    path=Path(path).absolute()
    if any(p.is_symlink() for p in (path,*path.parents)):
        raise ValueError('Linked state paths are not accepted.')
    return path.resolve()

def private_file(path):
    path=no_links(path)
    st=path.stat()
    if not path.is_file() or (sys.platform=='linux' and (st.st_uid!=os.geteuid() or st.st_mode&0o077)):
        raise ValueError('State/report/credential files must be private and owned by the operator.')
    return path

def validate_new_state(state,backup,baseline,repo):
    state=no_links(state)
    for p in (backup,baseline,repo,Path.home()/'village-deploy'):
        p=no_links(p)
        if state==p or state in p.parents or p in state.parents:
            raise ValueError('Candidate must be separate from baseline, backup and web/source directories.')
    if state.exists():raise ValueError('Candidate already exists; retain it and inspect, never reset or overwrite.')
    return state

def read_public_key():
    match=re.search(r'^const SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"\r\n]+)";', (ROOT/'app.js').read_text(encoding='utf-8'),re.M)
    if not match:raise ValueError('Public Auth configuration unavailable.')
    return match[1]

def runtime_compose(state,backup,*,uid,gid,publishable_key):
    if uid<=0 or gid<0:raise ValueError('Run as the normal admin user, not root.')
    doc=rd.compose_document(Path(state)/'db',Path(backup),target=TARGET)
    db=doc['services']['db'];db.pop('network_mode');db['networks']=['dbnet']
    doc['networks']={'dbnet':{'internal':True},'authegress':{}}
    doc['services']['api']={
        'image':API_IMAGE,'pull_policy':'never','container_name':API,'user':f'{uid}:{gid}',
        'read_only':True,'restart':'unless-stopped','mem_limit':'192m','memswap_limit':'192m',
        'cpus':0.5,'pids_limit':64,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],
        'tmpfs':['/tmp:size=16m,mode=1777'],'networks':['dbnet','authegress'],
        'ports':['127.0.0.1:18080:8080'],
        'environment':{'NODE_ENV':'production','NODE_OPTIONS':'--max-old-space-size=96',
          'SUPABASE_AUTH_ORIGIN':'https://rzmbmwauomzwiyenafha.supabase.co','SUPABASE_PUBLISHABLE_KEY':publishable_key,
          'PGHOST':'db','PGPORT':'5432','PGDATABASE':'village_copy','PGUSER':'village_api_login',
          'PGPASSWORD_FILE':'/run/secrets/api-password','PORT':'8080'},
        'volumes':[{'type':'bind','source':str(Path(state)/'api-password'),'target':'/run/secrets/api-password','read_only':True,'bind':{'create_host_path':False}}],
        'depends_on':{'db':{'condition':'service_healthy'}},
        'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],'interval':'5s','timeout':'3s','retries':20},
        'logging':{'driver':'local','options':{'max-size':'5m','max-file':'3'}}}
    return doc

def preflight(backup,state,baseline,docker):
    validate_new_state(state,backup,baseline,ROOT)
    backup=no_links(backup);baseline=no_links(baseline)
    manifest=rd.verify_backup(backup)
    report=json.loads(private_file(baseline/'restore-result.json').read_text())
    if (report.get('status')!='isolated_restore_validated_not_cut_over'
        or report.get('source_archive_sha256')!=manifest['files']['database.dump']['sha256']):
        raise ValueError('Verified baseline does not match the selected backup.')
    if json.loads(private_file(baseline/'compose.yaml').read_text())!=rd.compose_document(baseline,backup):
        raise ValueError('Baseline Compose differs from the verified copy.')
    private_file(baseline/'bootstrap-password')
    no_links(baseline/'data')
    info=json.loads(docker.run(['inspect',rd.CONTAINER]))[0]
    rd.validate_resume_container(info,baseline,backup)
    names=docker.run(['ps','-a','--format','{{.Names}}']).splitlines()
    if TARGET.container in names or API in names:raise ValueError('Candidate container already exists; retain it.')
    pgimage=json.loads(docker.run(['image','inspect',rd.IMAGE]))[0]
    if pgimage['Id'] not in rd.IMAGE_IDS or (pgimage['Os'],pgimage['Architecture'])!=('linux','amd64'):
        raise ValueError('Unverified database image.')
    expected=json.loads((ROOT/'linux/business-api-image.json').read_text())
    image=json.loads(docker.run(['image','inspect',API_IMAGE]))[0]
    if image['Id'] not in expected['accepted_image_ids'] or (image['Os'],image['Architecture'])!=('linux','amd64'):
        raise ValueError('Load the verified API image before deployment.')
    if (image.get('Config',{}).get('Labels') or {}).get('village.api.code-sha256')!=expected['code_sha256']:
        raise ValueError('API image code identity differs.')
    available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])*1024
    if available<900*1024**2 or shutil.disk_usage(Path.home()).free<4*1024**3:
        raise ValueError('Require 900 MiB available memory and 4 GiB free disk before stopping the baseline.')
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1',18080))==0:raise ValueError('Loopback port 18080 is already in use.')
    return {'baseline_restart_policy':info['HostConfig']['RestartPolicy']['Name'],
            'baseline_was_running':bool(info['State']['Running']),
            'source_archive_sha256':report['source_archive_sha256'],'api_image_id':image['Id']}

def validate_runtime(docker,state,backup):
    state=no_links(state)
    private_file(state/'deployment-checkpoint.json')
    expected=runtime_compose(state,backup,uid=os.geteuid(),gid=os.getegid(),publishable_key=read_public_key())
    if json.loads(private_file(state/'runtime-compose.json').read_text())!=expected:raise ValueError('Runtime Compose changed; inspect before operating.')
    info=json.loads(docker.run(['inspect',TARGET.container]))[0]
    labels=info.get('Config',{}).get('Labels') or {}
    if info['Image'] not in rd.IMAGE_IDS or labels.get('com.docker.compose.project')!=TARGET.project or info['HostConfig'].get('PortBindings'):
        raise ValueError('Candidate identity or isolation differs.')
    mounts={m['Destination']:m for m in info.get('Mounts',[])}
    for v in expected['services']['db']['volumes']:
        actual=mounts.get(v['target'])
        if not actual or Path(actual['Source']).resolve()!=Path(v['source']).resolve() or actual['RW']!=not_read_only(v):
            raise ValueError('Candidate data/credential/backup mounts differ.')
    api=json.loads(docker.run(['inspect',API]))[0]
    if (api.get('Config',{}).get('Labels') or {}).get('com.docker.compose.project')!=TARGET.project:
        raise ValueError('Wrong API container.')
    binding=api['HostConfig'].get('PortBindings') or {}
    if binding!={'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18080'}]}:
        raise ValueError('API must be loopback-only.')
    return info

def not_read_only(volume):return not volume.get('read_only',False)

def deploy(backup,state,baseline):
    docker=rd.LocalDocker(state,target=TARGET)
    checkpoint=preflight(backup,state,baseline,docker)
    state.mkdir(mode=0o700);(state/'deployment-checkpoint.json').write_text(json.dumps(checkpoint,indent=2))
    docker.phase='baseline-stop'
    docker.run(['update','--restart=no',rd.CONTAINER]);docker.run(['stop',rd.CONTAINER])
    # The baseline is retained, and no candidate restore is allowed to overwrite data.
    rd.restore(backup,state/'db',target_profile='api-validation')
    docker.state=state/'db';docker.phase='candidate-credentials'
    password=secrets.token_urlsafe(36)
    sql=(ROOT/'linux/sql/business-api-validation.sql').read_text()
    docker.exec('psql','-X','-w','-v','ON_ERROR_STOP=1','--single-transaction','-h','/var/run/postgresql','-U',rd.ADMIN,'-d',rd.DATABASE,'-f','-',input=sql+"\nALTER ROLE village_api_login PASSWORD '"+password+"';\n")
    secret=state/'api-password'
    with secret.open('x',encoding='ascii') as stream:stream.write(password+'\n')
    doc=runtime_compose(state,backup,uid=os.geteuid(),gid=os.getegid(),publishable_key=read_public_key())
    config=state/'runtime-compose.json';config.write_text(json.dumps(doc,indent=2)+'\n')
    docker.state=state;docker.phase='candidate-network'
    docker.run(['compose','-f',str(config),'create','--force-recreate','--pull','never','db'])
    network=json.loads(docker.run(['network','inspect',TARGET.project+'_dbnet']))[0]
    if not network.get('Internal'):raise ValueError('Candidate database network is not internal.')
    subnet=next((ipaddress.ip_network(c['Subnet']) for c in network['IPAM']['Config'] if ':' not in c['Subnet']),None)
    if subnet is None:raise ValueError('IPv4 internal database subnet not found.')
    hba=f'local all all trust\nhost village_copy village_api_login {subnet} scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'
    docker.run(['run','--rm','-i','--pull=never','--network','none','--user','0',
      '--mount','type=bind,src='+str(state/'db/data')+',dst=/target',
      '--entrypoint','sh',rd.IMAGE,'-c','cat > /target/pg_hba.conf'],input=hba)
    docker.run(['compose','-f',str(config),'up','-d','--pull','never','--wait','--wait-timeout','120'])
    validate_runtime(docker,state,backup)
    with urllib.request.urlopen('http://127.0.0.1:18080/healthz',timeout=5) as response:
        if json.load(response)!={'status':'ok'}:raise ValueError('API health check failed.')
    (state/'deployment-ready.json').write_text(json.dumps({'status':'internal_deployed_not_accepted_not_cut_over',**checkpoint},indent=2))
    print('BUSINESS_API_INTERNAL_DEPLOYED_NOT_ACCEPTED - run candidate verification and login probe next.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-dir',required=True,type=Path)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--check',action='store_true');mode.add_argument('--deploy',action='store_true');mode.add_argument('--stop',action='store_true')
    args=parser.parse_args();os.umask(0o077)
    state=Path.home()/'village-api-validation';baseline=Path.home()/'village-db-copy'
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('Run in the Aliyun terminal as admin with sudo, not as root.')
        backup=no_links(args.backup_dir);docker=rd.LocalDocker(state,target=TARGET)
        if args.stop:
            validate_runtime(docker,state,backup)
            docker.run(['update','--restart=no',API,TARGET.container]);docker.run(['stop',API,TARGET.container])
            print('Candidate stopped; all data retained. Baseline remains stopped until separately verified.')
        elif args.deploy:deploy(backup,state,baseline)
        else:
            preflight(backup,state,baseline,docker)
            print('BUSINESS_API_PREFLIGHT_OK - no containers or data changed.')
        return 0
    except (ValueError,RuntimeError,OSError,KeyError) as error:
        if type(error) in (ValueError,RuntimeError):print('STOP: '+str(error),file=sys.stderr)
        else:print('STOP: invalid or missing deployment state/configuration.',file=sys.stderr)
        print('Keep baseline, candidate and private logs; no automatic retry/reset. Check whether baseline is stopped.',file=sys.stderr)
        return 1
if __name__=='__main__':raise SystemExit(main())
