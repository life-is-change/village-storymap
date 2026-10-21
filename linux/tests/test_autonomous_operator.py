import importlib.util
from pathlib import Path
import sys
import json
import pytest
from unittest.mock import patch
import subprocess

S=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(S))


def module():
    path=S/'autonomous_operator.py'
    assert path.is_file(),'autonomous operator guard missing'
    spec=importlib.util.spec_from_file_location('autonomous_operator_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_local_docker_refuses_remote_context_and_does_not_leak_subprocess_errors(tmp_path):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
    calls=[]
    def run(command,**kwargs):
        calls.append((command,kwargs))
        if 'inspect' in command:return subprocess.CompletedProcess(command,0,stdout=b'tcp://remote:2375\n')
        raise AssertionError('remote engine must never execute')
    with patch.object(m.subprocess,'run',side_effect=run),patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=1000,create=True),patch.object(m.storage,'private_path',side_effect=lambda p,**kw:Path(p)):
        with pytest.raises(ValueError,match='LOCAL_DOCKER_REQUIRED'):m.Docker(state)
    assert len(calls)==1


def test_docker_context_is_explicit_and_ambient_engine_overrides_removed(tmp_path,monkeypatch):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
    for name in ['DOCKER_HOST','DOCKER_CONTEXT','COMPOSE_FILE','PGPASSWORD']:monkeypatch.setenv(name,'private-fixture')
    calls=[]
    def run(command,**kwargs):
        calls.append((command,kwargs))
        if 'context' in command:return subprocess.CompletedProcess(command,0,stdout=b'unix:///var/run/docker.sock\n')
        kwargs['stderr'].write(b'fixture secret must remain private')
        return subprocess.CompletedProcess(command,9,stdout=b'private output')
    with patch.object(m.subprocess,'run',side_effect=run),patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=1000,create=True),patch.object(m.storage,'private_path',side_effect=lambda p,**kw:Path(p)):
        docker=m.Docker(state)
        with pytest.raises(RuntimeError,match='^DOCKER_OPERATION_FAILED$'):docker.run('ps')
    assert calls[-1][0][:5]==['sudo','-n','docker','--context','default']
    assert all(not any(k.startswith(('DOCKER_','COMPOSE_','PG')) for k in kw['env']) for _,kw in calls)
    logs=list(state.glob('*.log'));assert len(logs)==1
    assert 'private-fixture' not in logs[0].read_text()


def baseline(name,image,project,service,ports=None):
    return {'Name':'/'+name,'Id':'c'*64,'Image':image,'Config':{'Labels':{'com.docker.compose.project':project,'com.docker.compose.service':service}},
            'HostConfig':{'PortBindings':ports or {}},'State':{'Running':True},'Mounts':[]}


def test_old_candidates_stop_allowlist_requires_exact_label_image_and_no_public_ports():
    m=module();obj=baseline('village-api-validation-api','sha256:'+'a'*64,'village-api-validation','api',{'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18080'}]})
    proof=m.stop_receipt(obj)
    assert proof['id']=='c'*64 and proof['name']=='village-api-validation-api'
    for name in ['village-web-web-1','other-service','village-autonomous-api']:
        with pytest.raises(ValueError):m.stop_receipt({**obj,'Name':'/'+name})
    obj['HostConfig']['PortBindings']['8080/tcp'][0]['HostIp']='0.0.0.0'
    with pytest.raises(ValueError):m.stop_receipt(obj)


def test_storage_candidate_matches_the_existing_deployer_project_name():
    m=module();obj=baseline('village-storage-validation-api','sha256:'+'a'*64,'village-storage-read-validation','api')
    assert m.stop_receipt(obj)['project']=='village-storage-read-validation'


def test_checkpoint_is_bound_to_exact_source_release_and_never_reexecutes_unproven_pending(tmp_path):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
    gate=m.Checkpoints(state,{'release':'a'*40,'archive':'b'*64});calls=[]
    receipt=gate.step('once',lambda:calls.append(1) or {'nonce':'fixed'},lambda r:r=={'nonce':'fixed'})
    assert gate.step('once',lambda:pytest.fail('must not repeat'),lambda r:r==receipt)==receipt
    assert calls==[1]
    with pytest.raises(ValueError):m.Checkpoints(state,{'release':'c'*40,'archive':'b'*64})
    gate.doc['steps']['uncertain']={'status':'pending'};gate.save()
    with pytest.raises(ValueError,match='PARTIAL_STEP_REQUIRES_INSPECTION'):
        gate.step('uncertain',lambda:pytest.fail('must not repeat'),lambda _:True)


def test_auth_trigger_audit_allows_only_known_signup_hook():
    m=module()
    m.audit_auth_triggers([{'name':'on_auth_user_created','table':'users','function_schema':'public','function_name':'handle_new_auth_user'}])
    for row in [{'name':'unexpected','table':'users','function_schema':'public','function_name':'handle_new_user'},
                {'name':'on_auth_user_created','table':'users','function_schema':'public','function_name':'send_to_network'}]:
        with pytest.raises(ValueError,match='UNKNOWN_AUTH_TRIGGER'):m.audit_auth_triggers([row])


def test_private_operations_require_exact_local_runtime_and_shared_internal_network(tmp_path):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
    meta={'schemaVersion':2,'kind':'autonomous','releaseId':'autonomous-'+'a'*12,
          'accepted_image_ids':['sha256:'+'a'*64],'auth_image_id':'sha256:'+'b'*64,'postgres_image_id':'sha256:'+'c'*64}
    m.storage.write_private_json(state/'release.json',meta)
    class Docker:
        bad=False
        def own_container(self,name,release):
            image='a' if name==m.API else 'b' if name==m.AUTH else 'c'
            return {'Image':'sha256:'+image*64,'State':{'Running':True},'HostConfig':{'PortBindings':{}},
                'NetworkSettings':{'Networks':{'village-autonomous_dbnet':{'NetworkID':'d'*64}}},
                'Config':{'Env':['AUTH_MODE='+('source' if self.bad else 'local'),'AUTH_INTERNAL_ORIGIN=http://auth:9999','AUTH_PUBLIC_ORIGIN=https://8.148.248.237','PGHOST=postgres']}}
        def run(self,*args):return json.dumps([{'Name':'village-autonomous_dbnet','Id':'d'*64,'Internal':True}])
    d=Docker();assert m.verified_runtime(d,state)==(meta,'village-autonomous_dbnet')
    d.bad=True
    with pytest.raises(ValueError,match='LOCAL_RUNTIME_REQUIRED'):m.verified_runtime(d,state)


def test_offline_runtime_identity_can_use_only_archive_derived_import_aliases():
    m=module();calls=[];config='sha256:'+'a'*64;imported='sha256:'+'b'*64
    class Docker:
        def run(self,*args):
            calls.append(args)
            if args[-1]==config:raise RuntimeError('DOCKER_OPERATION_FAILED')
            return json.dumps([{'Id':imported,'Os':'linux','Architecture':'amd64'}])
    assert m.resolve_image(Docker(),[config,imported])==imported
    with pytest.raises(ValueError):m.resolve_image(Docker(),['untrusted:latest'])
    assert len(calls)==2


def test_mount_receipts_are_order_independent_and_old_hashes_require_identical_sets():
    import copy,hashlib,itertools
    m=module();obj=baseline('village-storage-validation-api','sha256:'+'a'*64,'village-storage-read-validation','api')
    obj['Mounts']=[{'Source':'/private/a','Destination':'/run/a','RW':False},{'Source':'/private/b','Destination':'/run/b','RW':True}]
    original=m.stop_receipt(obj);reverse=copy.deepcopy(obj);reverse['Mounts'].reverse()
    assert m.stop_receipt(reverse)['mounts_sha256']==original['mounts_sha256']
    old=[{'source':v['Source'],'target':v['Destination'],'rw':v['RW']} for v in reverse['Mounts']]
    legacy={**original,'mounts_sha256':hashlib.sha256(json.dumps(old,sort_keys=True).encode()).hexdigest()}
    assert m.matches_stop_receipt(obj,legacy)
    reverse['Mounts'][0]['RW']=False
    assert not m.matches_stop_receipt(reverse,legacy)
    changed=copy.deepcopy(obj);changed['Id']='d'*64
    assert not m.matches_stop_receipt(changed,legacy)
    changed=copy.deepcopy(obj);changed['Mounts'][0]['Source']='/private/other'
    assert not m.matches_stop_receipt(changed,legacy)


def test_legacy_mount_permutation_proof_is_bounded():
    m=module();obj=baseline('village-storage-validation-api','sha256:'+'a'*64,'village-storage-read-validation','api')
    obj['Mounts']=[{'Source':'/private/'+str(i),'Destination':'/run/'+str(i),'RW':False} for i in range(9)]
    receipt=m.stop_receipt(obj);receipt['mounts_sha256']='f'*64
    assert not m.matches_stop_receipt(obj,receipt)
