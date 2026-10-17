#!/usr/bin/env python3
"""Create/verify a loopback file-read candidate and its own limited DB role; no business writes."""
import argparse
import datetime as dt
import hashlib
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
ROLE='village_storage_read_login'

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def utc_timestamp(value):
    timestamp=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    if timestamp.tzinfo is None:raise ValueError('Object timestamp must include timezone.')
    return timestamp.astimezone(dt.timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')

def object_identity(o):
    size=o['declared_size']
    if isinstance(size,str) and size.isascii() and size.isdigit():size=int(size)
    if size is not None and (type(size) is not int or not 0<=size<=2**53):raise ValueError('Invalid object metadata size.')
    return (o['id'],o['bucket'],o['name'],utc_timestamp(o['snapshot_updated_at']),size,o['snapshot_etag'],o['snapshot_version'])

def storage_hba(original):
    lines=original.splitlines()
    if len(lines)!=4 or lines[0]!='local all all trust' or lines[2:]!=['host all all 0.0.0.0/0 reject','host all all ::/0 reject']:
        raise ValueError('Unknown baseline HBA rules; refuse widening access.')
    m=re.fullmatch(r'host village_copy village_api_login ([0-9./]+) scram-sha-256',lines[1])
    if not m or not ipaddress.ip_network(m[1]).is_private:raise ValueError('Require baseline internal SCRAM subnet.')
    return '\n'.join([lines[0],lines[1],lines[1].replace('village_api_login',ROLE),*lines[2:]])+'\n'

def validate_hba(docker):
    wanted=storage_hba(deploy.restricted_hba(docker))
    # C1 can add precisely one different database/login pair. This never grants
    # the C1 login access to village_copy or widens existing A/B2 access.
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf') not in (wanted,scene_hba(wanted)):raise ValueError('B2/A internal SCRAM rules differ.')
    if docker.sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;').strip()!='0':raise ValueError('HBA parse errors; retain backup and inspect.')

def scene_hba(storage_rules):
    lines=storage_rules.splitlines()
    if len(lines)!=5:raise ValueError('Require original A/B2 rules before adding C1.')
    base='\n'.join([lines[0],lines[1],*lines[3:]])+'\n'
    if storage_hba(base)!=storage_rules:raise ValueError('Unknown A/B2 rules.')
    return '\n'.join([*lines[:3],lines[1].replace('village_copy village_api_login','village_scene_validation village_scene_login'),*lines[3:]])+'\n'

def install_hba(docker):
    original=deploy.restricted_hba(docker);wanted=storage_hba(original)
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=original:raise ValueError('HBA changed after preflight; refuse overwrite.')
    for name,text in [('pg_hba.before.conf',original),('pg_hba.expected.conf',wanted)]:
        with os.fdopen(os.open(STATE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as stream:stream.write(text)
    docker.phase='storage-read-hba'
    # Atomic replacement inside the already-validated candidate data mount.
    # Fixed shell text only; rules are stdin and no secrets enter the command.
    command=('set -eu; umask 077; '
      'test ! -e /var/lib/postgresql/data/.storage-read-hba.partial; '
      'cp -p /var/lib/postgresql/data/pg_hba.conf /var/lib/postgresql/data/.storage-read-hba.partial; '
      'cat > /var/lib/postgresql/data/.storage-read-hba.partial; '
      'mv /var/lib/postgresql/data/.storage-read-hba.partial /var/lib/postgresql/data/pg_hba.conf')
    docker.exec('sh','-c',command,input=wanted)
    if docker.sql('SELECT pg_reload_conf();').strip()!='t':raise ValueError('HBA reload was not accepted.')
    validate_hba(docker)

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
            row={k:o[k] for k in ('id','bucket','name','declared_size','snapshot_etag','snapshot_version')}
            row.update(snapshot_updated_at=utc_timestamp(o['snapshot_updated_at']),sha256=r['sha256'],size=r['received_bytes'])
            object_identity(row);rows.append(row)
        return {'version':1,'source_archive_sha256':archive_sha,'objects':rows}
    finally:lock.unlink()

def validate_database_objects(index,rows):
    expected=sorted(object_identity(o) for o in index['objects'])
    actual=sorted(object_identity(o) for o in rows)
    if actual!=expected:raise ValueError('Candidate object identities differ from verified file copy.')

def compose_document(state,source_state,run,*,uid,gid,key):
    if uid<=0 or gid<0:raise ValueError('Nonroot admin required.')
    base=deploy.runtime_compose(source_state,Path('/unused'),uid=uid,gid=gid,publishable_key=key)['services']['api']
    base.update(image=IMAGE,container_name=CONTAINER,ports=['127.0.0.1:18081:8080'])
    base.pop('depends_on')
    base['environment'].update(PGHOST='village-api-validation-postgres',PGUSER=ROLE,STORAGE_READ_ENABLED='1')
    base['volumes'][0]['source']=str(Path(state)/'api-password')
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
    rows=json.loads(docker.sql("""SELECT coalesce(json_agg(json_build_object('id',id,'bucket',bucket_id,'name',name,
      'snapshot_updated_at',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'declared_size',metadata->'size','snapshot_etag',metadata->>'eTag','snapshot_version',to_jsonb(o)->>'version')),'[]'::json)
      FROM storage.objects o WHERE bucket_id IN ('house-photos','group-models','scene-assets','scene-version-previews','village-datasets');"""))
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
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=deploy.restricted_hba(docker):raise ValueError('Require unchanged baseline HBA before deployment.')
    if docker.sql("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_storage_read_login');").strip()!='f':
        raise ValueError('B2 role already exists; retain state and inspect before deployment.')
    if CONTAINER in docker.run(['ps','-a','--format','{{.Names}}']).splitlines():raise ValueError('Read candidate container already exists.')
    available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])*1024
    if available<256*1024**2 or shutil.disk_usage(Path.home()).free<4*1024**3:raise ValueError('Require 256 MiB available memory and 4 GiB free disk.')
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1',18081))==0:raise ValueError('Loopback port 18081 is already in use.')
    return ctx,index,image

def validate_container(info,spec,image_config,image_id,*,uid,image_tag=IMAGE,project=PROJECT,port=18081):
    c=info.get('Config',{});h=info.get('HostConfig',{});labels=c.get('Labels') or {}
    if (info.get('Image')!=image_id or c.get('Image')!=image_tag or labels.get('com.docker.compose.project')!=project
        or labels.get('com.docker.compose.service')!='api' or c.get('User')!=spec['user'] or int(c['User'].split(':')[0])!=uid
        or (c.get('Cmd') or [])!=(image_config.get('Cmd') or []) or (c.get('Entrypoint') or [])!=(image_config.get('Entrypoint') or [])
        or c.get('WorkingDir')!=image_config.get('WorkingDir') or not h.get('ReadonlyRootfs') or h.get('Privileged')
        or h.get('CapAdd') or sorted(h.get('CapDrop') or [])!=['ALL'] or sorted(h.get('SecurityOpt') or [])!=['no-new-privileges:true']
        or h.get('PidMode')=='host' or h.get('IpcMode')=='host' or h.get('Memory')!=192*1024**2 or h.get('MemorySwap')!=192*1024**2
        or h.get('NanoCpus')!=500000000 or h.get('PidsLimit')!=64
        or h.get('PortBindings')!={'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':str(port)}]}):
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
    copy.private_path(STATE/'api-password')
    ctx=source_context(docker);checkpoint=copy.read_private_json(STATE/'deployment-checkpoint.json')
    index=copy.read_private_json(STATE/'storage-index.json')
    if (digest(index)!=checkpoint['index_sha256'] or index!=prepare_index(RUN,ctx['archive_sha256'])
        or checkpoint['source_fingerprint']!=ctx['fingerprint']):raise ValueError('B2 index/source proof differs.')
    image=verify_image(docker)
    if image['Id']!=checkpoint['api_image_id']:raise ValueError('B2 image checkpoint differs.')
    spec=compose_document(STATE,SOURCE_STATE,RUN,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_public_key())
    if copy.read_private_json(STATE/'compose.json')!=spec:raise ValueError('B2 Compose changed.')
    validate_role(docker)
    validate_hba(docker)
    info=json.loads(docker.run(['inspect',CONTAINER]))[0]
    validate_container(info,spec['services']['api'],image['Config'],image['Id'],uid=os.geteuid())
    for n,internal in [('dbnet',True),('authegress',False)]:
        if json.loads(docker.run(['network','inspect',deploy.TARGET.project+'_'+n]))[0].get('Internal') is not internal:
            raise ValueError('B2 shared network isolation differs.')
    return ctx,index,info

def validate_role(docker):
    contract=json.loads(docker.sql("""SELECT json_build_object(
     'safe_role',(SELECT count(*)=1 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolinherit AND rolconnlimit=2) FROM pg_roles WHERE rolname='village_storage_read_login'),
     'membership',(SELECT count(*)=1 AND bool_and(r.rolname='authenticated' AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='village_storage_read_login'::regrole),
     'a_budget',(SELECT rolconnlimit=4 FROM pg_roles WHERE rolname='village_api_login'));"""))
    if contract!={'safe_role':True,'membership':True,'a_budget':True}:raise ValueError('B2 role or independent A/B connection budgets differ.')

def create_role(docker,password):
    if not re.fullmatch('[A-Za-z0-9_-]{48}',password):raise ValueError('Invalid generated role credential.')
    sql=(ROOT/'linux/sql/storage-read-role.sql').read_text(encoding='utf-8')
    docker.phase='storage-read-role'
    docker.exec('psql','-X','-w','-v','ON_ERROR_STOP=1','--single-transaction','-h','/var/run/postgresql','-U',deploy.rd.ADMIN,'-d',deploy.rd.DATABASE,'-f','-',
        input=sql+"\nSET LOCAL password_encryption='scram-sha-256';\nALTER ROLE village_storage_read_login PASSWORD '"+password+"';\n")
    validate_role(docker)

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
    password=secrets.token_urlsafe(36)
    with os.fdopen(os.open(STATE/'api-password',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w',encoding='ascii') as stream:stream.write(password+'\n')
    copy.write_private_json(STATE/'storage-index.json',index)
    copy.write_private_json(STATE/'deployment-checkpoint.json',{'version':1,'api_image_id':image['Id'],'source_fingerprint':ctx['fingerprint'],'source_archive_sha256':ctx['archive_sha256'],'index_sha256':digest(index)})
    copy.write_private_json(STATE/'compose.json',compose_document(STATE,SOURCE_STATE,RUN,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_public_key()))
    docker.state=STATE
    create_role(docker,password);password=None
    install_hba(docker)
    docker.phase='storage-read-start'
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
