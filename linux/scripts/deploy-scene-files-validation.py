#!/usr/bin/env python3
"""Isolated C2a file candidate; never a website/Supabase/4090 cutover."""
import argparse
import copy as pycopy
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
S=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('files_c1',S/'deploy-scene-write-validation.py');c1=importlib.util.module_from_spec(spec);spec.loader.exec_module(c1)
b2=c1.b2;deploy=c1.deploy;copy=c1.copy;ROOT=c1.ROOT
STATE=Path.home()/'village-scene-files-validation'
DATABASE='village_scene_files_validation';ROLE='village_scene_files_login';IMAGE='village-business-api:stage-c2a-scene-files'
CONTAINER='village-scene-files-validation-api';PROJECT='village-scene-files-validation'

def compose_document(state,*,uid,gid,key):
    doc=b2.compose_document(state,b2.SOURCE_STATE,b2.RUN,uid=uid,gid=gid,key=key);doc['name']=PROJECT;api=doc['services']['api']
    api.update(image=IMAGE,container_name=CONTAINER,ports=['127.0.0.1:18083:8080'],mem_limit='256m',memswap_limit='256m')
    api['environment'].pop('STORAGE_READ_ENABLED');api['environment'].update(PGDATABASE=DATABASE,PGUSER=ROLE,SCENE_FILES_ROOT='/srv/scene-files',SCENE_LEGACY_ROOT='/srv/business-storage/blobs',SCENE_LEGACY_INDEX='/run/storage/index.json',NODE_OPTIONS='--max-old-space-size=128')
    api['volumes'][1]['source']=str(b2.STATE/'storage-index.json')
    api['volumes'].append({'type':'bind','source':str(Path(state)/'files'),'target':'/srv/scene-files','read_only':False,'bind':{'create_host_path':False}})
    return doc

def new_state_guard():
    deploy.validate_new_state(STATE,Path.home()/'village-db-backups',b2.SOURCE_STATE,ROOT)
    for path in [c1.STATE,b2.STATE,b2.RUN,Path.home()/'village-db-copy']:
        p=deploy.no_links(path)
        if STATE==p or STATE in p.parents or p in STATE.parents:raise ValueError('PROTECTED_STATE_OVERLAP')

def validate_resources(available,disk):
    if available<512*1024**2:raise ValueError('MEMORY_RESOURCE_LOW')
    if disk<2*1024**3:raise ValueError('DISK_RESOURCE_LOW')

def source_context(docker):
    docker.phase='files-source-validation';ctx,_=c1.validate_runtime(docker);fingerprint=c1.runtime_fingerprint(docker)
    acceptance=copy.read_private_json(c1.STATE/'acceptance.json');proof=copy.read_private_json(c1.STATE/'verification.json')
    if (acceptance.get('status')!='internal_scene_writes_validated_not_cut_over' or acceptance.get('runtime_fingerprint')!=fingerprint or acceptance.get('verification_attempt_id')!=proof.get('attempt_id') or proof.get('runtime_fingerprint')!=fingerprint):raise ValueError('REQUIRE_ACCEPTED_C1')
    return {**ctx,'c1_fingerprint':fingerprint}

def expected_hba(docker):return b2.scene_files_hba(c1.expected_hba(docker))

def image_metadata():
    m=json.loads((ROOT/'linux/scene-files-image.json').read_text())
    if m['image']!=IMAGE or (m['os'],m['architecture'])!=('linux','amd64') or m['code_sha256']!=b2.builder.code_digest(ROOT/'business-api',include_scene=True,include_scene_files=True) or m['archive_filename']!='village-business-api-stage-c2a-scene-files-amd64.tar.gz':raise ValueError('FILES_IMAGE_METADATA_DIFFERS')
    return m

def verify_image(docker):
    m=image_metadata();image=json.loads(docker.run(['image','inspect',IMAGE]))[0]
    if image['Id'] not in m['accepted_image_ids'] or (image['Os'],image['Architecture'])!=('linux','amd64') or (image.get('Config',{}).get('Labels') or {}).get('village.api.code-sha256')!=m['code_sha256'] or image['Config']['Cmd']!=['node','scene-files/main.mjs']:raise ValueError('FILES_IMAGE_NOT_LOADED')
    return image

def load_image_archive(docker):
    ctx=source_context(docker);m=image_metadata()
    if CONTAINER in docker.run(['ps','-a','--format','{{.Names}}']).splitlines():raise ValueError('FILES_CONTAINER_EXISTS')
    p=deploy.no_links(ctx['backup']/m['archive_filename']);st=p.stat()
    if not p.is_file() or st.st_nlink!=1 or st.st_size!=m['archive_bytes'] or deploy.rd.checksum(p)!=m['archive_sha256']:raise ValueError('FILES_ARCHIVE_CHECKSUM_DIFFERS')
    docker.phase='files-image-load';docker.run(['load','-i',str(p)]);verify_image(docker)
    version=docker.run(['run','--rm','--pull=never','--network','none','--entrypoint','node',IMAGE,'--version']).strip()
    if not version.startswith('v22.'):raise ValueError('FILES_NODE_VERSION_DIFFERS')
    result=docker.run(['run','--rm','--pull=never','--network','none','--entrypoint','node',IMAGE,'-e',"Promise.all([import('./scene-files/http.mjs'),import('./scene-files/scene.mjs')]).then(()=>console.log('SCENE_FILES_RUNTIME_IMPORT_OK')).catch(()=>process.exit(1))"])
    if result.strip()!='SCENE_FILES_RUNTIME_IMPORT_OK':raise ValueError('FILES_RUNTIME_IMPORT_FAILED')
    print('SCENE_FILES_IMAGE_ARCHIVE_VERIFIED_LOADED')

def preflight(docker):
    new_state_guard();ctx=source_context(docker);image=verify_image(docker);docker.phase='files-preflight'
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=c1.expected_hba(docker):raise ValueError('FILES_BASELINE_HBA_DIFFERS')
    if docker.sql("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='village_scene_files_validation') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_scene_files_login');").strip()!='f':raise ValueError('FILES_DATABASE_OR_ROLE_EXISTS')
    if CONTAINER in docker.run(['ps','-a','--format','{{.Names}}']).splitlines():raise ValueError('FILES_CONTAINER_EXISTS')
    available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])*1024;validate_resources(available,shutil.disk_usage(Path.home()).free)
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1',18083))==0:raise ValueError('FILES_PORT_OCCUPIED')
    return ctx,image

class FilesSnapshot:
    def __init__(self,docker):self.docker=docker
    def sql(self,sql):return self.docker.sql(sql,DATABASE)

def restore_database(docker):
    docker.phase='files-database-create';docker.sql('CREATE DATABASE village_scene_files_validation OWNER postgres TEMPLATE template0;','restore_control')
    docker.phase='files-archive-restore';docker.exec('pg_restore','--exit-on-error','--single-transaction','-h','/var/run/postgresql','-U',deploy.rd.ADMIN,'-d',DATABASE,'/restore/database.dump')
    expected=copy.read_private_json(b2.SOURCE_STATE/'db/archive-snapshot-counts.json');deploy.rd.compare_snapshot(expected,deploy.rd.actual_snapshot(FilesSnapshot(docker),expected))

def install_role(docker,password):
    if not re.fullmatch('[A-Za-z0-9_-]{48}',password):raise ValueError('INVALID_GENERATED_CREDENTIAL')
    docker.phase='files-role';sql=(ROOT/'linux/sql/scene-files-candidate.sql').read_text(encoding='utf-8')
    docker.exec('psql','-X','-w','-v','ON_ERROR_STOP=1','--single-transaction','-h','/var/run/postgresql','-U',deploy.rd.ADMIN,'-d',DATABASE,'-f','-',input=sql+"\nSET LOCAL password_encryption='scram-sha-256';\nALTER ROLE village_scene_files_login PASSWORD '"+password+"';\n")

def install_hba(docker):
    before=c1.expected_hba(docker);after=expected_hba(docker)
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=before:raise ValueError('FILES_HBA_CHANGED_AFTER_PREFLIGHT')
    for name,value in [('pg_hba.before.conf',before),('pg_hba.expected.conf',after)]:
        with os.fdopen(os.open(STATE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:f.write(value)
    docker.phase='files-hba';docker.exec('sh','-c','set -eu; umask 077; test ! -e /var/lib/postgresql/data/.scene-files-hba.partial; cp -p /var/lib/postgresql/data/pg_hba.conf /var/lib/postgresql/data/.scene-files-hba.partial; cat > /var/lib/postgresql/data/.scene-files-hba.partial; mv /var/lib/postgresql/data/.scene-files-hba.partial /var/lib/postgresql/data/pg_hba.conf',input=after)
    if docker.sql('SELECT pg_reload_conf();').strip()!='t' or docker.sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;').strip()!='0':raise ValueError('FILES_HBA_RELOAD_FAILED')

def schema_fingerprint(docker):
    sql="""SELECT json_build_object(
    'functions',(SELECT json_agg(json_build_array(n.nspname,p.proname,p.proacl,pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='scene_files' OR n.nspname='public' AND (p.proname LIKE 'scene_edit_%' OR p.proname IN('can_read_scene_edit_project','can_read_scene_edit_asset','current_profile_role','current_profile_student_key','is_scene_edit_staff','is_scene_edit_group_member'))),
    'tables',(SELECT json_agg(json_build_array(n.nspname,c.relname,c.relrowsecurity,c.relacl) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND (n.nspname='scene_files' OR n.nspname='public' AND c.relname IN('profiles','scene_edit_projects','scene_edit_objects','scene_edit_versions','scene_edit_assets','scene_edit_components'))),
    'policies',(SELECT json_agg(json_build_array(n.nspname,c.relname,p.polname,p.polroles,p.polcmd,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY n.nspname,c.relname,p.polname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='scene_files' OR n.nspname='public' AND c.relname IN('profiles','scene_edit_projects','scene_edit_objects','scene_edit_versions','scene_edit_assets','scene_edit_components')));"""
    obj=json.loads(docker.sql(sql,DATABASE))
    if not obj.get('functions') or len(obj.get('tables') or [])!=8:raise ValueError('FILES_SCHEMA_MISSING')
    return b2.digest(obj)

def validate_role(docker):
    value=json.loads(docker.sql("""SELECT json_build_object(
    'role',(SELECT count(*)=1 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit AND rolconnlimit=2) FROM pg_roles WHERE rolname='village_scene_files_login'),
    'membership',(SELECT count(*)=1 AND bool_and(r.rolname='authenticated' AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='village_scene_files_login'::regrole),
    'connect',has_database_privilege('village_scene_files_login','village_scene_files_validation','CONNECT'));""",DATABASE))
    if value!={'role':True,'membership':True,'connect':True}:raise ValueError('FILES_ROLE_DIFFERS')

def validate_container(info,spec,image):
    h=info['HostConfig']
    if h.get('Memory')!=256*1024**2 or h.get('MemorySwap')!=256*1024**2:raise ValueError('FILES_MEMORY_LIMIT_DIFFERS')
    mounts=info.get('Mounts',[])
    if len(mounts)!=len(spec['volumes']):raise ValueError('FILES_MOUNTS_DIFFER')
    for v in spec['volumes']:
        matches=[m for m in mounts if m['Destination']==v['target']]
        if len(matches)!=1 or matches[0]['Type']!='bind' or matches[0]['RW']!=(not v.get('read_only',False)) or deploy.no_links(matches[0]['Source'])!=deploy.no_links(v['source']):raise ValueError('FILES_MOUNTS_DIFFER')
    normalized=pycopy.deepcopy(info);normalized['HostConfig'].update(Memory=192*1024**2,MemorySwap=192*1024**2)
    for m in normalized['Mounts']:m['RW']=False
    b2.validate_container(normalized,spec,image['Config'],image['Id'],uid=os.geteuid(),image_tag=IMAGE,project=PROJECT,port=18083)

def validate_runtime(docker):
    copy.private_path(STATE,directory=True);copy.private_path(STATE/'api-password');copy.private_path(STATE/'files',directory=True)
    ctx=source_context(docker);checkpoint=copy.read_private_json(STATE/'deployment-checkpoint.json')
    if checkpoint['c1_fingerprint']!=ctx['c1_fingerprint'] or checkpoint['source_archive_sha256']!=ctx['archive_sha256']:raise ValueError('FILES_BASELINE_CHANGED')
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=expected_hba(docker):raise ValueError('FILES_HBA_DIFFERS')
    validate_role(docker)
    if schema_fingerprint(docker)!=checkpoint['schema_fingerprint']:raise ValueError('FILES_SCHEMA_CHANGED')
    image=verify_image(docker)
    if image['Id']!=checkpoint['api_image_id']:raise ValueError('FILES_IMAGE_CHANGED')
    wanted=compose_document(STATE,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_public_key())
    if copy.read_private_json(STATE/'compose.json')!=wanted:raise ValueError('FILES_COMPOSE_CHANGED')
    info=json.loads(docker.run(['inspect',CONTAINER]))[0];validate_container(info,wanted['services']['api'],image)
    if not info['State']['Running']:raise ValueError('FILES_NOT_RUNNING')
    return ctx,info

def runtime_fingerprint(docker):
    ctx,info=validate_runtime(docker);return b2.digest({'c1':ctx['c1_fingerprint'],'id':info['Id'],'image':info['Image'],'started':info['State']['StartedAt'],'schema':schema_fingerprint(docker)})

def ready(docker):
    for _ in range(45):
        info=json.loads(docker.run(['inspect',CONTAINER]))[0]
        if not info['State']['Running']:raise ValueError('FILES_STOPPED')
        if info['State'].get('Health',{}).get('Status')=='healthy':return
        time.sleep(1)
    raise ValueError('FILES_HEALTH_TIMEOUT')

def deploy_candidate(docker):
    ctx,image=preflight(docker);STATE.mkdir(mode=0o700);(STATE/'files').mkdir(mode=0o700);docker.state=STATE
    checkpoint={'status':'started','c1_fingerprint':ctx['c1_fingerprint'],'source_archive_sha256':ctx['archive_sha256'],'api_image_id':image['Id']};copy.write_private_json(STATE/'deployment-checkpoint.json',checkpoint)
    restore_database(docker);password=secrets.token_urlsafe(36)
    with os.fdopen(os.open(STATE/'api-password',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:f.write(password+'\n')
    install_role(docker,password);password=None;install_hba(docker);checkpoint.update(status='database_ready',schema_fingerprint=schema_fingerprint(docker));copy.write_private_json(STATE/'deployment-checkpoint.json',checkpoint)
    copy.write_private_json(STATE/'compose.json',compose_document(STATE,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_public_key()))
    docker.phase='files-start';docker.run(['compose','-f',str(STATE/'compose.json'),'up','-d','--pull','never','--no-build','api']);ready(docker);validate_runtime(docker)
    print('SCENE_FILES_INTERNAL_DEPLOYED_NOT_ACCEPTED - run --verify and the real login probe.')

def verify_candidate(docker,*,quiet=False):
    validate_runtime(docker)
    for name in ('verification.json','acceptance.json'):
        p=STATE/name
        if p.exists():copy.private_path(p).rename(STATE/(name+'.previous-'+secrets.token_hex(8)))
    docker.phase='files-api-restart';docker.run(['compose','-f',str(STATE/'compose.json'),'restart','api']);ready(docker);validate_runtime(docker)
    code="import {loadSceneFilesConfig} from './scene-files/config.mjs';import {createSceneFilesDatabase} from './scene-files/database.mjs';const db=createSceneFilesDatabase(loadSceneFilesConfig().database);try{try{await db.withIdentity({userId:'00000000-0000-0000-0000-000000000000'},()=>{});throw Error('identity accepted');}catch(e){if(e.code!=='PROFILE_NOT_SYNCED')throw e;}console.log('SCENE_FILES_DATABASE_TCP_OK');}finally{await db.close();}"
    if docker.run(['exec','-i',CONTAINER,'node','--input-type=module','-'],input=code).strip()!='SCENE_FILES_DATABASE_TCP_OK':raise ValueError('FILES_TCP_CHECK_FAILED')
    proof={'status':'restart_verified','attempt_id':secrets.token_hex(16),'verified_at':time.time(),'runtime_fingerprint':runtime_fingerprint(docker)};copy.write_private_json(STATE/'verification.json',proof)
    if not quiet:print('SCENE_FILES_RESTART_VERIFIED - real upload/save/version probe still required.')
    return proof

def cleanup_report(docker):
    validate_runtime(docker);code="import {loadSceneFilesConfig} from './scene-files/config.mjs';import {createSceneFilesDatabase} from './scene-files/database.mjs';const db=createSceneFilesDatabase(loadSceneFilesConfig().database);try{const r=await db.withMaintenance(async c=>(await c.query('SELECT scene_files.cleanup_candidates(false) AS data')).rows[0].data);console.log(JSON.stringify({files:r.length,bytes:r.reduce((n,f)=>n+Number(f.size),0),executed:false}));}finally{await db.close();}"
    value=json.loads(docker.run(['exec','-i',CONTAINER,'node','--input-type=module','-'],input=code));print(json.dumps(value))

def main():
    parser=argparse.ArgumentParser(description=__doc__);g=parser.add_mutually_exclusive_group(required=True)
    for mode in ('load-image','check','deploy','verify','cleanup-report'):g.add_argument('--'+mode,action='store_true')
    args=parser.parse_args();os.umask(0o077);docker=None
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('NORMAL_ADMIN_LINUX_REQUIRED')
        docker=deploy.rd.LocalDocker(STATE,target=deploy.TARGET)
        if args.load_image:load_image_archive(docker)
        elif args.check:preflight(docker);print('SCENE_FILES_PREFLIGHT_OK - no data or containers changed.')
        elif args.deploy:deploy_candidate(docker)
        elif args.verify:verify_candidate(docker)
        else:cleanup_report(docker)
        return 0
    except (ValueError,RuntimeError,OSError,KeyError,TypeError) as e:
        code=str(e) if re.fullmatch('[A-Z][A-Z0-9_]{2,80}',str(e)) else 'CANDIDATE_CHECK_FAILED'
        print('STOP: SCENE_FILES_DEPLOY_FAILED phase='+getattr(docker,'phase','preflight')+' category='+code+'. Keep private state/database/logs; do not reset or expose data.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
