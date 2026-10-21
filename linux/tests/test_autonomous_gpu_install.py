import importlib.util
from pathlib import Path
import sys
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'install-autonomous-workers.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('gpu_install_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_overlay_only_changes_two_worker_images_keys_and_local_endpoint(tmp_path):
    m=module();images={'geo':'sha256:'+'a'*64,'facade':'sha256:'+'b'*64}
    doc=m.overlay(images,tmp_path)
    assert set(doc['services'])=={'geo-worker','facade-worker'}
    for kind in images:
        row=doc['services'][kind+'-worker'];assert row['image']==images[kind]
        assert row['environment']['SUPABASE_URL']=='' and row['environment']['SUPABASE_SERVICE_ROLE_KEY']==''
        assert row['environment']['VILLAGE_LOCAL_ORIGIN']=='https://8.148.248.237'
        assert not {'user','command','networks','depends_on','ports','env_file'}&set(row)
        assert row['volumes'][0]['read_only'] is True


def test_switch_is_scoped_to_two_workers_and_protects_all_other_running_services():
    m=module();args=m.update_args(Path('/repo'),Path('/private/overlay.json'))
    assert args[-2:]==['geo-worker','facade-worker'] and '--no-deps' in args and '--no-build' in args
    before={'teacher':{'Id':'a','Image':'b','State':{'Running':True}}}
    m.assert_others(before,before)
    with pytest.raises(ValueError,match='OTHER_CONTAINER_CHANGED'):m.assert_others(before,{'teacher':{'Id':'changed','Image':'b','State':{'Running':True}}})


def test_worker_identity_requires_expected_project_uid_and_real_outbound_network():
    m=module();row={'Name':'/village-platform-geo-worker-1','Image':'sha256:'+'a'*64,'Config':{'User':'10001:10001','Labels':{'com.docker.compose.project':'village-platform','com.docker.compose.service':'geo-worker'}},'State':{'Running':True},'NetworkSettings':{'Networks':{'village-platform_egress':{}}}}
    m.validate_worker(row,'geo')
    row['Config']['User']='root'
    with pytest.raises(ValueError):m.validate_worker(row,'geo')


def test_recreation_refuses_changed_pipeline_mounts_or_environment():
    m=module();row={'Config':{'User':'10001:10001','Cmd':['python','-m','worker'],'Entrypoint':None,'Env':['BASE=1','TOKEN=private']},
        'HostConfig':{'ReadonlyRootfs':True,'CapDrop':['ALL']},'Mounts':[{'Source':'/models','Destination':'/models','RW':False}],
        'NetworkSettings':{'Networks':{'village-platform_egress':{}}}}
    image={'Config':{'Env':['BASE=1'],'Cmd':['python','-m','worker'],'Entrypoint':None}}
    service={'user':'10001:10001','read_only':True,'cap_drop':['ALL'],'environment':{'TOKEN':'private'},
        'volumes':[{'type':'bind','source':'/models','target':'/models','read_only':True}],'networks':{'egress':{}}}
    m.validate_rendered(row,service,{'egress':{'name':'village-platform_egress'}},image)
    service['volumes'][0]['source']='/other-models'
    with pytest.raises(ValueError):m.validate_rendered(row,service,{'egress':{'name':'village-platform_egress'}},image)


def test_new_key_and_ca_can_be_probed_before_replacing_either_existing_worker():
    m=module();args=m.credential_probe_args('sha256:'+'a'*64,'geo',Path('/etc/village-platform/aliyun-aaaaaaaaaaaa/aliyun-geo.key'))
    assert args[:3]==['run','--rm','--pull=never']
    assert 'village-platform_egress' in args and '--read-only' in args
    assert '10001:10001' in args and 'ALL' in args and '--memory' in args
    assert 'sources' in args[-1] and 'claim' not in args[-1] and 'heartbeat' not in args[-1]
