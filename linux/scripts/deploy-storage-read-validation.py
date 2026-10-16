#!/usr/bin/env python3
"""Create/verify a separate loopback file-read candidate. Never restore or mutate DB."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sys
import time
import urllib.request

S=Path(__file__).resolve().parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,S/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
deploy=load('storage_read_a','deploy-business-api-validation.py')
copy=load('storage_read_copy','business_storage_copy.py')
builder=load('storage_read_builder','build-business-api-image.py')
ROOT=deploy.ROOT
IMAGE='village-business-api:stage-b2-read'
CONTAINER='village-storage-validation-api'
PROJECT='village-storage-read-validation'
SOURCE_STATE=Path.home()/'village-api-validation'
STATE=Path.home()/'village-storage-api-validation'
RUN=Path.home()/'village-storage-copy/stage-b1'

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def prepare_index(run,archive_sha):
    lock=copy.acquire_transfer_lock(run)
    try:
        doc,objects,manifest=copy.load_transfer(run)
        if doc['source_archive_sha256']!=archive_sha or not objects or any(r['status']!='copied' for r in manifest['records'].values()):
            raise ValueError('Require a complete B1 copy from the accepted database archive.')
        rows=[]
        for o in objects:
            r=manifest['records'][o['id']]
            if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',o['id']) or r['received_bytes']>52428800:
                raise ValueError('Unsupported object UUID/size for read candidate.')
            rows.append({k:o[k] for k in ('id','bucket','name')}|{'sha256':r['sha256'],'size':r['received_bytes']})
        return {'version':1,'source_archive_sha256':archive_sha,'objects':rows}
    finally:lock.unlink()

def validate_database_objects(index,rows):
    expected=sorted((o['id'],o['bucket'],o['name']) for o in index['objects'])
    actual=sorted((o['id'],o['bucket'],o['name']) for o in rows)
    if actual!=expected:raise ValueError('Candidate object identities differ from verified file copy.')

def compose_document(state,source_state,run,*,uid,gid,key):
    if uid<=0 or gid<0:raise ValueError('Nonroot admin required.')
    base=deploy.runtime_compose(source_state,Path('/unused'),uid=uid,gid=gid,publishable_key=key)['services']['api']
    base.update(image=IMAGE,container_name=CONTAINER,ports=['127.0.0.1:18081:8080'])
    base.pop('depends_on')
    base['environment'].update(PGHOST='village-api-validation-postgres',STORAGE_READ_ENABLED='1')
    base['volumes']+=[{'type':'bind','source':str(p),'target':t,'read_only':True,'bind':{'create_host_path':False}}
        for p,t in [(Path(state)/'storage-index.json','/run/storage/index.json'),(Path(run)/'blobs','/srv/business-storage/blobs')]]
    return {'name':PROJECT,'services':{'api':base},'networks':{n:{'external':True,'name':deploy.TARGET.project+'_'+n} for n in ('dbnet','authegress')}}

def source_context(docker):
    compose=copy.read_private_json(SOURCE_STATE/'runtime-compose.json')
    backup=Path(compose['services']['db']['volumes'][-1]['source'])
    fingerprint=deploy.runtime_fingerprint(docker,SOURCE_STATE,backup)
    checkpoint=copy.read_private_json(SOURCE_STATE/'deployment-checkpoint.json')
    proof=copy.read_private_json(SOURCE_STATE/'candidate-verification.json')
    acceptance=copy.read_private_json(SOURCE_STATE/'api-acceptance.json')
    if (proof.get('status')!='permissions_restart_verified' or proof.get('runtime_fingerprint')!=fingerprint
        or acceptance.get('status')!='internal_validated_not_cut_over' or acceptance.get('verification_attempt_id')!=proof.get('attempt_id')
        or proof.get('source_archive_sha256')!=checkpoint['source_archive_sha256']):
        raise ValueError('Require the accepted unchanged A runtime before adding a read candidate.')
    return {'backup':backup,'fingerprint':fingerprint,'archive_sha256':checkpoint['source_archive_sha256']}

def database_contract(docker,index):
    result=json.loads(docker.sql("""SELECT json_build_object(
     'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass),
     'select',has_table_privilege('authenticated','storage.objects','SELECT'),
     'schema',has_schema_privilege('authenticated','storage','USAGE'),
     'safe_role',(SELECT count(*)=2 AND bool_and(NOT rolsuper AND NOT rolbypassrls) FROM pg_roles WHERE rolname IN ('authenticated','village_api_login')));"""))
    if result!={'rls':True,'select':True,'schema':True,'safe_role':True}:raise ValueError('Storage access role/RLS contract differs.')
    rows=json.loads(docker.sql("SELECT coalesce(json_agg(json_build_object('id',id,'bucket',bucket_id,'name',name)),'[]'::json) FROM storage.objects WHERE bucket_id IN ('house-photos','group-models','scene-assets','scene-version-previews','village-datasets');"))
    validate_database_objects(index,rows)
    # Parse and execute the exact repository query through the real API role/TCP.
    # An all-zero UUID selects no object; this verifies tables/helpers/privileges,
    # without making synthetic rows or returning business metadata.
    script="""import {loadConfig} from './src/config.mjs';import {createDatabase} from './src/database.mjs';import {getStorageObject} from './src/repository.mjs';
const db=createDatabase(loadConfig().database);try{await db.withIdentity({userId:'00000000-0000-0000-0000-000000000000'},c=>getStorageObject(c,'00000000-0000-0000-0000-000000000000'));console.log('STORAGE_DATABASE_CONTRACT_OK');}finally{await db.close();}"""
    return script

def image_metadata():
    m=json.loads((ROOT/'linux/storage-read-image.json').read_text())
    if m['image']!=IMAGE or m['os']!='linux' or m['architecture']!='amd64' or m['code_sha256']!=builder.code_digest(ROOT/'business-api'):
        raise ValueError('B2 image metadata does not match current source.')
    return m

def verify_image(docker):
    meta=image_metadata();image=json.loads(docker.run(['image','inspect',IMAGE]))[0]
    if (image['Id'] not in meta['accepted_image_ids'] or (image['Os'],image['Architecture'])!=('linux','amd64')
        or (image.get('Config',{}).get('Labels') or {}).get('village.api.code-sha256')!=meta['code_sha256']):
        raise ValueError('Load the verified B2 image first.')
    return image

def new_state_guard(state):
    state=deploy.no_links(state)
    for p in (SOURCE_STATE,RUN,ROOT,Path.home()/'village-deploy',Path.home()/'village-db-backups'):
        p=deploy.no_links(p)
        if state==p or state in p.parents or p in state.parents:raise ValueError('Read candidate overlaps protected data.')
    if state.exists():raise ValueError('Read candidate state exists; retain it. Use --verify after a successful deployment.')

def preflight(docker):
    new_state_guard(STATE)
    ctx=source_context(docker);index=prepare_index(RUN,ctx['archive_sha256']);database_contract(docker,index);image=verify_image(docker)
    if CONTAINER in docker.run(['ps','-a','--format','{{.Names}}']).splitlines():raise ValueError('Read candidate container already exists.')
    available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])*1024
    if available<256*1024**2 or shutil.disk_usage(Path.home()).free<4*1024**3:raise ValueError('Require 256 MiB available memory and 4 GiB free disk.')
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1',18081))==0:raise ValueError('Loopback port 18081 is already in use.')
    return ctx,index,image

def validate_container(info,spec,image_config,image_id,*,uid):
    c=info.get('Config',{});h=info.get('HostConfig',{});labels=c.get('Labels') or {}
    if (info.get('Image')!=image_id or c.get('Image')!=IMAGE or labels.get('com.docker.compose.project')!=PROJECT
        or labels.get('com.docker.compose.service')!='api' or c.get('User')!=spec['user'] or int(c['User'].split(':')[0])!=uid
        or (c.get('Cmd') or [])!=(image_config.get('Cmd') or []) or (c.get('Entrypoint') or [])!=(image_config.get('Entrypoint') or [])
        or c.get('WorkingDir')!=image_config.get('WorkingDir') or not h.get('ReadonlyRootfs') or h.get('Privileged')
        or h.get('CapAdd') or sorted(h.get('CapDrop') or [])!=['ALL'] or sorted(h.get('SecurityOpt') or [])!=['no-new-privileges:true']
        or h.get('PidMode')=='host' or h.get('IpcMode')=='host' or h.get('Memory')!=192*1024**2 or h.get('MemorySwap')!=192*1024**2
        or h.get('NanoCpus')!=500000000 or h.get('PidsLimit')!=64
        or h.get('PortBindings')!={'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18081'}]}):
        raise ValueError('B2 container image, execution, limits or isolation differs.')
    env=dict(e.split('=',1) for e in c.get('Env',[]))
    if env!={**dict(e.split('=',1) for e in image_config.get('Env',[])),**spec['environment']}:raise ValueError('B2 environment differs.')
    mounts=info.get('Mounts',[])
    if len(mounts)!=len(spec['volumes']):raise ValueError('Unexpected B2 mounts.')
    for v in spec['volumes']:
        matches=[m for m in mounts if m['Destination']==v['target']]
        if len(matches)!=1 or matches[0]['Type']!='bind' or matches[0]['RW'] or deploy.no_links(matches[0]['Source'])!=deploy.no_links(v['source']):raise ValueError('B2 private mounts differ.')
    if set(info.get('NetworkSettings',{}).get('Networks',{}))!={deploy.TARGET.project+'_'+n for n in ('dbnet','authegress')}:
        raise ValueError('B2 network membership differs.')

def validate_runtime(docker):
    copy.private_path(STATE,directory=True)
    ctx=source_context(docker);checkpoint=copy.read_private_json(STATE/'deployment-checkpoint.json')
    index=copy.read_private_json(STATE/'storage-index.json')
    if (digest(index)!=checkpoint['index_sha256'] or index!=prepare_index(RUN,ctx['archive_sha256'])
        or checkpoint['source_fingerprint']!=ctx['fingerprint']):raise ValueError('B2 index/source proof differs.')
    image=verify_image(docker)
    if image['Id']!=checkpoint['api_image_id']:raise ValueError('B2 image checkpoint differs.')
    spec=compose_document(STATE,SOURCE_STATE,RUN,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_public_key())
    if copy.read_private_json(STATE/'compose.json')!=spec:raise ValueError('B2 Compose changed.')
    info=json.loads(docker.run(['inspect',CONTAINER]))[0]
    validate_container(info,spec['services']['api'],image['Config'],image['Id'],uid=os.geteuid())
    for n,internal in [('dbnet',True),('authegress',False)]:
        if json.loads(docker.run(['network','inspect',deploy.TARGET.project+'_'+n]))[0].get('Internal') is not internal:
            raise ValueError('B2 shared network isolation differs.')
    return ctx,index,info

def runtime_fingerprint(docker):
    ctx,index,info=validate_runtime(docker)
    return digest({'source':ctx['fingerprint'],'id':info['Id'],'image':info['Image'],'started_at':info['State']['StartedAt'],'index':digest(index)})

def ready(docker):
    for _ in range(45):
        info=json.loads(docker.run(['inspect',CONTAINER]))[0]
        if not info['State']['Running']:raise ValueError('B2 API stopped; retain state and logs.')
        if info['State'].get('Health',{}).get('Status')=='healthy':return
        time.sleep(1)
    raise ValueError('B2 health timeout; retain state and inspect.')

def deploy_candidate(docker):
    ctx,index,image=preflight(docker)
    STATE.mkdir(mode=0o700)
    copy.write_private_json(STATE/'storage-index.json',index)
    copy.write_private_json(STATE/'deployment-checkpoint.json',{'version':1,'api_image_id':image['Id'],'source_fingerprint':ctx['fingerprint'],'source_archive_sha256':ctx['archive_sha256'],'index_sha256':digest(index)})
    copy.write_private_json(STATE/'compose.json',compose_document(STATE,SOURCE_STATE,RUN,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_public_key()))
    docker.state=STATE;docker.phase='storage-read-start'
    docker.run(['compose','-f',str(STATE/'compose.json'),'up','-d','--pull','never','--no-build','api'])
    ready(docker);validate_runtime(docker)
    print('STORAGE_READ_INTERNAL_DEPLOYED_NOT_ACCEPTED - run --verify and login probe next.')

def verify_candidate(docker):
    validate_runtime(docker)
    for name in ('verification.json','acceptance.json'):
        path=STATE/name
        if path.exists():copy.private_path(path).rename(STATE/(name+'.previous-'+secrets.token_hex(8)))
    docker.phase='storage-read-restart'
    docker.run(['compose','-f',str(STATE/'compose.json'),'restart','api']);ready(docker)
    ctx,index,_=validate_runtime(docker)
    script=database_contract(docker,index)
    out=docker.run(['exec','-i',CONTAINER,'node','--input-type=module','-'],input=script)
    if out.strip()!='STORAGE_DATABASE_CONTRACT_OK':raise ValueError('B2 database contract probe failed.')
    with urllib.request.urlopen('http://127.0.0.1:18081/healthz',timeout=5) as response:
        if json.load(response)!={'status':'ok'}:raise ValueError('B2 loopback health differs.')
    copy.write_private_json(STATE/'verification.json',{'status':'restart_verified','attempt_id':secrets.token_hex(16),'verified_at':time.time(),'runtime_fingerprint':runtime_fingerprint(docker),'objects':len(index['objects'])})
    print('STORAGE_READ_RESTART_VERIFIED - website login file probe still required.')

def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group(required=True)
    for mode in ('check','deploy','verify'):g.add_argument('--'+mode,action='store_true')
    args=p.parse_args();os.umask(0o077)
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('Use the normal admin user on Aliyun Linux.')
        docker=deploy.rd.LocalDocker(STATE,target=deploy.TARGET)
        if args.check:preflight(docker);print('STORAGE_READ_PREFLIGHT_OK - no containers or database data changed.')
        elif args.deploy:deploy_candidate(docker)
        else:verify_candidate(docker)
        return 0
    except (ValueError,RuntimeError,OSError,KeyError,TypeError):
        print('STOP: storage read candidate not accepted. Retain private state/logs; do not reset, delete or expose files.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
