#!/usr/bin/env python3
"""Coordinated fresh local-Auth candidate; no source writes or destructive reset."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
import business_storage_copy as storage
import autonomous_schema as schema
from autonomous_bundle import load_script,validate_fresh_snapshot
from autonomous_compose import compose_document
from autonomous_extract import extract_release,tree_digest
from autonomous_operator import Docker,Checkpoints,stop_receipt,matches_stop_receipt,OLD_CANDIDATES,PG,API,AUTH,WEB,PROJECT,DATABASE,ADMIN,audit_auth_triggers,AUTH_TRIGGER_SQL,verified_runtime,operation_lock,resolve_image

ROOT=storage.source_checkout()
STATE=Path.home()/'village-autonomous'
rd=load_script('restore-db-copy')


def check_resources(*,available,disk,database,files):
    if any(type(v) is not int or v<0 for v in (available,disk,database,files)):raise ValueError('RESOURCE_ESTIMATE_REQUIRED')
    if available<512*1024**2:raise ValueError('AVAILABLE_MEMORY_512M_REQUIRED')
    if disk<4*1024**3+2*(database+files):raise ValueError('FULL_COPY_DISK_RESERVE_REQUIRED')


def stop_old_candidates(docker,receipts):
    for expected in receipts:
        if not matches_stop_receipt(docker.inspect(expected['name']),expected):raise ValueError('OLD_CANDIDATE_RECEIPT_CHANGED')
    for expected in receipts:
        if expected['was_running']:docker.run('stop','--time','30',expected['id'])
    return receipts


def install_schema_step(docker,name,sql):
    if name not in [n+'.sql' for n in (*schema.UNIFIED,*schema.LOCAL)]:raise ValueError('KNOWN_SCHEMA_STEP_REQUIRED')
    digest=schema.step_hash(sql)
    row=json.loads(docker.sql("SELECT (SELECT json_build_object('sha256',sha256) FROM autonomous_control.installed_steps WHERE name='"+name+"');").strip() or 'null')
    if row is not None:
        if row!={'sha256':digest}:raise ValueError('SCHEMA_TRANSACTION_RECEIPT_CHANGED')
        return row
    docker.sql(schema.transactional_step(name,sql))
    row=json.loads(docker.sql("SELECT json_build_object('sha256',sha256) FROM autonomous_control.installed_steps WHERE name='"+name+"';"))
    if row!={'sha256':digest}:raise ValueError('SCHEMA_TRANSACTION_NOT_PROVEN')
    return row


def read_schema_receipt(docker,name):
    if name not in [n+'.sql' for n in (*schema.UNIFIED,*schema.LOCAL)]:raise ValueError('KNOWN_SCHEMA_STEP_REQUIRED')
    return json.loads(docker.sql("SELECT (SELECT json_build_object('sha256',sha256) FROM autonomous_control.installed_steps WHERE name='"+name+"');").strip() or 'null')


def require_acceptance(state,meta,*,now=None):
    now=time.time() if now is None else now;path=Path(state)/'acceptance.json'
    if not path.is_file():raise ValueError('RECENT_LOCAL_ACCEPTANCE_REQUIRED')
    proof=storage.read_private_json(path)
    if proof.get('status')!='local_auth_business_verified_not_cut_over' or proof.get('releaseId')!=meta['releaseId'] or type(proof.get('accepted_at')) not in (int,float) or not 0<=now-proof['accepted_at']<1800:
        raise ValueError('RECENT_LOCAL_ACCEPTANCE_REQUIRED')
    for key in ('login','refresh','logout_revocation','business_read','source_token_rejected'):
        if proof.get(key) is not True:raise ValueError('RECENT_LOCAL_ACCEPTANCE_REQUIRED')
    return proof


def read_meta(state=STATE):
    path=Path(state)/'release.json' if Path(__file__).parent.name=='control' else ROOT/'linux/autonomous-release.json'
    meta=json.loads(path.read_text(encoding='utf-8'))
    if meta.get('schemaVersion')!=2 or meta.get('kind')!='autonomous' or meta.get('instanceId')!='aliyun-village' or not re.fullmatch('[a-f0-9]{40}',meta.get('git_sha','')):
        raise ValueError('AUTONOMOUS_RELEASE_REQUIRED')
    if meta.get('releaseId')!='autonomous-'+meta['git_sha'][:12] or meta.get('image')!='village-autonomous:'+meta['git_sha'][:12] or (meta.get('os'),meta.get('architecture'))!=('linux','amd64'):
        raise ValueError('AUTONOMOUS_RELEASE_IDENTITY_REQUIRED')
    for key in ('code_sha256','schema_sha256','static_sha256','control_sha256','archive_sha256'):
        if not re.fullmatch('[a-f0-9]{64}',meta.get(key,'')):raise ValueError('RELEASE_DIGEST_REQUIRED')
    if meta.get('schema_steps')!=[n+'.sql' for n in (*schema.UNIFIED,*schema.LOCAL)]:raise ValueError('AUDITED_SCHEMA_ORDER_REQUIRED')
    proof=meta.get('validation',{})
    if proof.get('native_status')!='success' or proof.get('platform_status')!='success' or any(proof.get(key)!=meta[key] for key in ('code_sha256','schema_sha256','control_sha256','static_sha256')):
        raise ValueError('MATCHING_NATIVE_PROXY_CI_REQUIRED')
    if Path(meta.get('archive_filename','')).name!=meta.get('archive_filename') or type(meta.get('archive_bytes')) is not int or not 1<=meta['archive_bytes']<=2*1024**3:
        raise ValueError('RELEASE_ARCHIVE_IDENTITY_REQUIRED')
    return meta


def assert_images(docker,meta):
    for name in ('postgres','auth','nginx'):
        accepted=meta.get(name+'_accepted_image_ids',[meta[name+'_image_id']])
        meta[name+'_image_id']=resolve_image(docker,accepted)
    for reference,accepted in [(meta['image'],meta['accepted_image_ids']),*( (meta[key],[meta[key]]) for key in ('postgres_image_id','auth_image_id','nginx_image_id'))]:
        obj=json.loads(docker.run('image','inspect',reference))[0]
        if obj.get('Id') not in accepted or (obj.get('Os'),obj.get('Architecture'))!=('linux','amd64'):raise ValueError('VERIFIED_RELEASE_IMAGE_REQUIRED')
        if reference==meta['image']:
            labels=obj.get('Config',{}).get('Labels') or {}
            if labels.get('village.release')!=meta['releaseId'] or labels.get('village.api.code-sha256')!=meta['code_sha256'] or labels.get('village.autonomous.runtime')!='local-v1':raise ValueError('AUTONOMOUS_RUNTIME_IMAGE_REQUIRED')


def write_once(path,data):
    path=Path(path);data=data.encode() if isinstance(data,str) else data
    if path.exists():
        if storage.private_path(path).read_bytes()!=data:raise ValueError('EXISTING_PRIVATE_CONFIGURATION_DIFFERS')
        return
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())


def storage_input(root,archive_sha):
    doc=storage.validate_inventory(storage.read_private_json(Path(root)/'inventory.json'))
    if doc['source_archive_sha256']!=archive_sha:raise ValueError('STORAGE_DATABASE_SNAPSHOT_DIFFERS')
    scope=storage.all_inventory_buckets(doc)
    result=storage.verify_copy(root,selected_buckets=scope)
    if result['status']!='private_copy_verified_not_cut_over' or result['excluded_objects']:raise ValueError('ALL_STORAGE_BYTES_REQUIRED')
    proof=storage.read_private_json(Path(root)/'full-copy-proof.json')
    if proof.get('status')!='all_source_storage_verified_not_cut_over' or proof.get('source_archive_sha256')!=archive_sha or proof.get('inventory_sha256')!=storage.inventory_digest(doc):raise ValueError('FULL_SOURCE_STORAGE_PROOF_REQUIRED')
    return doc,result


def baseline(docker):
    tls=load_script('prepare-ip-tls');old=docker.inspect('village-web-web-1')
    config,public=tls.legacy_static_paths(old,Path.home()/'village-deploy')
    before=config.read_text(encoding='utf-8');tls.tls.add_legacy_acme_location(before)
    receipts=[]
    for name in OLD_CANDIDATES:receipts.append(stop_receipt(docker.inspect(name)))
    return {'web_id':old['Id'],'web_image':old['Image'],'config_sha256':hashlib.sha256(config.read_bytes()).hexdigest(),'candidates':receipts}


def check(meta,archive,backup,storage_root,state=STATE):
    state=storage.private_path(state,directory=True);docker=Docker(state);assert_images(docker,meta)
    archive=storage.no_links(archive)
    if archive.name!=meta['archive_filename'] or archive.stat().st_nlink!=1 or archive.stat().st_size!=meta['archive_bytes'] or rd.checksum(archive)!=meta['archive_sha256']:raise ValueError('RELEASE_ARCHIVE_CHECKSUM_DIFFERS')
    manifest=rd.verify_backup(backup);fresh=validate_fresh_snapshot(manifest)
    doc,result=storage_input(storage_root,manifest['files']['database.dump']['sha256'])
    auth=storage.read_private_json(Path(storage_root)/'auth-compatibility.json')
    if auth.get('status')!='compatible_password_accounts_not_login_verified' or auth.get('unsupported_features')!=0 or auth.get('target_version')!='v2.197.0':raise ValueError('AUTH_SNAPSHOT_COMPATIBILITY_REQUIRED')
    inventory=json.loads((Path(backup)/'inventory.json').read_text(encoding='utf-8'))
    available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])*1024
    check_resources(available=available,disk=shutil.disk_usage(state).free,database=inventory['database_bytes'],files=result['verified_bytes'])
    tls=load_script('prepare-ip-tls');chain=state/'tls/current/fullchain.pem';key=state/'tls/current/privkey.pem'
    target=(state/'tls/current').resolve(strict=True)
    if target.parent!=state/'tls/versions':raise ValueError('CONTROLLED_TLS_CERTIFICATE_REQUIRED')
    tls.tls.verify_certificate_pair(target/'fullchain.pem',target/'privkey.pem')
    initial=storage.read_private_json(state/'initial-baseline.json') if (state/'initial-baseline.json').exists() else baseline(docker)
    return {'source_archive_sha256':manifest['files']['database.dump']['sha256'],'storage_inventory_sha256':storage.inventory_digest(doc),'fresh':fresh,'baseline':initial}


class DeployDocker(Docker):
    def sql(self,query,database=DATABASE):
        # Cluster catalog queries may use the empty control database; never a
        # remote URL or a previous validation database.
        return super().sql(query,database='restore_control' if database=='postgres' else database)

    def archive_tool(self,archive,args,*,output=None):
        backup=load_script('backup-autonomous');path=output or self.state/('archive-output-'+secrets.token_hex(8)+'.txt')
        return backup.stream_command([*self.prefix,'exec','-i',PG,'pg_restore',*args],path,
            maximum=64*1024**2 if output else 1024**2,input_path=archive)


def db_identity(docker,nonce):
    row=json.loads(docker.sql("SELECT json_build_object('oid',oid::text,'owner',pg_get_userbyid(datdba),'comment',shobj_description(oid,'pg_database')) FROM pg_database WHERE datname='"+DATABASE+"';",'postgres') or 'null')
    if not row or row.get('owner')!='postgres' or row.get('comment')!='village-autonomous-'+nonce:raise ValueError('FRESH_DATABASE_IDENTITY_REQUIRED')
    return {'oid':row['oid'],'nonce':nonce}


def verify_archive_restore(docker,backup,nonce):
    decoded=docker.state/('decoded-'+secrets.token_hex(8)+'.sql');docker.archive_tool(Path(backup)/'database.dump',['--data-only','--file=-'],output=decoded)
    try:expected=rd.parse_data_snapshot(decoded.read_text(encoding='utf-8'))
    finally:decoded.unlink()
    rd.compare_snapshot(expected,rd.actual_snapshot(docker,expected))
    rd.verify_structure(docker,(Path(backup)/'contents.txt').read_text(encoding='utf-8'),json.loads(docker.sql(rd.CATALOG_SQL)))
    inventory=json.loads((Path(backup)/'inventory.json').read_text(encoding='utf-8'))
    rd.check_extensions(inventory['extensions'],json.loads(docker.sql("SELECT json_agg(json_build_object('name',extname,'version',extversion)) FROM pg_extension;")))
    return {**db_identity(docker,nonce),'archive_sha256':rd.checksum(Path(backup)/'database.dump'),'tables':len(expected['rows']),'sequences':len(expected['sequences'])}


def wait_pg(docker):
    for attempt in range(50):
        obj=docker.inspect(PG)
        if not obj.get('State',{}).get('Running'):raise ValueError('AUTONOMOUS_PG_STOPPED')
        if obj.get('State',{}).get('Health',{}).get('Status')=='healthy':return
        time.sleep(1)
    raise ValueError('AUTONOMOUS_PG_HEALTH_TIMEOUT')


def hba_install(docker,subnet,*,migration):
    text=schema.hba(subnet,migration=migration)
    docker.run('exec','-i','--user','postgres',PG,'sh','-c','set -eu; umask 077; cat > "$PGDATA/pg_hba.conf"',input=text)
    if docker.sql('SELECT pg_reload_conf();','postgres').strip()!='t' or docker.sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;','postgres').strip()!='0':raise ValueError('AUTONOMOUS_HBA_RELOAD_FAILED')
    return {'sha256':hashlib.sha256(text.encode()).hexdigest()}


def runtime_health(docker,state,meta):
    verified_runtime(docker,state)
    if docker.own_container(API,meta['releaseId']).get('State',{}).get('Health',{}).get('Status')!='healthy':raise ValueError('AUTONOMOUS_API_HEALTH_REQUIRED')
    obj=docker.own_container(WEB,meta['releaseId'])
    if obj.get('Image')!=meta['nginx_image_id'] or not obj.get('State',{}).get('Running'):raise ValueError('AUTONOMOUS_PROXY_REQUIRED')
    tls=load_script('prepare-ip-tls');ports=obj.get('HostConfig',{}).get('PortBindings') or {}
    binds=ports.get('8443/tcp') or []
    if len(binds)!=1 or binds[0].get('HostPort') not in ('18443','443'):raise ValueError('FIXED_TLS_BINDING_REQUIRED')
    proof=tls.tls_loopback(int(binds[0]['HostPort']))
    if proof['peer_sha256']!=tls.current_peer(state/'tls'):raise ValueError('CURRENT_TLS_CERTIFICATE_NOT_SERVED')
    return {'releaseId':meta['releaseId'],'peer_sha256':proof['peer_sha256'],'web_id':obj['Id']}


def copy_storage(source,state,archive_sha):
    doc,result=storage_input(source,archive_sha);scope=storage.all_inventory_buckets(doc)
    doc,objects,manifest=storage.load_transfer(source,selected_buckets=scope)
    target=state/'storage';target.mkdir(mode=0o700,exist_ok=True);(target/'blobs').mkdir(mode=0o700,exist_ok=True)
    copier=load_script('backup-autonomous').copy_private
    index=[]
    for obj in objects:
        row=manifest['records'][obj['id']];digest=row['sha256'];size=row['received_bytes'];destination=target/'blobs'/digest
        if destination.exists():
            if storage.digest_file(destination)!=(digest,size):raise ValueError('COPIED_STORAGE_BYTES_CHANGED')
        else:copier(Path(source)/'blobs'/digest,destination)
        index.append({**obj,'sha256':digest,'size':size})
    for name in ('inventory.json','copy-manifest.json','full-copy-proof.json'):
        write_once(target/name,storage.private_path(Path(source)/name).read_bytes())
    write_once(state/'storage-index.json',json.dumps({'version':1,'source_archive_sha256':archive_sha,'objects':index},sort_keys=True))
    return {'objects':len(index),'verified_bytes':result['verified_bytes'],'archive_sha256':archive_sha}


def wait_runtime(docker,state,meta):
    for attempt in range(50):
        try:return runtime_health(docker,state,meta)
        except (OSError,ValueError,RuntimeError):time.sleep(1)
    raise ValueError('AUTONOMOUS_RUNTIME_HEALTH_TIMEOUT')


def verify_copied_storage(state,archive_sha):
    doc,result=storage_input(state/'storage',archive_sha)
    doc,objects,manifest=storage.load_transfer(state/'storage',selected_buckets=storage.all_inventory_buckets(doc))
    index={'version':1,'source_archive_sha256':archive_sha,'objects':[
        {**obj,'sha256':manifest['records'][obj['id']]['sha256'],'size':manifest['records'][obj['id']]['received_bytes']} for obj in objects]}
    if storage.read_private_json(state/'storage-index.json')!=index:raise ValueError('COPIED_STORAGE_INDEX_CHANGED')
    return {'objects':len(objects),'verified_bytes':result['verified_bytes'],'archive_sha256':archive_sha}


def prepare_state_directories(state):
    for name in ('releases','secrets','files','scene-files','data','empty-init','acme'):
        path=storage.no_links(Path(state)/name)
        if not path.exists():path.mkdir(mode=0o700)
        if name=='empty-init':
            if not path.is_dir() or any(path.iterdir()):raise ValueError('EMPTY_NATIVE_INIT_DIRECTORY_REQUIRED')
            st=path.stat()
            if os.name=='posix' and (st.st_uid!=os.geteuid() or st.st_mode&0o022):raise ValueError('EMPTY_INIT_OWNER_REQUIRED')
            # The image switches to its postgres UID before listing init scripts.
            # This folder is deliberately empty; private parent/secrets stay700.
            path.chmod(0o755)
        elif name!='data':storage.private_path(path,directory=True)


def deploy(meta,archive,backup,storage_root,*,state=STATE):
    state=storage.private_path(state,directory=True)
    if (state/'public-switch.json').exists():raise ValueError('PUBLIC_SWITCH_REQUIRES_EXPLICIT_RECOVERY')
    preflight=check(meta,archive,backup,storage_root,state);docker=DeployDocker(state)
    identity={key:preflight[key] for key in ('source_archive_sha256','storage_inventory_sha256')}|{'releaseId':meta['releaseId'],'archive_sha256':meta['archive_sha256']}
    gate=Checkpoints(state,identity)
    if 'nonce' not in gate.doc:gate.doc['nonce']=secrets.token_hex(16);gate.save()
    nonce=gate.doc['nonce'];initial=preflight['baseline'];storage.write_private_json(state/'initial-baseline.json',initial)
    storage.write_private_json(state/'inputs.json',{'archive':str(Path(archive).absolute()),'backup':str(Path(backup).absolute()),'storage':str(Path(storage_root).absolute())})
    prepare_state_directories(state)
    release=state/'releases'/meta['releaseId']
    wanted={'web':meta['static_sha256'],'schema':meta['schema_sha256'],'control':meta['control_sha256']}
    def extracted(receipt):return receipt==wanted and all(tree_digest(release/name)==digest for name,digest in wanted.items())
    gate.step('release',lambda:extract_release(archive,release),extracted,recover=lambda:wanted)
    control=state/'control'
    if not control.exists():
        control.mkdir(mode=0o700)
        for path in (release/'control').iterdir():write_once(control/path.name,path.read_bytes())
    if tree_digest(control)!=meta['control_sha256']:raise ValueError('FROZEN_CONTROL_RELEASE_DIFFERS')
    for name in ('bootstrap-password','api-password','auth-jwt','auth-migration-password','auth-runtime-password'):
        path=state/'secrets'/name
        if not path.exists():write_once(path,secrets.token_urlsafe(36)+'\n')
        if not re.fullmatch('[A-Za-z0-9_-]{48}\n',storage.private_path(path).read_text()):raise ValueError('GENERATED_PRIVATE_SECRET_REQUIRED')
    write_once(state/'nginx.conf',(control/'nginx.autonomous.conf').read_bytes())
    auth_prepare=load_script('prepare-local-auth');secret=lambda name:storage.private_path(state/'secrets'/name).read_text().strip()
    env=auth_prepare.auth_environment('postgresql://village_auth_runtime:'+secret('auth-runtime-password')+'@postgres:5432/'+DATABASE,secret('auth-jwt'))
    write_once(state/'secrets/auth-runtime.env',''.join(key+'='+value+'\n' for key,value in env.items()))
    env['GOTRUE_DB_DATABASE_URL']='postgresql://village_auth_migrator:'+secret('auth-migration-password')+'@postgres:5432/'+DATABASE
    write_once(state/'secrets/auth-migrate.env',''.join(key+'='+value+'\n' for key,value in env.items()))
    spec=compose_document(state,meta,uid=os.geteuid(),gid=os.getegid());storage.write_private_json(state/'compose.json',spec)
    gate.step('old-candidates-stopped',lambda:stop_old_candidates(docker,initial['candidates']),
        lambda receipt:receipt==initial['candidates'] and all(not docker.inspect(row['name'])['State']['Running'] for row in receipt),
        recover=lambda:stop_old_candidates(docker,initial['candidates']))
    def pg_start():
        if any((state/'data').iterdir()):raise ValueError('NEW_AUTONOMOUS_PGDATA_MUST_BE_EMPTY')
        docker.run('compose','-f',state/'compose.json','up','-d','--no-build','--pull','never','postgres');wait_pg(docker)
        return {'system':docker.sql('SELECT system_identifier FROM pg_control_system();','postgres').strip()}
    def pg_receipt():
        docker.own_container(PG,meta['releaseId']);return {'system':docker.sql('SELECT system_identifier FROM pg_control_system();','postgres').strip()}
    def recover_pg():
        fresh=json.loads(docker.sql(rd.RESUME_CATALOG_SQL,'postgres'))
        rd.validate_resume_catalog(fresh)
        return pg_receipt()
    gate.step('postgres',pg_start,lambda row:row==pg_receipt(),recover=recover_pg)
    subnet=json.loads(docker.run('network','inspect',PROJECT+'_dbnet'))[0]['IPAM']['Config'][0]['Subnet']
    hba_install(docker,subnet,migration=True)
    def roles():
        mapped=rd.prepare_roles_sql((Path(backup)/'roles.sql').read_text(encoding='utf-8'))
        docker.sql("BEGIN;\n"+mapped+"\nCREATE TABLE public.autonomous_roles_receipt(nonce text PRIMARY KEY);INSERT INTO public.autonomous_roles_receipt VALUES('"+nonce+"');COMMIT;",'postgres')
        return {'nonce':nonce}
    gate.step('roles',roles,lambda row:row=={'nonce':docker.sql('SELECT nonce FROM public.autonomous_roles_receipt;','postgres').strip()},
        recover=lambda:{'nonce':docker.sql('SELECT nonce FROM public.autonomous_roles_receipt;','postgres').strip()})
    def create_database():
        docker.sql('CREATE DATABASE '+DATABASE+' OWNER postgres TEMPLATE template0;','postgres')
        docker.sql("COMMENT ON DATABASE "+DATABASE+" IS 'village-autonomous-"+nonce+"';",'postgres');return db_identity(docker,nonce)
    gate.step('database',create_database,lambda row:row==db_identity(docker,nonce),recover=lambda:db_identity(docker,nonce))
    def restore():
        docker.archive_tool(Path(backup)/'database.dump',['--exit-on-error','--single-transaction','-h','/var/run/postgresql','-U',ADMIN,'-d',DATABASE])
        return verify_archive_restore(docker,backup,nonce)
    gate.step('restore',restore,lambda row:row.get('oid')==db_identity(docker,nonce)['oid'] and row.get('archive_sha256')==preflight['source_archive_sha256'],
        recover=lambda:verify_archive_restore(docker,backup,nonce))
    def auth_owners():
        audit_auth_triggers(json.loads(docker.sql(AUTH_TRIGGER_SQL)))
        docker.sql(schema.auth_owner_sql(secret('auth-migration-password'),secret('auth-runtime-password')))
        return {'roles':2}
    def auth_roles():
        count=docker.sql("SELECT count(*) FROM pg_roles WHERE rolname IN ('village_auth_migrator','village_auth_runtime') AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole;").strip()
        return {'roles':int(count)}
    gate.step('auth-owners',auth_owners,lambda row:row=={'roles':2}==auth_roles(),recover=auth_roles)
    def migrate():
        docker.run('run','--rm','--pull=never','--network',PROJECT+'_dbnet','--user',f'{os.geteuid()}:{os.getegid()}',
            '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--memory-swap','128m','--pids-limit','64',
            '--env-file',state/'secrets/auth-migrate.env',meta['auth_image_id'],'auth','migrate')
        return {'maximum':docker.sql('SELECT max(version) FROM auth.schema_migrations;').strip()}
    gate.step('auth-migrations',migrate,lambda row:row=={'maximum':'20260831180000'}=={'maximum':docker.sql('SELECT max(version) FROM auth.schema_migrations;').strip()},recover=lambda:{'maximum':docker.sql('SELECT max(version) FROM auth.schema_migrations;').strip()})
    def create_control():docker.sql(schema.CONTROL_SQL);return {'exists':True}
    def control_receipt():return {'exists':docker.sql("SELECT to_regclass('autonomous_control.installed_steps') IS NOT NULL;").strip()=='t'}
    gate.step('schema-control',create_control,lambda row:row=={'exists':True}==control_receipt(),recover=control_receipt)
    for name in meta['schema_steps']:
        text=(release/'schema'/name).read_text(encoding='utf-8');wanted_step={'sha256':schema.step_hash(text)}
        gate.step('schema-'+name.removesuffix('.sql'),lambda name=name,text=text:install_schema_step(docker,name,text),
            lambda row,wanted=wanted_step,name=name:row==wanted==read_schema_receipt(docker,name),recover=lambda name=name,text=text:install_schema_step(docker,name,text))
    docker.sql("BEGIN;SET LOCAL password_encryption='scram-sha-256';ALTER ROLE village_unified_login PASSWORD '"+secret('api-password')+"';ALTER ROLE village_auth_migrator NOLOGIN;COMMIT;")
    hba_install(docker,subnet,migration=False)
    gate.step('storage',lambda:copy_storage(storage_root,state,preflight['source_archive_sha256']),
        lambda row:row==verify_copied_storage(state,preflight['source_archive_sha256']),recover=lambda:copy_storage(storage_root,state,preflight['source_archive_sha256']))
    storage.write_private_json(state/'release.json',meta)
    def start():
        docker.run('compose','-f',state/'compose.json','up','-d','--no-build','--pull','never','auth','api','web')
        for attempt in range(50):
            try:return runtime_health(docker,state,meta)
            except (OSError,ValueError,RuntimeError):time.sleep(1)
        raise ValueError('AUTONOMOUS_RUNTIME_HEALTH_TIMEOUT')
    gate.step('runtime',start,lambda row:row==runtime_health(docker,state,meta),recover=lambda:runtime_health(docker,state,meta))
    load_script('provision-local-workers').provision(state,docker,meta)
    return {'status':'autonomous_internal_deployed_not_accepted','releaseId':meta['releaseId']}


def verify(meta,state=STATE):
    docker=DeployDocker(state);before=runtime_health(docker,state,meta)
    ids={name:docker.own_container(name,meta['releaseId'])['Id'] for name in (API,AUTH,PG,WEB)}
    docker.run('compose','-f',state/'compose.json','restart','api','auth','postgres','web');wait_pg(docker)
    for attempt in range(50):
        try:after=runtime_health(docker,state,meta);break
        except (OSError,ValueError,RuntimeError):time.sleep(1)
    else:raise ValueError('AUTONOMOUS_RESTART_HEALTH_FAILED')
    if ids!={name:docker.own_container(name,meta['releaseId'])['Id'] for name in ids}:raise ValueError('AUTONOMOUS_RESTART_IDENTITY_CHANGED')
    storage.write_private_json(state/'restart-proof.json',{'releaseId':meta['releaseId'],'same_containers':True,'verified_at':time.time()})
    return {'status':'autonomous_restart_verified_real_login_probe_required'}


def apply(meta,state=STATE):
    require_acceptance(state,meta);docker=DeployDocker(state);runtime_health(docker,state,meta)
    initial=storage.read_private_json(state/'initial-baseline.json');old=docker.inspect('village-web-web-1')
    if old.get('Id')!=initial['web_id'] or old.get('Image')!=initial['web_image']:raise ValueError('OLD_PUBLIC_WEB_IDENTITY_CHANGED')
    backup=load_script('backup-autonomous');destination=backup.backup(state,Path.home()/'village-autonomous-backups')
    # Backup restarted the original processes, which must become healthy
    # before the previous public listener is stopped.
    wait_runtime(docker,state,meta)
    require_acceptance(state,meta)
    write_once(state/'pre-apply-backup.json',json.dumps({'path':str(destination),'backup_sha256':storage.digest_file(destination/'backup.json')[0]},sort_keys=True))
    # Once the new listener is public, never auto-restore the Supabase-backed
    # writer. Retain both databases/files and report a failed switch explicitly.
    storage.write_private_json(state/'public-switch.json',{'releaseId':meta['releaseId'],'status':'pending','old_web_id':old['Id']})
    docker.run('stop','--time','30',old['Id'])
    storage.write_private_json(state/'compose.json',compose_document(state,meta,uid=os.geteuid(),gid=os.getegid(),public=True))
    docker.run('compose','-f',state/'compose.json','up','-d','--no-deps','--no-build','--pull','never','web')
    wait_runtime(docker,state,meta)
    prepare_tls=load_script('prepare-ip-tls')
    with prepare_tls.tls_lock(state):prepare_tls.perform(state,'renew-test')
    import pwd
    operator=pwd.getpwuid(os.geteuid()).pw_name
    if Path.home()!=Path('/home')/operator:raise ValueError('STANDARD_OPERATOR_HOME_REQUIRED_FOR_TIMER')
    prepare_tls.install_timer(state,operator)
    backup.install_timer(state,operator)
    storage.write_private_json(state/'public-switch.json',{'releaseId':meta['releaseId'],'status':'public_https_core_not_gpu_accepted','old_web_id':old['Id'],'applied_at':time.time()})
    return {'status':'autonomous_public_https_core_requires_browser_and_gpu_acceptance','origin':'https://8.148.248.237'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group(required=True)
    for name in ('check','deploy','verify','apply'):group.add_argument('--'+name,action='store_const',const=name,dest='mode')
    parser.add_argument('--image-archive',type=Path);parser.add_argument('--backup-dir',type=Path);parser.add_argument('--storage-dir',type=Path);args=parser.parse_args()
    try:
        if os.name!='posix' or os.geteuid()==0:raise ValueError('LINUX_OPERATOR_REQUIRED')
        os.umask(0o077);STATE.mkdir(mode=0o700,exist_ok=True)
        if Path(__file__).parent.name!='control' and (STATE/'release.json').exists():
            deployed=storage.read_private_json(STATE/'release.json')
            if deployed.get('kind')!='autonomous' or tree_digest(STATE/'control')!=deployed.get('control_sha256'):raise ValueError('FROZEN_CONTROL_RELEASE_DIFFERS')
            os.execv(sys.executable,[sys.executable,str(STATE/'control/deploy-autonomous.py'),*sys.argv[1:]])
        with operation_lock(STATE):
            meta=read_meta()
            if args.mode in ('check','deploy'):
                previous=storage.read_private_json(STATE/'inputs.json') if (STATE/'inputs.json').exists() else {}
                archive=args.image_archive or previous.get('archive');backup=args.backup_dir or previous.get('backup');source=args.storage_dir or previous.get('storage')
                if not all((archive,backup,source)):raise ValueError('ALL_VERIFIED_INPUT_PATHS_REQUIRED')
                result=check(meta,archive,backup,source) if args.mode=='check' else deploy(meta,archive,backup,source)
                if args.mode=='check':result={'status':'autonomous_preflight_passed_no_containers_or_data_changed'}
            else:result=verify(meta) if args.mode=='verify' else apply(meta)
        print(json.dumps(result));return 0
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        print('STOP: AUTONOMOUS_DEPLOYMENT_FAILED. Retain candidate, checkpoints, files and private logs. Do not reset data or run the legacy cutover.');return 1


if __name__=='__main__':raise SystemExit(main())
