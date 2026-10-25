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


@pytest.mark.parametrize('result',['null','[]','{}','{"blocking":false,"preserved_awaiting_crop":1}',
    '{"blocking":0,"preserved_awaiting_crop":-1}','{"blocking":0,"preserved_awaiting_crop":1,"unexpected":0}'])
def test_invalid_task_snapshot_cannot_bypass_cloud_quiescence(result):
    m=rollout()
    class Docker:
        def sql(self,query):return result
    with pytest.raises(ValueError,match='INVALID_LOCAL_TASK_SNAPSHOT'):
        m.check_cloud_task_quiescence(Docker(),'EXISTING_LOCAL_TASKS_MUST_FINISH_OR_BE_CANCELED')


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


def test_root_protected_compose_is_forwarded_to_privileged_client_without_local_stat(tmp_path,monkeypatch):
    m=rollout();protected=tmp_path/'protected-compose.yaml';protected.write_text('keep-private')
    original=Path.is_file
    def restricted(path):
        if path==protected:raise PermissionError(13,'Permission denied',str(path))
        return original(path)
    monkeypatch.setattr(Path,'is_file',restricted)
    row={'Name':'/village-platform-facade-ml-1','Config':{'Image':'ml:existing','Labels':{
        'com.docker.compose.project.config_files':str(protected),
        'com.docker.compose.project.working_dir':str(tmp_path)}}}
    class Docker:
        state=tmp_path
        def run(self,*args):
            assert args[-3:]==('config','--format','json')
            assert args[args.index('-f')+1]==str(protected)
            return '{"services": {"facade-ml": {"image": "ml:existing"}}}'
    result=m.compose_config(Docker(),row)
    assert result['services']['facade-ml']['image']=='ml:existing'
    assert protected.read_text()=='keep-private'


@pytest.mark.parametrize('path',['','relative-compose.yaml'])
def test_missing_or_relative_original_compose_path_is_rejected_before_client_call(tmp_path,path):
    m=rollout();row={'Name':'/village-platform-facade-ml-1','Config':{'Image':'ml:existing','Labels':{
        'com.docker.compose.project.config_files':path,
        'com.docker.compose.project.working_dir':str(tmp_path)}}}
    class Docker:
        state=tmp_path
        def run(self,*args):pytest.fail('Invalid source path must not reach Docker')
    with pytest.raises(ValueError,match='ORIGINAL_COMPOSE_FILES_REQUIRED'):
        m.compose_config(Docker(),row)


def test_real_sudo_compose_can_render_private_root_owned_fixture_in_disposable_ci(tmp_path):
    import json
    import os
    import subprocess
    if sys.platform!='linux' or os.environ.get('GITHUB_ACTIONS')!='true':
        pytest.skip('Root-protected fixture is restricted to disposable Linux CI')
    assert os.geteuid()!=0
    m=rollout();private=tmp_path/'synthetic-root-private';private.mkdir(mode=0o700)
    compose=private/'compose.json'
    document={'services':{'facade-ml':{'image':'fixture:never-pulled','environment':{'SYNTHETIC_MARKER':'fixture-only'}}}}
    contents=json.dumps(document);compose.write_text(contents)
    assert private.resolve().parent==tmp_path.resolve() and not private.is_symlink()
    from autonomous_operator import Docker
    state=tmp_path/'state';state.mkdir(mode=0o700);docker=Docker(state)
    try:
        subprocess.run(['sudo','-n','chown','root:root',str(private)],check=True)
        with pytest.raises(PermissionError):compose.stat()
        row={'Name':'/village-platform-facade-ml-1','Config':{'Image':'ml:existing','Labels':{
            'com.docker.compose.project.config_files':str(compose),
            'com.docker.compose.project.working_dir':str(tmp_path)}}}
        result=m.compose_config(docker,row)
        assert result['services']['facade-ml']['environment']['SYNTHETIC_MARKER']=='fixture-only'
        assert private.stat().st_uid==0 and private.stat().st_mode&0o777==0o700
    finally:
        subprocess.run(['sudo','-n','chown',str(os.geteuid())+':'+str(os.getegid()),str(private)],check=True)
    assert compose.read_text()==contents


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


@pytest.mark.parametrize('change',[None,'source','read_only','propagation','duplicate','gpu','memory','oom','other_default','other_missing'])
def test_observed_mount_order_and_oom_default_equivalence_does_not_hide_real_changes(tmp_path,change,capsys):
    m=rollout();row,doc,image=fixture();calls=[]
    row['HostConfig'].update({
        'Mounts':[
            {'Type':'bind','Source':'/models','Target':'/models','ReadOnly':True,
             'BindOptions':{'Propagation':'rprivate','CreateMountpoint':False}},
            {'Type':'bind','Source':'/work','Target':'/work','ReadOnly':False},
            {'Type':'bind','Source':'/etc/worker.key','Target':'/run/secrets/aliyun-worker-key','ReadOnly':True}],
        'OomKillDisable':None,'Init':None,'Memory':6*1024**3,
        'DeviceRequests':[{'Driver':'nvidia','Count':1,'DeviceIDs':None,'Capabilities':[['gpu']],'Options':{}}]})
    candidate=copy.deepcopy(row);candidate['Id']='a'*64
    candidate['Config']['Labels']={'village.component.probe':'true'}
    candidate['HostConfig']['Mounts'].reverse();candidate['HostConfig']['OomKillDisable']=False
    host=candidate['HostConfig'];mount=next(v for v in host['Mounts'] if v['Target']=='/models')
    if change=='source':mount['Source']='/different-models'
    elif change=='read_only':mount['ReadOnly']=False
    elif change=='propagation':mount['BindOptions']['Propagation']='rshared'
    elif change=='duplicate':host['Mounts'].append(copy.deepcopy(mount))
    elif change=='gpu':host['DeviceRequests'][0]['Count']=2
    elif change=='memory':host['Memory']=2*1024**3
    elif change=='oom':host['OomKillDisable']=True
    elif change=='other_default':host['Init']=False
    elif change=='other_missing':host.pop('Init')
    original=copy.deepcopy(row);planned=copy.deepcopy(candidate)
    class Docker:
        state=tmp_path
        def run(self,*args):calls.append(args);return ''
        def inspect(self,name):return candidate
    if change is None:m.validate_candidate(Docker(),row,doc,'facade-worker')
    else:
        with pytest.raises(ValueError,match='PLANNED_CONTAINER_RESOURCES_DIFFER'):
            m.validate_candidate(Docker(),row,doc,'facade-worker')
    assert row==original and candidate==planned
    assert not any('up' in args or 'start' in args for args in calls)
    assert calls[-1]==('rm','a'*64)
    output=capsys.readouterr().out
    if change is None:assert not output
    else:
        import json
        field={'gpu':'host.DeviceRequests','memory':'host.Memory','oom':'host.OomKillDisable',
               'other_default':'host.Init','other_missing':'host.Init'}.get(change,'host.Mounts')
        assert json.loads(output)=={'resource_difference_fields':[field]}
        assert '/different-models' not in output and 'worker.key' not in output


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


@pytest.mark.parametrize('change',[None,'Dns','DnsOptions','DnsSearch','dns_order','options_order','search_order','unrelated'])
def test_only_empty_dns_lists_are_equivalent_and_configured_values_and_order_remain_checked(tmp_path,change,capsys):
    import json
    m=rollout();row,doc,image=fixture('facade-ml');calls=[]
    row['HostConfig'].update({'Dns':[],'DnsOptions':[],'DnsSearch':[],'ExtraHosts':[]})
    candidate=copy.deepcopy(row);candidate['Id']='a'*64
    candidate['Config']['Labels']={'village.component.probe':'true'}
    candidate['HostConfig'].update({'Dns':None,'DnsOptions':None,'DnsSearch':None})
    field=change
    if change in ('Dns','DnsOptions','DnsSearch'):
        candidate['HostConfig'][change]={'Dns':['1.1.1.1'],'DnsOptions':['ndots:1'],'DnsSearch':['village.local']}[change]
    elif change in ('dns_order','options_order','search_order'):
        field,values={'dns_order':('Dns',['1.1.1.1','9.9.9.9']),
                      'options_order':('DnsOptions',['timeout:1','attempts:2']),
                      'search_order':('DnsSearch',['a.local','b.local'])}[change]
        row['HostConfig'][field]=values;candidate['HostConfig'][field]=list(reversed(values))
    elif change=='unrelated':field='ExtraHosts';candidate['HostConfig'][field]=None
    old=copy.deepcopy(row);planned=copy.deepcopy(candidate)
    class Docker:
        state=tmp_path
        def run(self,*args):calls.append(args);return ''
        def inspect(self,name):return candidate
    if change is None:
        m.validate_candidate(Docker(),row,doc,'facade-ml')
        assert not capsys.readouterr().out
    else:
        with pytest.raises(ValueError,match='PLANNED_CONTAINER_RESOURCES_DIFFER'):
            m.validate_candidate(Docker(),row,doc,'facade-ml')
        assert json.loads(capsys.readouterr().out)=={'resource_difference_fields':['host.'+field]}
    assert row==old and candidate==planned
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


@pytest.mark.parametrize('scenario',['resources','preserve_crop','busy','crop_confirmed_during_rollout'])
def test_cloud_checks_rendered_networks_and_keeps_original_compose_for_updates(tmp_path,monkeypatch,scenario):
    import json
    import autonomous_operator as operator
    import business_storage_copy as storage
    from autonomous_extract import tree_digest
    m=rollout();runtime=tmp_path/'village-autonomous';runtime.mkdir(mode=0o700)
    root=runtime/'files/single-personal-20261024-v1';root.mkdir(parents=True,mode=0o700)
    webdir=root/'web';webdir.mkdir(mode=0o700);(webdir/'index.html').write_text('existing-web')
    storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':tree_digest(webdir)})
    api,rendered,image=fixture('api');web,webdoc,_=fixture('web')
    binding={'type':'bind','source':str(webdir),'target':'/srv/village-web','read_only':True}
    webdoc['services']['web']['volumes'].append(binding)
    web['Mounts'].append({'Type':'bind','Source':str(webdir),'Destination':'/srv/village-web','RW':False})
    rendered['name']='village-autonomous'
    rendered['services']['web']=webdoc['services']['web']
    rendered['services']['auth']={'image':'fixture:auth','environment':{'SYNTHETIC_PRIVATE':'never-persist-inline'}}
    rendered['networks']['internal']['name']='village-autonomous_internal'
    rows={operator.API:api,operator.WEB:web,operator.PG:copy.deepcopy(api)}
    for name,row in rows.items():
        row.update(Name='/'+name,Image=m.OBSERVED[name],State={'Running':True,'Status':'running'})
        row['NetworkSettings']['Networks']={'village-autonomous_internal':{}}
    raw=copy.deepcopy(rendered);raw['networks']['internal'].pop('name')
    raw['services']['auth']={'image':'fixture:auth','env_file':['/private/auth.env']}
    storage.write_private_json(runtime/'compose.json',raw)
    original=(runtime/'compose.json').read_bytes()
    source=tmp_path/'payload';(source/'linux').mkdir(parents=True)
    (source/'linux/component-baseline.json').write_text(json.dumps({'functions':{},'changes':{},'api_files':{},'web_files':[]}))
    state=tmp_path/'state';state.mkdir(mode=0o700);calls=[];candidates={}
    monkeypatch.setattr(Path,'home',classmethod(lambda cls:tmp_path))
    monkeypatch.setattr(operator,'verified_runtime',lambda docker,path:({},None))
    class ResourceChecksFinished(Exception):pass
    def finished(*args):
        if scenario=='resources':raise ResourceChecksFinished()
        return {}
    monkeypatch.setattr(m,'read_functions',finished)
    import autonomous_bundle
    from types import SimpleNamespace
    monkeypatch.setattr(autonomous_bundle,'load_script',lambda name:SimpleNamespace(backup=lambda *args:tmp_path/'backup'))
    monkeypatch.setattr(m,'all_other',lambda *args:{})
    class Docker:
        def __init__(self):self.state=state
        def inspect(self,name):return copy.deepcopy(rows.get(name) or candidates[name])
        def run(self,*args):
            calls.append(args)
            if args[:2]==('image','inspect'):return json.dumps([image])
            if args[:3]==('exec',operator.API,'node'):return '{}'
            if args[-3:]==('config','--format','json'):
                assert args[args.index('--project-name')+1]=='village-autonomous'
                assert Path(args[args.index('-f')+1])==runtime/'compose.json'
                assert (runtime/'compose.json').read_bytes()==original
                return json.dumps(rendered)
            if 'create' in args:
                spec=json.loads(Path(args[args.index('-f')+1]).read_text())
                service=args[-1];assert set(spec['services'])=={service}
                assert 'never-persist-inline' not in json.dumps(spec)
                row=copy.deepcopy(rows[operator.API if service=='api' else operator.WEB])
                row['Config']['Labels']={'village.component.probe':'true'};row['Id']='c'*64
                candidates[spec['services'][service]['container_name']]=row
            return ''
        def sql(self,query):
            if query.lstrip().startswith(('WITH pending','SELECT count(*)')):
                busy=scenario=='busy' or scenario=='crop_confirmed_during_rollout' and any(a[0]=='stop' for a in calls)
                return json.dumps({'blocking':int(busy),'preserved_awaiting_crop':0 if busy else 1})
            return ''
    if scenario=='resources':
        with pytest.raises(ResourceChecksFinished):m.cloud(state,source,'a'*40,apply=False,docker=Docker())
    elif scenario=='preserve_crop':
        result=m.cloud(state,source,'a'*40,apply=False,docker=Docker())
        assert result['active_tasks']==0 and result['preserved_awaiting_crop']==1
    elif scenario=='busy':
        with pytest.raises(ValueError,match='EXISTING_LOCAL_TASKS_MUST_FINISH_OR_BE_CANCELED'):
            m.cloud(state,source,'a'*40,apply=False,docker=Docker())
    else:
        with pytest.raises(ValueError,match='TASK_SUBMITTED_DURING_ROLLOUT'):
            m.cloud(state,source,'a'*40,apply=True,docker=Docker())
        assert ('stop','--time','20',operator.API) in calls
        assert calls[-1]==('start',operator.API),'Restore the old API when crop confirmation races deployment'
    assert (runtime/'compose.json').read_bytes()==original
    assert sum('create' in args for args in calls)==2
    if scenario!='crop_confirmed_during_rollout':
        assert not any(value in args for args in calls for value in ('up','start','stop','build'))
    assert not any('up' in args or 'build' in args for args in calls)


def test_real_cloud_renderer_expands_implicit_names_without_rewriting_auth_env_file(tmp_path):
    import json
    import os
    if sys.platform!='linux' or os.environ.get('GITHUB_ACTIONS')!='true':
        pytest.skip('Real sudo Compose renderer is restricted to disposable Linux CI')
    from autonomous_operator import Docker
    m=rollout();runtime=tmp_path/'runtime';runtime.mkdir(mode=0o700)
    env=runtime/'auth.env';env.write_text('SYNTHETIC_PRIVATE=fixture-only\n');env.chmod(0o600)
    raw={'name':'village-autonomous','services':{
        'api':{'image':'fixture:never-pulled','networks':{'dbnet':{}}},
        'auth':{'image':'fixture:never-pulled','networks':{'dbnet':{}},'env_file':[str(env)]}},
        'networks':{'dbnet':{'internal':True}}}
    contents=json.dumps(raw);(runtime/'compose.json').write_text(contents)
    state=tmp_path/'state';state.mkdir(mode=0o700)
    result=m.render_cloud_compose(Docker(state),runtime)
    assert result['networks']['dbnet']['name']=='village-autonomous_dbnet'
    assert result['services']['auth']['environment']['SYNTHETIC_PRIVATE']=='fixture-only'
    assert (runtime/'compose.json').read_text()==contents
    assert env.read_text()=='SYNTHETIC_PRIVATE=fixture-only\n'


def test_standalone_operator_verifies_reused_payload_before_loading_dependencies(tmp_path,monkeypatch):
    import hashlib,json
    m=rollout();payload=tmp_path/'payload';dependency=payload/'linux/scripts/dependency.py'
    dependency.parent.mkdir(parents=True);dependency.write_bytes(b'VALID=True\n')
    manifest={'kind':'component-rollout','commit':'a'*40,'files':{
        'linux/scripts/dependency.py':hashlib.sha256(dependency.read_bytes()).hexdigest()}}
    (payload/'component-source.json').write_text(json.dumps(manifest))
    monkeypatch.setattr(m,'ROOT',m.ROOT);monkeypatch.setattr(sys,'path',list(sys.path))
    assert m.source_context(payload)=='a'*40
    assert m.ROOT==payload and sys.path[0]==str(payload/'linux/scripts')
    dependency.write_bytes(b'CHANGED=True\n')
    with pytest.raises(ValueError,match='BUNDLE_SOURCE_CHANGED'):m.source_context(payload)
    with pytest.raises(ValueError,match='ABSOLUTE_VERIFIED_SOURCE_ROOT_REQUIRED'):
        m.source_context(Path('relative-payload'))


def test_receipt_rejects_changed_standalone_operator_before_touching_services(tmp_path,monkeypatch):
    import hashlib
    import business_storage_copy as storage
    m=rollout();operator=tmp_path/'standalone.py';operator.write_bytes(b'original-operator\n')
    monkeypatch.setattr(m,'__file__',str(operator))
    after={'village-platform-facade-worker-1':'a'*64,'village-platform-facade-ml-1':'b'*64}
    storage.write_private_json(tmp_path/'receipt.json',{'phase':'complete','commit':'c'*40,'kind':'worker',
        'operator_sha256':hashlib.sha256(operator.read_bytes()).hexdigest(),'after':after})
    calls=[]
    class Docker:
        def inspect(self,name):calls.append(name);return {'Id':after[name],'Config':{},'State':{'Running':True}}
        def run(self,*args):calls.append(args);return ''
    assert m.verify(tmp_path,Docker(),'c'*40,'worker')['status'].startswith('component_worker_rollout_receipt_verified')
    calls.clear();operator.write_bytes(b'changed-operator\n')
    with pytest.raises(ValueError,match='ROLLOUT_OPERATOR_CHANGED'):m.verify(tmp_path,Docker(),'c'*40,'worker')
    assert not calls
