import importlib.util
import json
from pathlib import Path
import pytest
from unittest.mock import patch
from types import SimpleNamespace

SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
def module(name):
    p=SCRIPTS/name
    assert p.is_file(), 'Candidate deployment helper missing'
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),p)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def test_candidate_preset_does_not_reuse_copy_container_or_compose(tmp_path):
    m=module('restore-db-copy.py')
    assert hasattr(m,'select_target'), 'Fixed target selection missing'
    target=m.select_target('api-validation')
    doc=m.compose_document(tmp_path/'db',tmp_path/'backup',target=target)
    assert doc['name']=='village-api-validation'
    assert doc['services']['db']['container_name']=='village-api-validation-postgres'
    assert doc['services']['db']['network_mode']=='none'
    assert m.compose_document(tmp_path/'old',tmp_path/'backup')['services']['db']['container_name']=='village-db-copy-postgres'
    with pytest.raises(ValueError):m.select_target('arbitrary')

def test_runtime_compose_is_private_nonroot_and_mounts_only_api_password(tmp_path):
    m=module('deploy-business-api-validation.py')
    doc=m.runtime_compose(tmp_path/'candidate',tmp_path/'backup',uid=1001,gid=1001,publishable_key='public')
    db,api=doc['services']['db'],doc['services']['api']
    assert 'ports' not in db and 'network_mode' not in db
    assert doc['networks']['dbnet']['internal'] is True
    assert db['networks']==['dbnet']
    assert api['ports']==['127.0.0.1:18080:8080'] and api['user']=='1001:1001'
    assert api['mem_limit']=='192m' and api['read_only']
    assert len(api['volumes'])==1 and api['volumes'][0]['target']=='/run/secrets/api-password'
    assert all('docker.sock' not in str(v) and 'bootstrap' not in str(v) for v in api['volumes'])
    with pytest.raises(ValueError):m.runtime_compose(tmp_path,tmp_path,uid=0,gid=0,publishable_key='public')

def test_preflight_failure_never_mutates_or_stops_containers(tmp_path):
    m=module('deploy-business-api-validation.py')
    calls=[]
    class Docker:
        def run(self,args,**kwargs):calls.append(args);raise RuntimeError('fixture failure')
    with pytest.raises((ValueError,RuntimeError,OSError)):m.preflight(tmp_path/'backup',tmp_path/'candidate',tmp_path/'copy',Docker())
    assert not any(c[0] in ('stop','update','run','create','compose') for c in calls)
    assert not (tmp_path/'candidate').exists()

def test_private_state_refuses_existing_or_linked_target(tmp_path):
    m=module('deploy-business-api-validation.py')
    candidate=tmp_path/'candidate';candidate.mkdir()
    with pytest.raises(ValueError):m.validate_new_state(candidate,tmp_path/'backup',tmp_path/'copy',tmp_path/'repo')
    for candidate in (tmp_path/'backup'/'child',tmp_path/'copy',tmp_path/'repo'/'child'):
        with pytest.raises(ValueError):m.validate_new_state(candidate,tmp_path/'backup',tmp_path/'copy',tmp_path/'repo')

@pytest.mark.parametrize('bad',['report','mount','pgimage','apiimage','memory','disk'])
def test_full_preflight_refuses_tamper_and_resource_shortage_without_mutation(tmp_path,bad):
    m=module('deploy-business-api-validation.py');backup=tmp_path/'backup';backup.mkdir()
    baseline=tmp_path/'copy';baseline.mkdir();candidate=tmp_path/'candidate'
    report={'status':'isolated_restore_validated_not_cut_over','source_archive_sha256':'archive'}
    if bad=='report':report['source_archive_sha256']='different'
    for name,data in [('restore-result.json',report),('compose.yaml',m.rd.compose_document(baseline,backup))]:
        (baseline/name).write_text(json.dumps(data));(baseline/name).chmod(0o600)
    (baseline/'bootstrap-password').write_text('private');(baseline/'bootstrap-password').chmod(0o600)
    volumes=m.rd.compose_document(baseline,backup)['services']['db']['volumes']
    info={'Image':next(iter(m.rd.IMAGE_IDS)),'Config':{'Image':m.rd.IMAGE,'Labels':{'com.docker.compose.project':'village-db-copy','com.docker.compose.service':'db'}},
      'HostConfig':{'NetworkMode':'none','PortBindings':{},'ReadonlyRootfs':True,'RestartPolicy':{'Name':'unless-stopped'}},'State':{'Running':True},
      'Mounts':[{'Destination':v['target'],'Source':v['source'],'RW':not v['read_only']} for v in volumes]}
    if bad=='mount':info['Mounts'][0]['Source']=str(tmp_path/'elsewhere')
    expected=json.loads((m.ROOT/'linux/business-api-image.json').read_text())
    calls=[]
    class Docker:
        def run(self,args,**kwargs):
            calls.append(args)
            if args[0]=='inspect':return json.dumps([info])
            if args[0]=='ps':return m.rd.CONTAINER
            if args[:2]==['image','inspect']:
                image={'Id':next(iter(m.rd.IMAGE_IDS)) if args[2]==m.rd.IMAGE else expected['accepted_image_ids'][0],'Os':'linux','Architecture':'amd64','Config':{'Labels':{'village.api.code-sha256':expected['code_sha256']}}}
                if (bad=='pgimage' and args[2]==m.rd.IMAGE) or (bad=='apiimage' and args[2]==m.API_IMAGE):image['Id']='sha256:untrusted'
                return json.dumps([image])
            raise AssertionError('Unexpected mutation')
    real_read=Path.read_text
    def read(path,*a,**kw):return ('MemAvailable: 100 kB\n' if bad=='memory' else 'MemAvailable: 1500000 kB\n') if str(path).replace('\\','/')=='/proc/meminfo' else real_read(path,*a,**kw)
    with patch.object(m.rd,'verify_backup',return_value={'files':{'database.dump':{'sha256':'archive'}}}),patch.object(Path,'read_text',read),patch.object(m.shutil,'disk_usage',return_value=SimpleNamespace(free=1 if bad=='disk' else 10*1024**3)):
        with pytest.raises(ValueError):m.preflight(backup,candidate,baseline,Docker())
    assert not candidate.exists()
    assert all(c[0] in ('inspect','ps','image') for c in calls)
