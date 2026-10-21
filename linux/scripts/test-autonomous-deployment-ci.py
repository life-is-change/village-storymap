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
    repo=Path(__file__).resolve().parents[2]
    # Do not repurpose HOME or modify its permissions. Every candidate/input
    # path is explicitly injected into a newly allocated disposable fixture.
    root=Path(tempfile.mkdtemp(prefix='village-autonomous-ci-',dir=os.environ['RUNNER_TEMP']));root.chmod(0o700)
    state=root/'state';state.mkdir(mode=0o700);phase='guard';created=[];meta=None
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
        if report['users']!=4 or doc['objects']:raise ValueError('DISPOSABLE_SOURCE_FIXTURE_DIFFERS')
        inputs=load('prepare-autonomous-inputs');source_files=inputs.initialize_inputs(root/'source-files',doc,report)
        class EmptyFixtureSource:
            def verify_inventory(self,value):
                if value['objects']:raise ValueError('FIXTURE_SOURCE_MUST_BE_EMPTY')
        storage.copy_inventory(source_files/'inventory.json',source_files,'sb_secret_'+'x'*40,EmptyFixtureSource(),selected_buckets=storage.all_inventory_buckets(doc),check_source_inventory=True)
        storage.write_private_json(source_files/'full-copy-proof.json',{'version':1,'status':'all_source_storage_verified_not_cut_over',
            'source_archive_sha256':archive_sha,'inventory_sha256':storage.inventory_digest(doc),'objects':0,'verified_bytes':0,'fixture_only':True})
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
        old_builder.verified_ci=lambda *args,**kwargs:{'native_run_id':1,'native_status':'success','platform_run_id':2,'platform_status':'success','fixture_only':True}
        assembler.load_script=load
        archive=root/'autonomous-fixture.tar.gz';meta=assembler.build(repo,base,archive,native_run=1,platform_run=2)
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
        for name,(project,service) in OLD_CANDIDATES.items():
            docker('run','--detach','--init','--name',name,'--network','none','--label','com.docker.compose.project='+project,
                '--label','com.docker.compose.service='+service,'--entrypoint','/bin/sleep',nginx,'1200');created.append(name)
        docker('run','--detach','--init','--name',old_web,'--network','none','--entrypoint','/bin/sleep',nginx,'1200');created.append(old_web)
        old_info=json.loads(docker('inspect',old_web))[0]
        deploy.baseline=lambda d:{'web_id':old_info['Id'],'web_image':old_info['Image'],'config_sha256':'0'*64,
            'candidates':[stop_receipt(d.inspect(name)) for name in OLD_CANDIDATES]}
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
            phase='coordinator-deploy';result=deploy.deploy(meta,archive,backup,source_files,state=state)
            if result['status']!='autonomous_internal_deployed_not_accepted':raise ValueError('FIXTURE_DEPLOY_STATUS_DIFFERS')
            for name in (PG,API,AUTH,WEB):created.append(name)
            phase='coordinator-restart';deploy.verify(meta,state)
            phase='real-local-auth';probe=load('probe-autonomous');d=deploy.DeployDocker(state)
            def restart():
                before=d.own_container(API,meta['releaseId']);deploy.verify(meta,state);after=d.own_container(API,meta['releaseId'])
                return {'same_container':before['Id']==after['Id'],'started_at_changed':before['State']['StartedAt']!=after['State']['StartedAt']}
            api=probe.AutonomousHttpApi(port=18443,prepare_context=probe.context_callback(d,state),restart=restart,
                persist=lambda value:storage.write_private_json(state/'business-probe-state.json',value),
                resources=lambda:{'fixture':True},task_proof=lambda:{'verified':True,'releaseId':meta['releaseId'],'real_jobs':False})
            core=probe.auth_probe(api,('332','synthetic-ci-password-0001'))
            phase='business-whole-flow';full=probe.old.run_probe(api,('332','synthetic-ci-password-0001'),('student','synthetic-ci-password-0001'),{})
            if full.get('restart_persistence') is not True:raise ValueError('FIXTURE_BUSINESS_RESTART_FAILED')
            storage.write_private_json(state/'acceptance.json',{'status':'local_auth_business_verified_not_cut_over','releaseId':meta['releaseId'],
                'accepted_at':time.time(),**core,'business_restart':True,'fixture_only':True})
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
            sql(storage.private_path(own/'roles.sql').read_text(),checker,'restore_control','village_backup_check_admin')
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
            print('AUTONOMOUS_COORDINATOR_FIXTURE_VERIFIED_NOT_PUBLIC_CA_OR_GPU_ACCEPTED')
            print(json.dumps({'auth_users':report['users'],'own_restore_tables':len(expected['rows']),'business_restart':True,
                'load_concurrency':[r['concurrency'] for r in full['load']],'ca_called':False,'provider_called':False,'gpu_called':False}))
    except Exception as error:
        reason=str(error) if re.fullmatch('[A-Z0-9_]{1,100}',str(error)) else type(error).__name__
        print('COORDINATOR_FIXTURE_FAILED phase='+phase+' category='+reason,flush=True)
        checkpoint=state/'autonomous-checkpoints.json'
        if checkpoint.exists():
            doc=storage.read_private_json(checkpoint);print('COORDINATOR_PENDING_STEPS '+json.dumps([k for k,v in doc.get('steps',{}).items() if v.get('status')=='pending']))
        # Only structural first ERROR lines, never DETAIL rows/commands/env.
        for path in list(state.glob('*.log'))[-20:]:
            for line in path.read_text(errors='replace').splitlines():
                match=re.search(r'ERROR:\s+(.+)',line)
                if match:
                    message=re.sub(r"'[^']*'",'[redacted]',match[1])
                    if re.match(r'(permission denied|relation |column |function |schema |type |syntax error|must be owner|[A-Z_]{5,})',message):print('FIXTURE_SQL_ERROR '+message[:400])
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
