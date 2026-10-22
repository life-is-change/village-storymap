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
    assert 'verify_identity' in args[-1] and 'sources' not in args[-1] and 'claim' not in args[-1] and 'heartbeat' not in args[-1]


def test_legacy_geo_gets_egress_only_in_the_replacement_overlay():
    m=module();images={'geo':'sha256:'+'a'*64,'facade':'sha256:'+'b'*64}
    config={'networks':{'egress':{'name':'village-platform_egress'}},'services':{
        'geo-worker':{'networks':{'backend':{}}},'facade-worker':{'networks':{'facade-internal':{},'egress':{}}}}}
    original=__import__('copy').deepcopy(config)
    doc=m.target_overlay(images,Path('/keys'),config)
    assert config==original
    assert doc['services']['geo-worker']['networks']=={'backend':{},'egress':{}}
    assert 'networks' not in doc['services']['facade-worker']
    assert set(doc['services'])=={'geo-worker','facade-worker'}
    args=m.public_probe_args(images['geo'])
    assert args[:3]==['run','--rm','--pull=never']
    assert 'village-platform_egress' in args and '--env-file' not in args
    assert 'worker' not in args[-1] and 'ProxyHandler({})' in args[-1]


def test_persisted_receipt_mounts_compare_equal_after_json_roundtrip():
    import json
    m=module();row={'Config':{'User':'10001:10001','Cmd':['python','-m','worker'],'Entrypoint':None},
        'Mounts':[{'Source':'/models','Destination':'/models','RW':False}],
        'NetworkSettings':{'Networks':{'village-platform_egress':{}}}}
    assert m.snapshot_worker(row)==json.loads(json.dumps(m.snapshot_worker(row)))


def test_compose_uses_the_unchanged_runtime_checkout_instead_of_code_bundle():
    m=module();args=m.update_args(Path('/old/dirty-checkout'),Path('/private/overlay.json'))
    assert str(Path('/old/dirty-checkout/linux/gpu.env')) in args
    assert str(Path('/old/dirty-checkout/linux/compose.gpu.yaml')) in args
    assert args[-2:]==['geo-worker','facade-worker']


def test_same_private_bundle_can_be_reused_without_resetting_previous_inputs(tmp_path):
    import tarfile
    m=module();provision=m.load_script('provision-local-workers')
    source=tmp_path/'original';source.mkdir(mode=0o700)
    for kind in m.KINDS:provision.credential(source,kind)
    bundle=tmp_path/'keys.tar.gz'
    with tarfile.open(bundle,'w:gz') as archive:
        for p in source.iterdir():archive.add(p,arcname=p.name)
    bundle.chmod(0o600);state=tmp_path/'state';state.mkdir(mode=0o700)
    root=m.credentials(bundle,state)
    before={p.name:p.read_bytes() for p in root.iterdir()}
    assert m.credentials(bundle,state)==root
    assert {p.name:p.read_bytes() for p in root.iterdir()}==before


def test_preflight_accepts_the_legacy_dirty_runtime_without_opening_old_worker_egress(tmp_path):
    import json
    m=module();runtime=tmp_path/'old-checkout';(runtime/'linux').mkdir(parents=True)
    (runtime/'linux/gpu.env').write_text('IMAGE_TAG=old\n')
    (runtime/'linux/compose.gpu.yaml').write_text('# local uncommitted config\n')
    original={p.name:p.read_bytes() for p in (runtime/'linux').iterdir()}
    rows={};services={};networks={'backend':{'name':'village-platform_backend'},'facade-internal':{'name':'village-platform_facade-internal'},'egress':{'name':'village-platform_egress'}}
    for i,kind in enumerate(m.KINDS):
        nets={'backend':{}} if kind=='geo' else {'facade-internal':{},'egress':{}}
        rows[m.NAMES[kind]]={'Name':'/'+m.NAMES[kind],'Image':'sha256:'+str(i+1)*64,
            'Config':{'User':'10001:10001','Cmd':['python','-m','village_processing',kind],'Entrypoint':None,'Env':['BASE=1','PRIVATE=secret'],
             'Labels':{'com.docker.compose.project':'village-platform','com.docker.compose.service':kind+'-worker'}},
            'HostConfig':{'ReadonlyRootfs':True,'CapDrop':['ALL']},'Mounts':[],
            'State':{'Running':True},'NetworkSettings':{'Networks':{networks[n]['name']:{} for n in nets}}}
        services[kind+'-worker']={'image':'old-tag-'+kind,'user':'10001:10001','read_only':True,'cap_drop':['ALL'],
            'command':['python','-m','village_processing',kind],'environment':{'PRIVATE':'secret'},'volumes':[],'networks':nets}
    class Docker:
        calls=[]
        def inspect(self,name):return rows[name]
        def run(self,*args,**kwargs):
            self.calls.append(args)
            if args[:2]==('network','inspect'):return json.dumps([{'Internal':False}])
            if args[0]=='compose':return json.dumps({'services':services,'networks':networks})
            if args[:2]==('image','inspect'):
                row=next(r for r in rows.values() if r['Image']==args[2])
                return json.dumps([{'Id':row['Image'],'Config':{'Env':['BASE=1'],'Cmd':row['Config']['Cmd'],'Entrypoint':None}}])
            if args[0]=='run':return ''
            raise AssertionError(args)
    docker=Docker();report=m.install(docker,tmp_path,None,'a'*40,campus_root=runtime)
    assert report=={'status':'campus_preflight_only_not_switched'}
    assert len([a for a in docker.calls if a[0]=='run'])==2
    assert all(a[0]!='exec' and not (a[:2]==('network','connect')) and 'up' not in a for a in docker.calls)
    assert {p.name:p.read_bytes() for p in (runtime/'linux').iterdir()}==original


@pytest.mark.skipif(sys.platform=='win32',reason='POSIX in-image access modes')
def test_private_handoff_code_is_readable_by_the_unchanged_container_uid_only_in_build_copy(tmp_path):
    import stat
    m=module();source=tmp_path/'source';package=source/'server/src/village_processing'
    package.mkdir(parents=True,mode=0o700);p=package/'__init__.py';p.write_bytes(b'pass\n');p.chmod(0o600)
    (source/'linux').mkdir();(source/'linux/Dockerfile.worker-local-overlay').write_bytes(b'FROM base\n')
    target=tmp_path/'build';m.stage_code(source,target)
    assert stat.S_IMODE(p.stat().st_mode)==0o600
    assert stat.S_IMODE((target/'server/src/village_processing').stat().st_mode)==0o755
    assert stat.S_IMODE((target/'server/src/village_processing/__init__.py').stat().st_mode)==0o644
