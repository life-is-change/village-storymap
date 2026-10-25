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
