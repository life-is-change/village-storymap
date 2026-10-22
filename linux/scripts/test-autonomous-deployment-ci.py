#!/usr/bin/env python3
"""DISPOSABLE GITHUB ONLY. Real coordinator/GoTrue/files/own-restore, synthetic source.

CA trust/old-static identity/CI attestation are injected fixture boundaries;
no request reaches the real Supabase, public IP, CA, provider or campus GPU.
"""
import os
import sys


def guard():
    if os.name!='posix' or os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_OS')!='Linux' or os.environ.get('VILLAGE_TEST_AUTONOMOUS_RUNTIME')!='1':
        raise SystemExit('DISPOSABLE_AUTONOMOUS_COORDINATOR_REQUIRED')


def main():
    guard()
    import contextlib
    import datetime as dt
    import hashlib
    import json
    import io
    from pathlib import Path
    import re
    import shutil
    import ssl
    import subprocess
    import tempfile
    import time
    from unittest.mock import patch
    import business_storage_copy as storage
    import autonomous_bundle as bundle
    import autonomous_tls as tls
    from autonomous_operator import PG,API,AUTH,WEB,OLD_CANDIDATES,stop_receipt,DATABASE
    from autonomous_extract import tree_digest
    repo=Path(__file__).resolve().parents[2]
    # Do not repurpose HOME or modify its permissions. Every candidate/input
    # path is explicitly injected into a newly allocated disposable fixture.
    root=Path(tempfile.mkdtemp(prefix='village-autonomous-ci-',dir=os.environ['RUNNER_TEMP']));root.chmod(0o700)
    state=root/'state';state.mkdir(mode=0o700);phase='guard';created=[];meta=None;last_request={}
    source='village-unified-ci';old_web='village-web-web-1';checker='village-autonomous-backup-check-ci'
    prefix=['docker','--context','default']
    cache={}
    original_load=bundle.load_script
    def load(name):
        if name not in cache:cache[name]=original_load(name)
        return cache[name]
    def run(command,*,input=None,timeout=180):
        error=root/('ci-command-'+str(time.time_ns())+'.log')
        with error.open('xb') as errors:
            error.chmod(0o600)
            process=subprocess.run(command,input=input.encode() if isinstance(input,str) else input,stdout=subprocess.PIPE,stderr=errors,timeout=timeout)
        if process.returncode:raise RuntimeError('DISPOSABLE_COMMAND_FAILED')
        return process.stdout
    def docker(*args,**kwargs):return run([*prefix,*map(str,args)],**kwargs)
    def sql(query,container=source,database=DATABASE,user='village_test_admin'):
        return docker('exec','-i',container,'psql','-X','-q','-w','-A','-t','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-U',user,'-d',database,input=query).decode()
    def stream(args,path,**kwargs):return load('backup-autonomous').stream_command([*prefix,*args],path,**kwargs)
    try:
        if docker('context','inspect','default','--format','{{.Endpoints.docker.Host}}').strip()!=b'unix:///var/run/docker.sock':raise ValueError('DISPOSABLE_LOCAL_ENGINE_REQUIRED')
        info=json.loads(docker('inspect',source))[0]
        if info['Name']!='/'+source or info['Image'] not in load('restore-db-copy').IMAGE_IDS or not info['HostConfig']['PortBindings'].get('5432/tcp')==[{'HostIp':'127.0.0.1','HostPort':'55441'}]:raise ValueError('DISPOSABLE_SOURCE_IDENTITY_DIFFERS')
        for name in [PG,API,AUTH,WEB,old_web,checker,*OLD_CANDIDATES]:
            exists=subprocess.run([*prefix,'container','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
            if exists:raise ValueError('DISPOSABLE_TARGET_NAME_ALREADY_EXISTS')
        phase='snapshot';backup=root/'source-backup';backup.mkdir(mode=0o700)
        stream(['exec',source,'pg_dump','--format=custom','-h','/var/run/postgresql','-U','village_test_admin','-d',DATABASE],backup/'database.dump',maximum=64*1024**2)
        stream(['exec',source,'pg_dumpall','--roles-only','--no-role-passwords','-h','/var/run/postgresql','-U','village_test_admin'],backup/'roles.sql',maximum=8*1024**2)
        inventory=json.loads(sql(load('backup-managed-db').INVENTORY_SQL));storage.write_private_json(backup/'inventory.json',inventory)
        stream(['exec','-i',source,'pg_restore','--list'],backup/'contents.txt',maximum=8*1024**2,input_path=backup/'database.dump')
        now=dt.datetime.now(dt.timezone.utc).isoformat()
        manifest={'status':'archive_verified_not_restored','started_at_utc':now,'completed_at_utc':now,
            'source':{'host':'aws-1-ap-northeast-1.pooler.supabase.com','database':'postgres','user':'postgres.'+storage.PROJECT},
            'fixture_only':True,'files':{name:{'bytes':(backup/name).stat().st_size,'sha256':storage.digest_file(backup/name)[0]} for name in ('database.dump','roles.sql','inventory.json','contents.txt')}}
        storage.write_private_json(backup/'manifest.json',manifest)
        pg_image=info['Image'];uid=os.geteuid();gid=os.getegid();archive_sha=manifest['files']['database.dump']['sha256']
        auth_prepare=load('prepare-local-auth')
        report=bundle.decode_stream(bundle.offline_restore_command(backup,image_id=pg_image,schema='auth',tables=auth_prepare.TABLES,uid=uid,gid=gid),auth_prepare.summarize_auth_copy)
        doc=bundle.decode_stream(bundle.offline_restore_command(backup,image_id=pg_image,schema='storage',tables=('buckets','objects'),uid=uid,gid=gid),
            lambda lines:bundle.inventory_from_copy(lines,archive_sha256=archive_sha,generated_at=now))
        if report['users']!=4 or len(doc['objects'])!=3 or {o['bucket'] for o in doc['objects']}!={'house-photos','geoprocessing-results','facade-generation'}:raise ValueError('DISPOSABLE_SOURCE_FIXTURE_DIFFERS')
        inputs=load('prepare-autonomous-inputs');source_files=inputs.initialize_inputs(root/'source-files',doc,report)
        payload=b'synthetic legacy private bytes\n'
        class FixtureBody(io.BytesIO):
            headers={'ETag':'"fixture-etag"'}
        class FixtureSource:
            def verify_inventory(self,value):
                if value!=doc:raise ValueError('FIXTURE_SOURCE_INVENTORY_DIFFERS')
            def head(self,obj):
                if obj['declared_size']!=len(payload):raise ValueError('FIXTURE_SOURCE_SIZE_DIFFERS')
                return {'size':len(payload),'etag':'"fixture-etag"'}
            def get(self,obj,etag):
                if etag!='"fixture-etag"':raise ValueError('FIXTURE_SOURCE_ETAG_DIFFERS')
                return FixtureBody(payload)
        storage.copy_inventory(source_files/'inventory.json',source_files,'sb_secret_'+'x'*40,FixtureSource(),selected_buckets=storage.all_inventory_buckets(doc),check_source_inventory=True)
        storage.write_private_json(source_files/'full-copy-proof.json',{'version':1,'status':'all_source_storage_verified_not_cut_over',
            'source_archive_sha256':archive_sha,'inventory_sha256':storage.inventory_digest(doc),'objects':3,'verified_bytes':3*len(payload),'fixture_only':True})
        phase='public-images'
        for name in ('auth','nginx'):
            runtime=json.loads((repo/'linux'/(name+'-runtime.json')).read_text())
            docker('pull',runtime['image'])
        tools=root/'tools';tools.mkdir(mode=0o700)
        env={**os.environ,'GOBIN':str(tools)}
        with (root/'go-install.log').open('xb') as log:
            if subprocess.run(['go','install','github.com/google/go-containerregistry/cmd/crane@v0.22.1'],env=env,stdout=log,stderr=log,timeout=300).returncode:raise ValueError('PINNED_CRANE_INSTALL_FAILED')
        base=root/'node-base.tar';node_builder=load('build-business-api-image')
        for reference in ['public.ecr.aws/docker/library/node@'+node_builder.BASE,'node@'+node_builder.BASE]:
            try:run([str(tools/'crane'),'pull','--platform','linux/amd64',reference,str(base)],timeout=180);break
            except RuntimeError:continue
        else:raise ValueError('PINNED_NODE_BASE_UNAVAILABLE')
        phase='assembly';assembler=load('build-autonomous-release');old_builder=load('build-unified-release')
        # Deliberately retain the shipped legacy TEST template so this fixture
        # proves recovery of the actual already-installed immutable release.
        assembler.test_context_template=assembler.legacy_test_context_template
        browser_repair=load('repair-autonomous-browser')
        original_schema_bundle=assembler.schema_bundle
        def legacy_browser_schema(root_path):
            values=original_schema_bundle(root_path)
            for key in ('catalog.sql','survey.sql'):
                values[key]=values[key].replace(browser_repair.TIMESTAMP,'x.created_at').replace("(to_jsonb(profiles)->>'created_at') AS created_at,disabled_at",'disabled_at')
            values['files.sql']=values['files.sql'].replace(browser_repair.ADMIN_PHOTO_GATE,browser_repair.LEGACY_PHOTO_GATE).replace(browser_repair.ADMIN_LOCAL_GATE,browser_repair.LEGACY_LOCAL_GATE)
            return values
        assembler.schema_bundle=legacy_browser_schema
        original_stage=assembler.stage_autonomous
        def legacy_browser_stage(root_path,target,**kwargs):
            result=original_stage(root_path,target,**kwargs)
            for pdf in (Path(target)/'assets/lessons').glob('lesson*.pdf'):pdf.unlink()
            client=Path(target)/'features/villages/village-client.js'
            client.write_text(client.read_text().replace("call('catalog.listSpaces',{teachingProjectId:input.teachingProjectId,villageId:input.villageId})","call('catalog.listSpaces',input)"))
            app=Path(target)/'app.js'
            app.write_text(app.read_text().replace('createObjectCommentDeps({\n    services: window.VillageBusinessServices,','createObjectCommentDeps({'))
            deps=Path(target)/'features/object-collaboration/object-info-deps.js'
            deps.write_text(deps.read_text().replace('services, getClient','getClient'))
            return result
        assembler.stage_autonomous=legacy_browser_stage
        old_builder.verified_ci=lambda *args,**kwargs:{'native_run_id':1,'native_status':'success','platform_run_id':2,'platform_status':'success','fixture_only':True}
        assembler.load_script=load
        archive=root/'autonomous-fixture.tar.gz';meta=assembler.build(repo,base,archive,native_run=1,platform_run=2)
        print('FIXTURE_RUNTIME_DIGESTS '+json.dumps({key:meta[key] for key in ('archive_sha256','code_sha256','schema_sha256','static_sha256','control_sha256')}),flush=True)
        docker('load','-i',archive)
        phase='synthetic-tls';proxy=load('test-autonomous-proxy-ci');cert,key=proxy.fixture_certificate(root,'coordinator')
        (state/'tls').mkdir(mode=0o700);tls.atomic_certificate(state/'tls',fullchain=cert.read_bytes(),private_key=key.read_bytes(),reload=lambda:None)
        (state/'certbot-production/config').mkdir(mode=0o700,parents=True)
        original_context=ssl.create_default_context
        def fixture_context(*args,**kwargs):
            if not args and not any(kwargs.get(k) for k in ('cafile','capath','cadata')):kwargs['cafile']=str(cert)
            return original_context(*args,**kwargs)
        original_leaf=tls.validate_leaf
        def fixture_leaf(value,**kwargs):
            if ('IP Address','8.148.248.237') not in value.get('subjectAltName',()):raise ValueError('FIXTURE_IP_SAN_REQUIRED')
            # This is deliberately not a public-CA production proof.
            return {'ip':'8.148.248.237','remaining_hours':23,'expires_at':'fixture-only'}
        def fixture_pair(chain,private_key,**kwargs):
            run(['openssl','verify','-CAfile',str(cert),'-verify_ip','8.148.248.237',str(chain)])
            public_a=run(['openssl','x509','-in',str(chain),'-noout','-pubkey'])
            public_b=run(['openssl','pkey','-in',str(private_key),'-pubout'])
            if public_a!=public_b:raise ValueError('FIXTURE_TLS_KEY_DIFFERS')
            return fixture_leaf(ssl._ssl._test_decode_cert(str(chain)))
        deploy=load('deploy-autonomous');prepare_tls=load('prepare-ip-tls')
        # A fixed-name old site is fixture-owned. Production's stricter old
        # custom-image identity guard remains covered separately and unchanged.
        nginx=meta['nginx_image_id']
        candidate_mounts=root/'candidate-mounts';candidate_mounts.mkdir(mode=0o700)
        for part in ('a','b'):(candidate_mounts/part).mkdir(mode=0o700)
        for name,(project,service) in OLD_CANDIDATES.items():
            mounts=[]
            if name in ('village-storage-validation-api','village-api-validation-postgres'):
                for part in ('a','b'):mounts+=['--mount',f'type=bind,source={candidate_mounts/part},target=/fixture/{part},readonly']
            docker('run','--detach','--init','--name',name,'--network','none','--label','com.docker.compose.project='+project,
                '--label','com.docker.compose.service='+service,*mounts,'--entrypoint','/bin/sleep',nginx,'1200');created.append(name)
        docker('run','--detach','--init','--name',old_web,'--network','none','--entrypoint','/bin/sleep',nginx,'1200');created.append(old_web)
        old_info=json.loads(docker('inspect',old_web))[0]
        def legacy_baseline(d):
            receipts=[]
            for name in OLD_CANDIDATES:
                row=d.inspect(name);receipt=stop_receipt(row)
                mounts=sorted([{'source':m['Source'],'target':m['Destination'],'rw':m['RW']} for m in row['Mounts']],key=lambda m:m['target'],reverse=True)
                receipt['mounts_sha256']=hashlib.sha256(json.dumps(mounts,sort_keys=True).encode()).hexdigest();receipts.append(receipt)
            return {'web_id':old_info['Id'],'web_image':old_info['Image'],'config_sha256':'0'*64,'candidates':receipts}
        deploy.baseline=legacy_baseline
        def dry_run(st,mode):
            if mode!='renew-test':raise ValueError('NO_REAL_CA_CALLS_IN_FIXTURE')
            prepare_tls.verify_acme_webroot(st/'acme',port=80);prepare_tls.reload_current(deploy.DeployDocker(st),meta,st/'tls')
            return {'fixture_webroot_reload':True,'ca_called':False}
        original_timer=prepare_tls.install_timer
        def fake_timer(st,user):
            units=root/'system-unit-fixture';units.mkdir(exist_ok=True);calls=[]
            result=original_timer(st,user,units=units,run=lambda *args:calls.append(args))
            if not any('enable' in args for args in calls):raise ValueError('FIXTURE_TIMER_NOT_CHECKED')
            return result
        prepare_tls.perform=dry_run;prepare_tls.install_timer=fake_timer
        own_backup=load('backup-autonomous');original_backup_timer=own_backup.install_timer
        def fake_backup_timer(st,user):
            units=root/'system-unit-fixture';units.mkdir(exist_ok=True);calls=[]
            result=original_backup_timer(st,user,units=units,run=lambda *args:calls.append(args))
            if not any('village-autonomous-backup.timer' in args for args in calls):raise ValueError('FIXTURE_BACKUP_TIMER_NOT_CHECKED')
            return result
        own_backup.install_timer=fake_backup_timer
        # All injected trust is scoped to this guarded CI process. The archived
        # control files still contain the real, strict production implementations.
        deploy.load_script=load
        with patch.object(ssl,'create_default_context',side_effect=fixture_context),patch.object(tls,'validate_leaf',side_effect=fixture_leaf),patch.object(tls,'verify_certificate_pair',side_effect=fixture_pair):
            phase='legacy-mount-pending-stop';original_stop=deploy.stop_old_candidates
            def interrupted(*args):raise RuntimeError('SYNTHETIC_INTERRUPTION_BEFORE_ANY_STOP')
            deploy.stop_old_candidates=interrupted
            try:
                deploy.deploy(meta,archive,backup,source_files,state=state)
                raise ValueError('FIXTURE_STOP_INTERRUPT_NOT_REACHED')
            except RuntimeError as error:
                if str(error)!='SYNTHETIC_INTERRUPTION_BEFORE_ANY_STOP':raise
            finally:deploy.stop_old_candidates=original_stop
            repair=load('repair-autonomous-candidate-order');repair.load_script=load
            deploy.read_meta=lambda:meta
            before_baseline=(state/'initial-baseline.json').read_bytes()
            repair.repair(state)
            if (state/'initial-baseline.json').read_bytes()!=before_baseline:raise ValueError('FIXTURE_BASELINE_WAS_MODIFIED')
            print('LEGACY_CANDIDATE_ORDER_PENDING_RECOVERY_VERIFIED',flush=True)
            phase='legacy-personal-schema'
            try:
                deploy.deploy(meta,archive,backup,source_files,state=state)
                raise ValueError('LEGACY_PERSONAL_MISSING_COLUMN_NOT_REPRODUCED')
            except RuntimeError as error:
                if str(error)!='DOCKER_OPERATION_FAILED':raise
            phase='legacy-personal-rollback'
            pending=storage.read_private_json(state/'autonomous-checkpoints.json')
            if pending['steps'].get('schema-files',{}).get('status')!='pending':raise ValueError('WRONG_LEGACY_SCHEMA_FAILURE')
            d=deploy.DeployDocker(state)
            if deploy.read_schema_receipt(d,'files.sql') is not None or d.sql("SELECT to_regclass('api_private.file_sessions') IS NULL;").strip()!='t':raise ValueError('FILES_TRANSACTION_NOT_ROLLED_BACK')
            legacy_repair=load('repair-autonomous-personal-context');legacy_repair.load_script=load
            original_steps=(state/'autonomous-checkpoints.json').read_bytes()
            phase='legacy-personal-repair'
            legacy_repair.repair(state);legacy_repair.repair(state)
            if (state/'autonomous-checkpoints.json').read_bytes()!=original_steps:raise ValueError('LEGACY_SCHEMA_REPAIR_CHANGED_CHECKPOINTS')
            phase='legacy-personal-owner-ensure'
            # Existing rows are not auto-assigned. Explicit owner ensure is the
            # only path that may attach a legacy personal space to a project.
            if d.sql('SELECT count(*) FROM public.course_personal_spaces WHERE teaching_project_id IS NOT NULL;').strip()!='0':raise ValueError('LEGACY_PERSONAL_ROWS_REASSIGNED')
            own=d.sql("BEGIN;SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);SELECT (public.ensure_course_personal_space('course','a0000000-0000-4000-8000-000000000001'::uuid,'b0000000-0000-4000-8000-000000000001','formal_personal','Owned legacy')).id;ROLLBACK;")
            if 'a0000000-0000-4000-8000-000000000001' not in own:raise ValueError('LEGACY_OWNER_ENSURE_NOT_VERIFIED')
            print('LEGACY_PERSONAL_SCHEMA_ATOMIC_REPAIR_VERIFIED',flush=True)
            phase='coordinator-deploy';result=deploy.deploy(meta,archive,backup,source_files,state=state)
            if result['status']!='autonomous_internal_deployed_not_accepted':raise ValueError('FIXTURE_DEPLOY_STATUS_DIFFERS')
            for name in (PG,API,AUTH,WEB):created.append(name)
            phase='legacy-frozen-bytecode'
            control=state/'control';control.chmod(0o700)
            run(['env','PYTHONDONTWRITEBYTECODE=0',sys.executable,'-c',
                 'import sys;sys.path.insert(0,sys.argv[1]);import autonomous_operator,autonomous_extract,autonomous_schema',str(control)])
            if not list((control/'__pycache__').glob('*.pyc')) or tree_digest(control)==meta['control_sha256']:
                raise ValueError('LEGACY_BYTECODE_DRIFT_NOT_REPRODUCED')
            cache_repair=load('repair-autonomous-control-cache');cache_repair.load_script=load
            if cache_repair.repair(state)<1 or cache_repair.repair(state)!=0:raise ValueError('CACHE_QUARANTINE_NOT_IDEMPOTENT')
            # Exercise actual frozen CLI imports with bytecode writes enabled;
            # directory permissions must protect timer/direct calls too.
            run(['env','PYTHONDONTWRITEBYTECODE=0',sys.executable,str(control/'deploy-autonomous.py'),'--help'])
            if tree_digest(control)!=meta['control_sha256'] or (control/'__pycache__').exists():raise ValueError('FROZEN_CLI_RECREATED_BYTECODE')
            print('FROZEN_CLI_BYTECODE_QUARANTINE_AND_READONLY_SOURCE_VERIFIED',flush=True)
            phase='coordinator-restart';deploy.verify(meta,state)
            phase='real-local-auth';probe=load('probe-autonomous');d=deploy.DeployDocker(state)
            def restart():
                before=d.own_container(API,meta['releaseId']);deploy.verify(meta,state);after=d.own_container(API,meta['releaseId'])
                return {'same_container':before['Id']==after['Id'],'started_at_changed':before['State']['StartedAt']!=after['State']['StartedAt']}
            api=probe.AutonomousHttpApi(port=18443,prepare_context=probe.context_callback(d,state),restart=restart,
                persist=lambda value:storage.write_private_json(state/'business-probe-state.json',value),
                resources=lambda:{'fixture':True},task_proof=lambda:{'verified':True,'releaseId':meta['releaseId'],'real_jobs':False})
            original_request=api.request_impl
            def traced_request(path,method,headers,data,binary):
                # Fixed route names and HTTP status only; never headers/body or
                # identifying path segments from the synthetic private fixture.
                last_request.clear();last_request.update(method=method,route=re.sub(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}','UUID',path.split('?')[0])[:160])
                result=original_request(path,method,headers,data,binary);last_request['status']=result[0]
                return result
            api.request_impl=traced_request
            original_load_probe=api.load_probe
            def traced_load(*args,**kwargs):
                rows=original_load_probe(*args,**kwargs)
                print('FIXTURE_LOAD_REPORT '+json.dumps(rows),flush=True)
                return rows
            api.load_probe=traced_load
            core=probe.auth_probe(api,('332','synthetic-ci-password-0001'))
            phase='legacy-test-baseline'
            try:
                probe.old.run_probe(api,('332','synthetic-ci-password-0001'),('student','synthetic-ci-password-0001'),{})
                raise ValueError('MISSING_TEST_BASELINE_NOT_REPRODUCED')
            except probe.old.ProbeFailure as error:
                if (error.phase,error.code,error.status)!=('planning','DB_UNAVAILABLE',503):raise
            # Prove rollback and the actual constraint from the authoritative DB.
            if d.sql("SELECT count(*) FROM public.planning_features WHERE space_id='unified-test-autonomous-20261021';").strip()!='0':raise ValueError('FAILED_TEST_SAVE_NOT_ROLLED_BACK')
            if d.sql("SELECT attnotnull FROM pg_attribute WHERE attrelid='public.survey_feature_reviews'::regclass AND attname='base_dataset_id';").strip()!='t':raise ValueError('REAL_BASELINE_NOT_NULL_REQUIRED')
            def ordinary_digest():
                return d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,'[]')) FROM public.village_datasets d WHERE village_id<>'c4a00000-0000-4000-8000-000000000001'::uuid;").strip()
            baseline_digest=ordinary_digest()
            test_repair=load('repair-autonomous-test-dataset');test_repair.load_script=load
            test_repair.repair(state,docker=d);test_repair.repair(state,docker=d)
            if ordinary_digest()!=baseline_digest:raise ValueError('ORDINARY_DATASETS_CHANGED')
            print('AUTONOMOUS_TEST_BASELINE_NOT_NULL_REPAIR_VERIFIED',flush=True)
            previous=storage.read_private_json(state/'business-probe-state.json')
            phase='business-whole-flow';full=probe.old.run_probe(api,('332','synthetic-ci-password-0001'),('student','synthetic-ci-password-0001'),previous)
            if full.get('restart_persistence') is not True:raise ValueError('FIXTURE_BUSINESS_RESTART_FAILED')
            storage.write_private_json(state/'acceptance.json',{'status':'local_auth_business_verified_not_cut_over','releaseId':meta['releaseId'],
                'accepted_at':time.time(),**core,'business_restart':True,'fixture_only':True})
            phase='certbot-public-file-permissions'
            cert_config=state/'certbot-production/config'
            cert_files=[]
            for index in range(8):
                path=cert_config/('synthetic-certbot-'+str(index)+'.pem')
                path.write_bytes(b'SYNTHETIC CERTBOT PUBLIC BYTES\n');path.chmod(0o644);cert_files.append(path)
            readonly_key=cert_config/'synthetic-readonly-key.pem'
            readonly_key.write_bytes(b'SYNTHETIC READONLY PRIVATE BYTES\n');readonly_key.chmod(0o400)
            # Reproduce the precise mismatch: layout accepts Certbot's public
            # files, but the frozen final digest requires private permissions.
            own_backup.backup_layout(state,meta)
            try:storage.digest_file(cert_files[0])
            except ValueError:pass
            else:raise ValueError('CERTBOT_PRIVATE_DIGEST_FAILURE_NOT_REPRODUCED')
            repair_permissions=load('repair-autonomous-certbot-permissions')
            frozen_before=tree_digest(state/'control')
            with repair_permissions.tls_lock(state):
                if repair_permissions.repair(state)!=8:raise ValueError('CERTBOT_REPAIR_COUNT_DIFFERS')
            if tree_digest(state/'control')!=frozen_before:raise ValueError('CERTBOT_REPAIR_CHANGED_CONTROL')
            if readonly_key.stat().st_mode&0o777!=0o400 or storage.digest_file(readonly_key)!=(hashlib.sha256(b'SYNTHETIC READONLY PRIVATE BYTES\n').hexdigest(),len(b'SYNTHETIC READONLY PRIVATE BYTES\n')):
                raise ValueError('CERTBOT_READONLY_KEY_CHANGED')
            for path in cert_files:
                if storage.digest_file(path)!=(hashlib.sha256(b'SYNTHETIC CERTBOT PUBLIC BYTES\n').hexdigest(),len(b'SYNTHETIC CERTBOT PUBLIC BYTES\n')):
                    raise ValueError('CERTBOT_REPAIR_CHANGED_BYTES')
            print('CERTBOT_PUBLIC_FILE_PRIVATE_BACKUP_COMPATIBILITY_VERIFIED',flush=True)
            phase='public-listener-and-backup';public=deploy.apply(meta,state)
            if public['status']!='autonomous_public_https_core_requires_browser_and_gpu_acceptance':raise ValueError('FIXTURE_PUBLIC_STATUS_DIFFERS')
            phase='own-backup-restore';receipt=storage.read_private_json(state/'pre-apply-backup.json');own=Path(receipt['path'])
            empty=root/'check-empty-init';empty.mkdir(mode=0o755);empty.chmod(0o755)
            docker('run','--detach','--name',checker,'--network','none','--read-only','--memory','384m','--tmpfs','/var/lib/postgresql/data:size=256m,mode=0700',
                '--tmpfs','/tmp:size=32m,mode=1777','--tmpfs','/var/run/postgresql:size=16m,mode=3775',
                '--mount',f'type=bind,source={empty},target=/docker-entrypoint-initdb.d,readonly',
                '--env','POSTGRES_USER=village_backup_check_admin','--env','POSTGRES_PASSWORD=synthetic-backup-check-only','--env','POSTGRES_DB=restore_control',
                '--env','PGDATA=/var/lib/postgresql/data',pg_image,'postgres','-D','/var/lib/postgresql/data','-c','shared_buffers=32MB','-c','max_connections=10',
                '-c','shared_preload_libraries=pg_stat_statements','-c','max_locks_per_transaction=256');created.append(checker)
            for attempt in range(50):
                ready=subprocess.run([*prefix,'exec',checker,'pg_isready','-h','127.0.0.1','-U','village_backup_check_admin','-d','restore_control'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
                if ready:break
                time.sleep(1)
            else:raise ValueError('BACKUP_CHECK_PG_NOT_READY')
            sql(load('backup-autonomous').recovery_roles_sql(storage.private_path(own/'roles.sql').read_text(),'village_backup_check_admin'),checker,'restore_control','village_backup_check_admin')
            sql('CREATE DATABASE '+DATABASE+' OWNER postgres TEMPLATE template0;',checker,'restore_control','village_backup_check_admin')
            stream(['exec','-i',checker,'pg_restore','--exit-on-error','--single-transaction','-h','/var/run/postgresql','-U','village_backup_check_admin','-d',DATABASE],
                root/'own-restore-output.txt',maximum=1024**2,input_path=own/'database.dump')
            decoded=root/'own-decoded.sql';stream(['exec','-i',checker,'pg_restore','--data-only','--file=-'],decoded,maximum=64*1024**2,input_path=own/'database.dump')
            rd=load('restore-db-copy');expected=rd.parse_data_snapshot(decoded.read_text())
            class Restored:
                def sql(self,q):return sql(q,checker,DATABASE,'village_backup_check_admin')
            rd.compare_snapshot(expected,rd.actual_snapshot(Restored(),expected))
            for name,record in storage.read_private_json(own/'backup.json')['files'].items():
                if storage.digest_file(own/name)!=(record['sha256'],record['bytes']):raise ValueError('OWN_BACKUP_FILE_DIGEST_DIFFERS')
            phase='public-browser-compatibility'
            d.sql('ALTER TABLE public.object_photos DROP COLUMN created_at;')
            api.port=443
            actor=api.login(('332','synthetic-ci-password-0001'))
            route=api.routes['admin.listPhotos']
            try:api.request(api.base+route['path'],actor,method=route['method'],data={})
            except probe.old.TransportFailure as error:
                if error.code!='DB_UNAVAILABLE':raise
            else:raise ValueError('LEGACY_PHOTO_COLUMN_FAILURE_NOT_REPRODUCED')
            # Reproduce the exact already-installed v1 hotfix, including its
            # receipt and mount. The v2 installer must upgrade this state too.
            release=state/'releases'/meta['releaseId']
            previous_root=state/'files'/browser_repair.PREVIOUS_PATCH
            previous_root.mkdir(mode=0o700)
            shutil.copytree(release/'web',previous_root/'web',copy_function=shutil.copyfile)
            for p in [previous_root/'web',*(previous_root/'web').rglob('*')]:p.chmod(0o700 if p.is_dir() else 0o600)
            previous_files=browser_repair.previous_manifest(browser_repair.inputs(repo),browser_repair.PREVIOUS_PATCH)
            for name,value in previous_files.items():
                p=previous_root/'web'/name;p.parent.mkdir(parents=True,mode=0o700,exist_ok=True);p.write_bytes(value);p.chmod(0o600)
            previous_sql=browser_repair.photo_sql((release/'schema/catalog.sql').read_text(),(release/'schema/survey.sql').read_text())
            d.sql(previous_sql)
            storage.write_private_json(previous_root/'receipt.json',{'releaseId':meta['releaseId'],'files':{k:hashlib.sha256(v).hexdigest() for k,v in previous_files.items()},'sql_sha256':hashlib.sha256(previous_sql.encode()).hexdigest(),'phase':'served_verified_browser_login_pending'})
            storage.write_private_json(previous_root/'overlay-proof.json',{'tree_sha256':tree_digest(previous_root/'web')})
            doc=browser_repair.overlay_compose(storage.read_private_json(state/'compose.json'),previous_root,original_source=release/'web')
            storage.write_private_json(state/'compose.json',doc)
            d.run('compose','-f',state/'compose.json','up','-d','--no-deps','--no-build','--pull','never','web')
            for attempt in range(15):
                try:browser_repair.check_served('features/villages/village-client.js',previous_files['features/villages/village-client.js'],443);break
                except (OSError,ValueError):
                    if attempt==14:raise
                    time.sleep(1)
            legacy_id=d.sql("SELECT id FROM storage.objects WHERE bucket_id='house-photos' LIMIT 1;").strip()
            # The source fixture's copied Storage object was deliberately an
            # orphan. Keep orphan denial, then explicitly register a TEST photo
            # to reproduce the real administrator's unscoped legacy record.
            try:api.request(api.base+'/api/v1/files/'+legacy_id,actor,binary=True)
            except probe.old.TransportFailure as error:
                if error.code!='FORBIDDEN':raise
            else:raise ValueError('UNREGISTERED_STORAGE_OBJECT_WAS_READABLE')
            d.sql("INSERT INTO public.object_photos(object_code,object_type,photo_url,photo_path,file_id) SELECT 'synthetic-admin-legacy','building','synthetic://legacy',name,id FROM storage.objects WHERE id='"+legacy_id+"'::uuid;")
            try:api.request(api.base+'/api/v1/files/'+legacy_id,actor,binary=True)
            except probe.old.TransportFailure as error:
                if error.code!='FORBIDDEN':raise
            else:raise ValueError('LEGACY_ADMIN_PHOTO_DENIAL_NOT_REPRODUCED')
            # Reject a globally matching H001 snapshot from a different space.
            # This deliberate transaction rolls back on the required error.
            before_legacy=d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]')::text) FROM public.planning_features f;")
            before_history=d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]')::text) FROM public.feature_versions f;")
            before_photos=d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]')::text) FROM public.object_photos f;")
            try:d.sql("BEGIN; UPDATE public.feature_snapshots SET space_id='A' WHERE id='d1b00000-0000-4000-8000-000000000001';"+browser_repair.h001_sql(repo,apply=True)+'COMMIT;')
            except RuntimeError:pass
            else:raise ValueError('FOREIGN_H001_BASELINE_WAS_ACCEPTED')
            if d.sql("SELECT count(1) FROM public.survey_feature_reviews WHERE object_code='H001';").strip()!='0':raise ValueError('H001_PREFLIGHT_WROTE_ROWS')
            browser_repair.load_script=load
            browser_repair.repair(state,repo,docker=d)
            result=browser_repair.repair(state,repo,apply=True,docker=d)
            if result['status']!='h001_review_and_local_comments_repaired_browser_check_required':raise ValueError('BROWSER_REPAIR_STATUS_DIFFERS')
            browser_repair.repair(state,repo,apply=True,docker=d)
            if before_legacy!=d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]')::text) FROM public.planning_features f;"):raise ValueError('LEGACY_GEOMETRY_CHANGED_DURING_REPAIR')
            if before_history!=d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]')::text) FROM public.feature_versions f;"):raise ValueError('LEGACY_HISTORY_CHANGED_DURING_REPAIR')
            h001={'teachingProjectId':'00000000-0000-4000-8000-000000000003','villageId':'00000000-0000-4000-8000-000000000001',
                  'spaceId':'practice-shared-00000000-0000-4000-8000-000000000003','layerKey':'building','objectCode':'H001'}
            def local_call(action,body):
                route=api.routes[action]
                return api.request(api.base+route['path'],actor,method=route['method'],data=body)['data']
            review=local_call('survey.getReview',h001)
            if (review['geometry_status'],review['geometry_revision'],review['is_v0_baseline'])!=('pending',0,True):raise ValueError('H001_WAS_NOT_PENDING_BASELINE')
            change={'action':'delete','layerKey':'building','objectCode':'H001','expectedGeometryRevision':0}
            save={k:v for k,v in h001.items() if k not in ('layerKey','objectCode')}
            import uuid
            try:local_call('planning.saveBatch',{**save,'changes':[{**change,'lockToken':str(uuid.uuid4())}],'summary':'TEST H001 delete','note':'TEST','requestId':str(uuid.uuid4())})
            except probe.old.TransportFailure:pass
            else:raise ValueError('H001_DELETE_WITHOUT_LEASE_ALLOWED')
            lease=local_call('planning.acquireLock',h001)
            local_call('planning.saveBatch',{**save,'changes':[{**change,'lockToken':lease['lockToken']}],'summary':'TEST H001 delete','note':'TEST','requestId':str(uuid.uuid4())})
            local_call('planning.releaseLock',{**h001,'lockToken':lease['lockToken']})
            browser_repair.repair(state,repo,apply=True,docker=d)
            review=local_call('survey.getReview',h001)
            if (review['geometry_status'],review['geometry_revision'],review['is_deleted'])!=('deleted',1,True):raise ValueError('H001_DELETE_WAS_RESET')
            if d.sql("SELECT count(1) FROM public.feature_versions WHERE space_id='practice-shared-00000000-0000-4000-8000-000000000003' AND layer_key='building' AND object_code='H001' AND action='delete';").strip()!='1':raise ValueError('H001_DELETE_HISTORY_REQUIRED')
            if before_photos!=d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]')::text) FROM public.object_photos f;"):raise ValueError('LEGACY_PHOTOS_CHANGED_DURING_DELETE')
            photos=api.request(api.base+route['path'],actor,method=route['method'],data={})['data']
            if not isinstance(photos,list):raise ValueError('LEGACY_PHOTOS_NOT_REPAIRED')
            photo_bytes=api.request(api.base+'/api/v1/files/'+legacy_id,actor,binary=True)
            if photo_bytes!=payload:raise ValueError('ADMIN_LEGACY_PHOTO_READ_FAILED')
            print('PUBLIC_BROWSER_ENTRY_LESSONS_PHOTO_COMPATIBILITY_VERIFIED',flush=True)
            print('H001_BASELINE_REPAIR_LEASED_DELETE_HISTORY_AND_REPEAT_VERIFIED',flush=True)
            phase='campus-public-registration'
            create_keys=load('prepare-campus-local-credentials');register_keys=load('register-campus-local-workers')
            campus_keys=root/'campus-private-keys';campus_keys.mkdir(mode=0o700)
            public=register_keys.decode(create_keys.prepare(campus_keys))
            old_workers=d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]')::text) FROM api_private.local_gpu_workers w WHERE name IN ('campus-geo','campus-facade');")
            register_keys.register(state,public,docker=d);register_keys.register(state,public,docker=d)
            import socket,http.client
            for kind in ('geo','facade'):
                key=storage.private_path(campus_keys/('aliyun-'+kind+'.key')).read_text().strip()
                stream=socket.create_connection(('127.0.0.1',18443),timeout=15)
                secure=ssl.create_default_context().wrap_socket(stream,server_hostname='8.148.248.237')
                try:
                    secure.sendall(('GET /api/worker/v1/identity HTTP/1.1\r\nHost: 8.148.248.237\r\nAuthorization: Bearer '+key+'\r\nConnection: close\r\n\r\n').encode())
                    response=http.client.HTTPResponse(secure);response.begin()
                    identity=json.loads(response.read(16385)).get('data')
                    expected_id=next(r['id'] for r in public['workers'] if r['kind']==kind)
                    if response.status!=200 or identity!={'workerId':expected_id,'kind':kind,'instanceId':'aliyun-village'}:raise ValueError('CAMPUS_LOCAL_KEY_HTTPS_IDENTITY_FAILED')
                finally:secure.close()
            if old_workers!=d.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]')::text) FROM api_private.local_gpu_workers w WHERE name IN ('campus-geo','campus-facade');"):raise ValueError('ORIGINAL_WORKER_IDENTITIES_CHANGED')
            if d.sql("SELECT count(1) FROM api_private.local_gpu_workers WHERE name IN ('campus-local-geo','campus-local-facade') AND revoked_at IS NULL;").strip()!='2':raise ValueError('CAMPUS_PUBLIC_REGISTRATION_NOT_VERIFIED')
            changed=json.loads(json.dumps(public));changed['workers'][0]['digest']='a'*64
            try:register_keys.register(state,changed,docker=d)
            except ValueError:pass
            else:raise ValueError('CAMPUS_PUBLIC_REGISTRATION_CHANGED_IDENTITY')
            print('CAMPUS_LOCAL_KEYS_PUBLIC_DIGEST_REGISTRATION_VERIFIED',flush=True)
            print('AUTONOMOUS_COORDINATOR_FIXTURE_VERIFIED_NOT_PUBLIC_CA_OR_GPU_ACCEPTED')
            print(json.dumps({'auth_users':report['users'],'own_restore_tables':len(expected['rows']),'business_restart':True,
                'load_concurrency':[r['concurrency'] for r in full['load']],'ca_called':False,'provider_called':False,'gpu_called':False}))
    except Exception as error:
        import traceback
        for frame in traceback.extract_tb(error.__traceback__):
            print('FIXTURE_ERROR_AT '+Path(frame.filename).name+':'+frame.name+':'+str(frame.lineno),flush=True)
        reason=str(error) if re.fullmatch('[A-Z0-9_]{1,100}',str(error)) else type(error).__name__
        print('COORDINATOR_FIXTURE_FAILED phase='+phase+' category='+reason,flush=True)
        if re.fullmatch('[a-z_]{1,40}',str(getattr(error,'phase',''))) and re.fullmatch('[A-Z_]{1,80}',str(getattr(error,'code',''))):
            print('FIXTURE_PROBE_FAILURE phase='+error.phase+' code='+error.code+' status='+str(getattr(error,'status',None)),flush=True)
        if last_request:print('FIXTURE_LAST_HTTP '+json.dumps(last_request),flush=True)
        checkpoint=state/'autonomous-checkpoints.json'
        if checkpoint.exists():
            doc=storage.read_private_json(checkpoint);print('COORDINATOR_PENDING_STEPS '+json.dumps([k for k,v in doc.get('steps',{}).items() if v.get('status')=='pending']))
        # Only structural first ERROR lines, never DETAIL rows/commands/env.
        for path in sorted([*state.glob('*.log'),*root.glob('ci-command-*.log')],key=lambda p:p.stat().st_mtime_ns)[-50:]:
            for line in path.read_text(errors='replace').splitlines():
                match=re.search(r'(?:ERROR|FATAL):\s+(.+)',line)
                if match:
                    message=re.sub(r"'[^']*'",'[redacted]',match[1])
                    if re.match(r'(permission denied|relation |column |function |schema |type |syntax error|must be owner|cannot |role |database |duplicate |invalid |unrecognized |null value in column |record |there is no unique|[A-Z_]{5,})',message):print('FIXTURE_SQL_ERROR '+message[:400])
        for name in (PG,API,AUTH,WEB):
            result=subprocess.run([*prefix,'inspect',name,'--format','{{json .State}}'],capture_output=True,text=True)
            if result.returncode==0:
                value=json.loads(result.stdout);print('FIXTURE_STATE '+name+' '+json.dumps({k:value.get(k) for k in ('Running','ExitCode','OOMKilled')}))
        return 1
    finally:
        # Exact fixture-only names, within this explicitly guarded hosted job.
        for name in list(dict.fromkeys([checker,WEB,API,AUTH,PG,*reversed(created)])):
            subprocess.run([*prefix,'rm','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for name in ('village-autonomous_dbnet','village-autonomous_egress','village-autonomous_frontnet'):
            subprocess.run([*prefix,'network','rm',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    return 0


if __name__=='__main__':raise SystemExit(main())
