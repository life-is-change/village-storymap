import copy
import importlib.util
from pathlib import Path
import sys

import pytest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'linux/scripts'))


def rollout():
    import component_rollout
    return component_rollout


def fixture(service='facade-worker', extra=False):
    env={'PATH':'/usr/bin','KEEP':'private-placeholder'}
    volumes=[{'type':'bind','source':'/models','target':'/models','read_only':True}]
    if service=='facade-worker':volumes.append({'type':'bind','source':'/etc/worker.key','target':'/run/secrets/aliyun-worker-key','read_only':True})
    spec={'image':'old:tag','environment':{'KEEP':'private-placeholder'},'volumes':volumes,
          'networks':{'internal':{}},'user':'10001:10001','read_only':True,'cap_drop':['ALL'],
          'mem_limit':'6g','pids_limit':512,'deploy':{'resources':{'reservations':{'devices':[{'capabilities':['gpu'],'count':1}]}}}}
    doc={'name':'village-platform','services':{service:spec,'unrelated':{'image':'keep:tag'}},
         'networks':{'internal':{'name':'village-platform_facade-internal','internal':True}}}
    row={'Name':'/village-platform-'+service+'-1','Image':'sha256:old','Config':{'User':'10001:10001','Env':[k+'='+v for k,v in env.items()],'Cmd':['python','-m','worker'],'Entrypoint':None,'WorkingDir':'/app'},
         'Mounts':[{'Type':'bind','Source':v['source'],'Destination':v['target'],'RW':False} for v in volumes],
         'NetworkSettings':{'Networks':{'village-platform_facade-internal':{}}},
         'HostConfig':{'ReadonlyRootfs':True,'CapDrop':['ALL']}}
    image={'Config':{'User':'10001:10001','Env':['PATH=/usr/bin'],'Cmd':['python','-m','worker'],'Entrypoint':None,'WorkingDir':'/app'}}
    return row,doc,image


def test_separate_worker_compose_preserves_key_gpu_limits_and_other_services():
    m=rollout()
    for name in ('facade-worker','facade-ml'):
        row,doc,image=fixture(name);before=copy.deepcopy(doc)
        m.validate_rendered(row,doc,name,image)
        new=m.worker_document(doc,name,'sha256:new')
        assert doc==before
        assert new['services']['unrelated']==before['services']['unrelated']
        for key in ('volumes','deploy','mem_limit','pids_limit','user','read_only','cap_drop'):
            assert new['services'][name][key]==before['services'][name][key]
        assert new['services'][name]['working_dir']=='/opt/village-components'
        assert new['networks']['internal']=={'name':'village-platform_facade-internal','external':True}
        if name=='facade-worker':assert new['services'][name]['environment']['BLENDER_EXECUTABLE'].endswith('/blender')


def test_rendered_secret_or_network_change_rejected_without_printing_values():
    m=rollout();row,doc,image=fixture()
    doc['services']['facade-worker']['environment']['KEEP']='unexpected-private-value'
    with pytest.raises(ValueError,match='RENDERED_ENVIRONMENT_DIFFERS') as error:
        m.validate_rendered(row,doc,'facade-worker',image)
    assert 'private' not in str(error.value)
    row,doc,image=fixture();doc['networks']['internal']['name']='different-network'
    with pytest.raises(ValueError,match='RENDERED_NETWORKS_DIFFER'):m.validate_rendered(row,doc,'facade-worker',image)


def test_sql_change_accepts_only_known_before_or_after_and_is_compare_and_swap():
    m=rollout();before='CREATE FUNCTION api_private.example() RETURNS text LANGUAGE sql AS $$SELECT \'old\'$$;'
    after=before.replace("'old'","'new'")
    baseline={'example':before};changes={'example':after}
    sql=m.sql_change(baseline,changes,{'example':m.function_body(before)})
    assert 'CREATE OR REPLACE FUNCTION' in sql and 'FUNCTION_CHANGED_DURING_UPDATE' in sql
    with pytest.raises(ValueError,match='DATABASE_FUNCTION_BASELINE_DIFFERS'):
        m.sql_change(baseline,changes,{'example':'SELECT unexpected_private'})
    assert 'CREATE OR REPLACE' not in m.sql_change(baseline,changes,{'example':m.function_body(after)},apply=False)


def test_public_snapshot_never_contains_environment_or_private_paths():
    m=rollout();row,doc,image=fixture()
    row['State']={'Status':'running'}
    public=m.public_snapshot(row)
    assert set(public)=={'name','image','status'}
    assert 'KEEP' not in str(public) and 'worker.key' not in str(public)


def test_component_bundle_excludes_private_runtime_tests_and_weights():
    import build_component_bundle as m
    for path in ('linux/scripts/component_rollout.py','linux/component-baseline.json',
                 'server/src/village_processing/facade/pipeline.py',
                 'rural_house_generator/backend/component_building/data/source/realistic/manifest.json'):
        assert m.allowed(path)
    for path in ('.env','linux/gpu.env','server/.env','server/runtime/analysis.json',
                 'rural_house_generator/runtime_storage/model.glb','models/sam.pt',
                 'rural_house_generator/backend/tests/test_component_building.py'):
        assert not m.allowed(path)


def test_worker_overlay_installs_required_pillow_before_import_smoke():
    text=(ROOT/'linux/Dockerfile.component-worker').read_text()
    assert '--no-deps Pillow==' in text


def test_compose_image_hint_is_an_explicit_file_not_an_environment_lost_by_sudo(tmp_path):
    m=rollout();compose=tmp_path/'compose.yaml';compose.write_text('services: {}')
    row={'Name':'/village-platform-facade-ml-1','Config':{'Image':'ml:'+'a'*40,'Labels':{
        'com.docker.compose.project.config_files':str(compose),
        'com.docker.compose.project.working_dir':str(tmp_path)}}}
    class Docker:
        state=tmp_path
        env={}
        def run(self,*args):
            assert '--env-file' in args
            path=Path(args[args.index('--env-file')+1])
            assert path.read_text()=='IMAGE_TAG='+'a'*40+'\n'
            return '{}'
    assert m.compose_config(Docker(),row)=={}


def test_health_wait_uses_configured_cold_start_grace(monkeypatch):
    m=rollout();calls=[]
    class Docker:
        def inspect(self,name):
            calls.append(name)
            return {'Config':{'Healthcheck':{'StartPeriod':180_000_000_000,'Interval':10_000_000_000,'Timeout':170_000_000_000,'Retries':5}},
                    'State':{'Running':True,'Health':{'Status':'healthy' if len(calls)>70 else 'starting'}}}
    monkeypatch.setattr(m.time,'sleep',lambda n:None)
    assert m.wait_healthy(Docker(),'ml')['State']['Health']['Status']=='healthy'


def test_resource_drift_is_rejected_in_a_stopped_candidate_before_replacement(tmp_path):
    m=rollout();row,doc,image=fixture();row['HostConfig']['Memory']=6*1024**3
    calls=[]
    class Docker:
        state=tmp_path
        def run(self,*args):calls.append(args);return ''
        def inspect(self,name):
            candidate=copy.deepcopy(row);candidate['Id']='a'*64
            candidate['Config']['Labels']={'village.component.probe':'true'}
            candidate['HostConfig']['Memory']=2*1024**3
            return candidate
    with pytest.raises(ValueError,match='PLANNED_CONTAINER_RESOURCES_DIFFER'):
        m.validate_candidate(Docker(),row,doc,'facade-worker')
    assert any('create' in args for args in calls)
    assert not any('up' in args or 'start' in args for args in calls)
    assert calls[-1]==('rm','a'*64)


@pytest.mark.parametrize('installed_compose',[False,True])
def test_candidate_create_checks_one_service_with_supported_cli_options(tmp_path,installed_compose):
    import json
    import os
    import re
    import shutil
    import subprocess
    supported={'--no-build','--pull'}
    if installed_compose:
        if not shutil.which('docker'):
            if os.environ.get('GITHUB_ACTIONS')=='true':pytest.fail('CI Docker CLI required')
            pytest.skip('Local Docker Compose CLI unavailable')
        help_result=subprocess.run(['docker','compose','create','--help'],capture_output=True,text=True)
        assert help_result.returncode==0,help_result.stderr
        supported=set(re.findall(r'--[a-z][a-z-]+',help_result.stdout))
    m=rollout();row,doc,image=fixture();original=copy.deepcopy(doc);calls=[]
    doc['services']['facade-worker']['depends_on']={'unrelated':{'condition':'service_started'}}
    doc['services']['facade-worker']['build']={'context':'must-not-build'}
    class Docker:
        state=tmp_path
        def run(self,*args):
            calls.append(args)
            if 'create' in args:
                flags={a for a in args[args.index('create')+1:] if str(a).startswith('--')}
                unsupported=flags-supported
                if unsupported:raise RuntimeError('unknown flag: '+sorted(unsupported)[0])
                prepared=json.loads(Path(args[args.index('-f')+1]).read_text())
                assert set(prepared['services'])=={'facade-worker'}
                spec=prepared['services']['facade-worker']
                assert spec['image']=='sha256:old'
                assert 'depends_on' not in spec and 'build' not in spec
            return ''
        def inspect(self,name):
            candidate=copy.deepcopy(row);candidate['Id']='a'*64
            candidate['Config']['Labels']={'village.component.probe':'true'}
            return candidate
    m.validate_candidate(Docker(),row,doc,'facade-worker')
    assert doc['services']['unrelated']==original['services']['unrelated']
    assert not any('up' in args or 'start' in args for args in calls)
    assert calls[-1]==('rm','a'*64)


def test_worker_paths_keep_new_state_under_central_root_and_old_sources_untouched(tmp_path):
    m=rollout();root=tmp_path/'village-platform';root.mkdir()
    old=root/'repo';old.mkdir();(old/'sentinel').write_text('old-code')
    source=root/'deploy/components/releases/village-components-aaaaaaaaaaaa';source.mkdir(parents=True)
    home=tmp_path/'home';home.mkdir();lock=home/'village-campus-autonomous';lock.mkdir()
    result=m.worker_paths(source,'a'*40,home,platform_root=root)
    assert result['state']==root/'deploy/components/state/aaaaaaaaaaaa'
    assert result['temporary']==root/'deploy/components/state/aaaaaaaaaaaa/tmp'
    assert result['lock']==lock
    assert sorted(p.name for p in home.iterdir())==['village-campus-autonomous']
    assert (old/'sentinel').read_text()=='old-code'
    assert not result['state'].exists()  # Planning must not create directories.


def test_worker_paths_refuse_home_source_missing_root_or_missing_existing_lock(tmp_path):
    m=rollout();root=tmp_path/'village-platform';root.mkdir();home=tmp_path/'home';home.mkdir()
    lock=home/'village-campus-autonomous';lock.mkdir()
    with pytest.raises(ValueError,match='SOURCE_MUST_BE_IN_CENTRAL_RELEASES'):
        m.worker_paths(home,'a'*40,home,platform_root=root)
    source=root/'deploy/components/releases/village-components-aaaaaaaaaaaa';source.mkdir(parents=True)
    with pytest.raises(ValueError,match='EXISTING_CAMPUS_OPERATOR_LOCK_REQUIRED'):
        m.worker_paths(source,'a'*40,tmp_path/'another-home',platform_root=root)
    with pytest.raises(ValueError,match='EXISTING_CENTRAL_PLATFORM_ROOT_REQUIRED'):
        m.worker_paths(source,'a'*40,home,platform_root=tmp_path/'missing')


def test_worker_storage_reports_daemon_location_without_moving_or_pruning_it(tmp_path):
    m=rollout();root=tmp_path/'village-platform';root.mkdir();engine=tmp_path/'docker';engine.mkdir()
    class Docker:
        def run(self,*args):
            assert args==('info','--format','{{.DockerRootDir}}')
            return str(engine)+'\n'
    result=m.worker_storage_report(Docker(),root)
    assert result['project_root']==str(root)
    assert result['docker_root']==str(engine)
    assert result['docker_images_inside_project_root'] is False
    assert result['docker_free_bytes']>0
    assert sorted(p.name for p in tmp_path.iterdir())==['docker','village-platform']


def test_worker_disk_shortage_is_rejected_before_any_build_or_service_changes(tmp_path,monkeypatch):
    m=rollout();root=tmp_path/'village-platform';root.mkdir();engine=tmp_path/'docker';engine.mkdir()
    from collections import namedtuple
    Usage=namedtuple('Usage','total used free')
    monkeypatch.setattr(m.shutil,'disk_usage',lambda path:Usage(100*1024**3,98*1024**3,2*1024**3))
    class Docker:
        def run(self,*args):
            assert args==('info','--format','{{.DockerRootDir}}')
            return str(engine)
    with pytest.raises(ValueError,match='DOCKER_FREE_SPACE_BELOW_COMPONENT_RESERVE'):
        m.worker_storage_report(Docker(),root)


@pytest.mark.skipif(sys.platform=='win32',reason='POSIX symlink deployment paths')
def test_worker_state_symlink_cannot_escape_central_directory(tmp_path):
    m=rollout();root=tmp_path/'village-platform';root.mkdir();home=tmp_path/'home';home.mkdir()
    (home/'village-campus-autonomous').mkdir()
    source=root/'deploy/components/releases/village-components-aaaaaaaaaaaa';source.mkdir(parents=True)
    (root/'deploy/components/state').symlink_to(home,target_is_directory=True)
    with pytest.raises(ValueError,match='Linked paths are not accepted'):
        m.worker_paths(source,'a'*40,home,platform_root=root)
    assert not (home/'aaaaaaaaaaaa').exists()


def test_central_temporary_environment_reaches_command_after_sudo(tmp_path,monkeypatch):
    import autonomous_operator as operator
    import json
    import subprocess
    temporary=tmp_path/'tmp';temporary.mkdir(mode=0o700)
    docker=operator.Docker.__new__(operator.Docker);docker.state=tmp_path
    docker.env={};docker.prefix=operator.docker_command(temporary)
    def run(command,**kwargs):
        return subprocess.CompletedProcess(command,0,stdout=json.dumps(command).encode())
    monkeypatch.setattr(operator.subprocess,'run',run)
    command=json.loads(docker.run('info','--format','{{.DockerRootDir}}'))
    assert command[:3]==['sudo','-n','env']
    assert command[3:6]==[name+'='+str(temporary) for name in ('TMPDIR','TMP','TEMP')]
    assert command[6:]==['docker','--context','default','info','--format','{{.DockerRootDir}}']
    assert operator.docker_command()==['sudo','-n','docker','--context','default']
