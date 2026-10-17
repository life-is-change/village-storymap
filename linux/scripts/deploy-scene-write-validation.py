#!/usr/bin/env python3
"""Isolated C1 scene database/API; manual Aliyun operations, never a cutover."""
import argparse
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
spec=importlib.util.spec_from_file_location('scene_storage_deploy',S/'deploy-storage-read-validation.py')
b2=importlib.util.module_from_spec(spec);spec.loader.exec_module(b2)
deploy=b2.deploy
copy=b2.copy
ROOT=deploy.ROOT
STATE=Path.home()/'village-scene-validation'
DATABASE='village_scene_validation'
ROLE='village_scene_login'
IMAGE='village-business-api:stage-c1-scene'
CONTAINER='village-scene-validation-api'
PROJECT='village-scene-validation'

def compose_document(state,*,uid,gid,key):
    doc=b2.compose_document(state,b2.SOURCE_STATE,b2.RUN,uid=uid,gid=gid,key=key)
    doc['name']=PROJECT
    api=doc['services']['api']
    api.update(image=IMAGE,container_name=CONTAINER,ports=['127.0.0.1:18082:8080'])
    api['environment'].update(PGDATABASE=DATABASE,PGUSER=ROLE)
    api['environment'].pop('STORAGE_READ_ENABLED')
    api['volumes']=api['volumes'][:1]
    return doc

def new_state_guard():
    deploy.validate_new_state(STATE,Path.home()/'village-db-backups',b2.SOURCE_STATE,ROOT)
    for p in [b2.STATE,b2.RUN,Path.home()/'village-db-copy']:
        p=deploy.no_links(p)
        if STATE==p or STATE in p.parents or p in STATE.parents:raise ValueError('C1 state overlaps protected data.')

def source_context(docker):
    ctx,_,_=b2.validate_runtime(docker)
    acceptance=copy.read_private_json(b2.STATE/'acceptance.json')
    proof=copy.read_private_json(b2.STATE/'verification.json')
    fingerprint=b2.runtime_fingerprint(docker)
    if (acceptance.get('status')!='internal_files_validated_not_cut_over' or acceptance.get('runtime_fingerprint')!=fingerprint
        or acceptance.get('verification_attempt_id')!=proof.get('attempt_id')):
        raise ValueError('Require unchanged accepted B2 before adding C1.')
    manifest=deploy.rd.verify_backup(ctx['backup'])
    if manifest['files']['database.dump']['sha256']!=ctx['archive_sha256']:raise ValueError('Backup differs from B2.')
    return {**ctx,'b2_fingerprint':fingerprint}

def image_metadata():
    meta=json.loads((ROOT/'linux/scene-write-image.json').read_text())
    if (meta['image']!=IMAGE or (meta['os'],meta['architecture'])!=('linux','amd64')
        or meta['code_sha256']!=b2.builder.code_digest(ROOT/'business-api',include_scene=True)):
        raise ValueError('C1 image metadata/source differs.')
    if meta['archive_filename']!='village-business-api-stage-c1-scene-amd64.tar.gz':raise ValueError('Unexpected C1 archive name.')
    return meta

def verify_image(docker):
    meta=image_metadata()
    image=json.loads(docker.run(['image','inspect',IMAGE]))[0]
    if (image['Id'] not in meta['accepted_image_ids'] or (image['Os'],image['Architecture'])!=('linux','amd64')
        or (image.get('Config',{}).get('Labels') or {}).get('village.api.code-sha256')!=meta['code_sha256']
        or image['Config']['Cmd']!=['node','scene/main.mjs']):raise ValueError('Load verified C1 image first.')
    return image

def load_image_archive(docker):
    ctx=source_context(docker);meta=image_metadata()
    if CONTAINER in docker.run(['ps','-a','--format','{{.Names}}']).splitlines():raise ValueError('C1 container already exists; do not replace its image.')
    archive=deploy.no_links(ctx['backup']/meta['archive_filename']);st=archive.stat()
    if not archive.is_file() or st.st_nlink!=1 or st.st_size!=meta['archive_bytes'] or deploy.rd.checksum(archive)!=meta['archive_sha256']:
        raise ValueError('C1 archive checksum/size differs; do not load it.')
    docker.phase='scene-image-load'
    docker.run(['load','-i',str(archive)]);verify_image(docker)
    version=docker.run(['run','--rm','--pull=never','--network','none','--entrypoint','node',IMAGE,'--version']).strip()
    if not version.startswith('v22.'):raise ValueError('Wrong Node runtime.')
    result=docker.run(['run','--rm','--pull=never','--network','none','--entrypoint','node',IMAGE,'-e',
      "import('./scene/database.mjs').then(()=>console.log('SCENE_RUNTIME_IMPORT_OK')).catch(()=>process.exit(1))"])
    if result.strip()!='SCENE_RUNTIME_IMPORT_OK':raise ValueError('C1 runtime import failed.')
    print('SCENE_IMAGE_ARCHIVE_VERIFIED_LOADED - checksum, platform and runtime checked.')

def expected_hba(docker):return b2.scene_hba(b2.storage_hba(deploy.restricted_hba(docker)))

def preflight(docker):
    new_state_guard();ctx=source_context(docker);image=verify_image(docker)
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=b2.storage_hba(deploy.restricted_hba(docker)):
        raise ValueError('Require original A/B2 HBA; retain any partial C1 state.')
    exists=docker.sql("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='village_scene_validation') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_scene_login');").strip()
    if exists!='f':raise ValueError('C1 database/role already exists; never overwrite or reset.')
    if CONTAINER in docker.run(['ps','-a','--format','{{.Names}}']).splitlines():raise ValueError('C1 container exists.')
    available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])*1024
    if available<384*1024**2 or shutil.disk_usage(Path.home()).free<4*1024**3:raise ValueError('Require 384 MiB available memory and 4 GiB disk.')
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1',18082))==0:raise ValueError('Loopback 18082 is occupied.')
    return ctx,image

class SceneSnapshot:
    def __init__(self,docker):self.docker=docker
    def sql(self,sql):return self.docker.sql(sql,DATABASE)

def check_snapshot(docker):
    expected=copy.read_private_json(b2.SOURCE_STATE/'db/archive-snapshot-counts.json')
    deploy.rd.compare_snapshot(expected,deploy.rd.actual_snapshot(SceneSnapshot(docker),expected))

def restore_database(docker):
    docker.phase='scene-database-create'
    docker.sql('CREATE DATABASE village_scene_validation OWNER postgres TEMPLATE template0;','restore_control')
    docker.phase='scene-archive-restore'
    # Cluster roles already exist from the accepted A restore. Replay only the
    # verified archive into the NEW database, never roles.sql or village_copy.
    docker.exec('pg_restore','--exit-on-error','--single-transaction','-h','/var/run/postgresql','-U',deploy.rd.ADMIN,'-d',DATABASE,'/restore/database.dump')
    check_snapshot(docker)

def create_role(docker,password):
    if not re.fullmatch('[A-Za-z0-9_-]{48}',password):raise ValueError('Invalid generated credential.')
    docker.phase='scene-role'
    sql=(ROOT/'linux/sql/scene-write-candidate.sql').read_text(encoding='utf-8')
    docker.exec('psql','-X','-w','-v','ON_ERROR_STOP=1','--single-transaction','-h','/var/run/postgresql','-U',deploy.rd.ADMIN,'-d',DATABASE,'-f','-',
      input=sql+"\nSET LOCAL password_encryption='scram-sha-256';\nALTER ROLE village_scene_login PASSWORD '"+password+"';\n")

def install_hba(docker):
    before=b2.storage_hba(deploy.restricted_hba(docker));after=expected_hba(docker)
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=before:raise ValueError('HBA changed after preflight.')
    for name,value in [('pg_hba.before.conf',before),('pg_hba.expected.conf',after)]:
        with os.fdopen(os.open(STATE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:f.write(value)
    docker.phase='scene-hba'
    command=('set -eu; umask 077; test ! -e /var/lib/postgresql/data/.scene-hba.partial; '
      'cp -p /var/lib/postgresql/data/pg_hba.conf /var/lib/postgresql/data/.scene-hba.partial; '
      'cat > /var/lib/postgresql/data/.scene-hba.partial; '
      'mv /var/lib/postgresql/data/.scene-hba.partial /var/lib/postgresql/data/pg_hba.conf')
    docker.exec('sh','-c',command,input=after)
    if docker.sql('SELECT pg_reload_conf();').strip()!='t':raise ValueError('HBA reload refused.')
    if docker.sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;').strip()!='0':raise ValueError('HBA errors.')

def schema_fingerprint(docker):
    # Bind grants, RLS and exact function definitions, never private rows.
    raw=json.loads(docker.sql("""SELECT json_build_object(
     'functions',(SELECT json_agg(pg_get_functiondef(p.oid) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND (p.proname LIKE 'scene_edit_%' OR p.proname IN ('scene_candidate_lock','can_read_scene_edit_project','current_profile_role','current_profile_student_key','is_scene_edit_staff','is_scene_edit_group_member'))),
     'rls',(SELECT json_agg(json_build_array(c.relname,c.relrowsecurity,c.relacl) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('profiles','scene_edit_projects','scene_edit_objects','scene_edit_versions')),
     'policies',(SELECT json_agg(json_build_array(p.polname,p.polroles,p.polcmd,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid IN ('profiles'::regclass,'scene_edit_projects'::regclass,'scene_edit_objects'::regclass,'scene_edit_versions'::regclass)));
     """,DATABASE))
    if not raw.get('functions') or len(raw.get('rls') or [])!=4:raise ValueError('Missing scene schema.')
    return b2.digest(raw)

def validate_role(docker):
    contract=json.loads(docker.sql("""SELECT json_build_object(
     'role',(SELECT count(*)=1 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit AND rolconnlimit=2) FROM pg_roles WHERE rolname='village_scene_login'),
     'membership',(SELECT count(*)=1 AND bool_and(r.rolname='authenticated' AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='village_scene_login'::regrole),
     'connect',has_database_privilege('village_scene_login','village_scene_validation','CONNECT'));
     """,DATABASE))
    if contract!={'role':True,'membership':True,'connect':True}:raise ValueError('C1 role contract differs.')

def validate_runtime(docker):
    copy.private_path(STATE,directory=True);copy.private_path(STATE/'api-password')
    ctx=source_context(docker);checkpoint=copy.read_private_json(STATE/'deployment-checkpoint.json')
    if ctx['b2_fingerprint']!=checkpoint['b2_fingerprint'] or ctx['archive_sha256']!=checkpoint['source_archive_sha256']:raise ValueError('A/B2 source changed.')
    if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=expected_hba(docker):raise ValueError('C1 HBA differs.')
    validate_role(docker)
    if schema_fingerprint(docker)!=checkpoint['schema_fingerprint']:raise ValueError('C1 schema changed.')
    image=verify_image(docker)
    if image['Id']!=checkpoint['api_image_id']:raise ValueError('C1 image changed.')
    spec=compose_document(STATE,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_public_key())
    if copy.read_private_json(STATE/'compose.json')!=spec:raise ValueError('C1 Compose changed.')
    info=json.loads(docker.run(['inspect',CONTAINER]))[0]
    b2.validate_container(info,spec['services']['api'],image['Config'],image['Id'],uid=os.geteuid(),image_tag=IMAGE,project=PROJECT,port=18082)
    if not info['State']['Running']:raise ValueError('C1 API not running.')
    return ctx,info

def runtime_fingerprint(docker):
    ctx,info=validate_runtime(docker)
    return b2.digest({'b2':ctx['b2_fingerprint'],'id':info['Id'],'image':info['Image'],'started':info['State']['StartedAt'],'schema':schema_fingerprint(docker)})

def ready(docker):
    for _ in range(40):
        info=json.loads(docker.run(['inspect',CONTAINER]))[0]
        if not info['State']['Running']:raise ValueError('C1 stopped; retain private logs.')
        if info['State'].get('Health',{}).get('Status')=='healthy':return
        time.sleep(1)
    raise ValueError('C1 health timeout.')

def deploy_candidate(docker):
    ctx,image=preflight(docker);STATE.mkdir(mode=0o700);docker.state=STATE
    # Record source identity before creating anything. Partial state is never reset.
    copy.write_private_json(STATE/'deployment-checkpoint.json',{'status':'started','source_archive_sha256':ctx['archive_sha256'],'b2_fingerprint':ctx['b2_fingerprint'],'api_image_id':image['Id']})
    restore_database(docker)
    password=secrets.token_urlsafe(36)
    with os.fdopen(os.open(STATE/'api-password',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:f.write(password+'\n')
    create_role(docker,password);password=None
    install_hba(docker)
    checkpoint=copy.read_private_json(STATE/'deployment-checkpoint.json');checkpoint.update(status='database_ready',schema_fingerprint=schema_fingerprint(docker))
    copy.write_private_json(STATE/'deployment-checkpoint.json',checkpoint)
    copy.write_private_json(STATE/'compose.json',compose_document(STATE,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_public_key()))
    docker.phase='scene-start'
    docker.run(['compose','-f',str(STATE/'compose.json'),'up','-d','--pull','never','--no-build','api']);ready(docker);validate_runtime(docker)
    print('SCENE_WRITE_INTERNAL_DEPLOYED_NOT_ACCEPTED - run --verify and the login write probe next.')

def verify_candidate(docker,*,quiet=False):
    validate_runtime(docker)
    for name in ('verification.json','acceptance.json'):
        p=STATE/name
        if p.exists():copy.private_path(p).rename(STATE/(name+'.previous-'+secrets.token_hex(8)))
    docker.phase='scene-api-restart'
    docker.run(['compose','-f',str(STATE/'compose.json'),'restart','api']);ready(docker);validate_runtime(docker)
    script="""import {loadSceneConfig} from './scene/config.mjs';import {createSceneDatabase} from './scene/database.mjs';
const db=createSceneDatabase(loadSceneConfig().database);try{try{await db.run({userId:'00000000-0000-0000-0000-000000000000'},'versions',{projectId:'00000000-0000-0000-0000-000000000000'});throw Error('Unexpected identity');}catch(e){if(e.code!=='PROFILE_NOT_SYNCED')throw e;}console.log('SCENE_DATABASE_TCP_OK');}finally{await db.close();}"""
    out=docker.run(['exec','-i',CONTAINER,'node','--input-type=module','-'],input=script)
    if out.strip()!='SCENE_DATABASE_TCP_OK':raise ValueError('C1 database TCP/identity check failed.')
    proof={'status':'restart_verified','attempt_id':secrets.token_hex(16),'verified_at':time.time(),'runtime_fingerprint':runtime_fingerprint(docker)}
    copy.write_private_json(STATE/'verification.json',proof)
    if not quiet:print('SCENE_WRITE_RESTART_VERIFIED - real login/save/version probe still required.')
    return proof

def main():
    parser=argparse.ArgumentParser(description=__doc__);g=parser.add_mutually_exclusive_group(required=True)
    for mode in ('load-image','check','deploy','verify'):g.add_argument('--'+mode,action='store_true')
    args=parser.parse_args();os.umask(0o077)
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('Use normal admin Linux terminal.')
        docker=deploy.rd.LocalDocker(STATE,target=deploy.TARGET)
        if args.load_image:load_image_archive(docker)
        elif args.check:preflight(docker);print('SCENE_WRITE_PREFLIGHT_OK - no data or containers changed.')
        elif args.deploy:deploy_candidate(docker)
        else:verify_candidate(docker)
        return 0
    except (ValueError,RuntimeError,OSError,KeyError,TypeError):
        print('STOP: C1 candidate not accepted. Keep private state/database/logs; do not reset or expose data.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
