import copy
import importlib.util
import json
from pathlib import Path
import sys
import io
import hashlib
import base64
from types import SimpleNamespace
from unittest.mock import patch
import pytest

S=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(S))

def module():
    path=S/'business_storage_copy.py'
    assert path.is_file(), 'Storage copy module missing'
    spec=importlib.util.spec_from_file_location('storage_copy_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def inventory():
    return {'version':1,'project_ref':'rzmbmwauomzwiyenafha','source_archive_sha256':'a'*64,
            'generated_at':'2026-10-16T00:00:00+00:00','buckets':[{'id':'scene-assets','public':False},{'id':'geoprocessing-results','public':False}],
            'objects':[{'id':'object-1','bucket':'scene-assets','name':'空间/模型 1%.glb','snapshot_updated_at':'2026-10-01', 'declared_size':3,'snapshot_etag':None,'snapshot_version':None},
                       {'id':'object-2','bucket':'geoprocessing-results','name':'gpu/file','snapshot_updated_at':'2026-10-01','declared_size':None,'snapshot_etag':None,'snapshot_version':None}]}

def test_inventory_classification_and_summary_does_not_expose_object_paths():
    m=module();doc=m.validate_inventory(inventory());summary=m.inventory_summary(doc)
    assert summary['selected_objects']==1 and summary['excluded_objects']==1
    assert summary['known_bytes']==3 and summary['unknown_sizes']==0
    assert '空间' not in json.dumps(summary,ensure_ascii=False)
    assert m.SELECTED_BUCKETS=={'house-photos','scene-assets','scene-version-previews','group-models','village-datasets'}

@pytest.mark.parametrize('change', ['project','duplicate','size','bool_size','path','bucket','unknown_bucket'])
def test_inventory_rejects_malformed_or_ambiguous_input(change):
    m=module();doc=inventory()
    if change=='project':doc['project_ref']='other-project'
    if change=='duplicate':doc['objects'].append(copy.deepcopy(doc['objects'][0]))
    if change=='size':doc['objects'][0]['declared_size']=-1
    if change=='bool_size':doc['objects'][0]['declared_size']=True
    if change=='path':doc['objects'][0]['name']='../secret'
    if change=='bucket':doc['buckets'][0]['id']='../bucket'
    if change=='unknown_bucket':doc['objects'][0]['bucket']='missing-bucket'
    with pytest.raises(ValueError):m.validate_inventory(doc)

def test_inventory_empty_and_unknown_sizes():
    m=module();doc=inventory();doc['objects']=[]
    assert m.inventory_summary(m.validate_inventory(doc))['selected_objects']==0
    doc=inventory();doc['objects'][0]['declared_size']=None
    assert m.inventory_summary(m.validate_inventory(doc))['unknown_sizes']==1

def test_private_run_creation_refuses_web_overlap_and_existing_directory(tmp_path):
    m=module();web=tmp_path/'web';web.mkdir()
    with pytest.raises(ValueError):m.new_run_directory(web/'private',[web])
    run=tmp_path/'run';m.new_run_directory(run,[web])
    with pytest.raises(ValueError):m.new_run_directory(run,[web])
    m.write_private_json(run/'inventory.json',inventory())
    assert m.read_private_json(run/'inventory.json')['project_ref']=='rzmbmwauomzwiyenafha'

@pytest.mark.parametrize('accepted',[True,False])
def test_export_inventory_requires_matching_acceptance_and_keeps_private_rows(tmp_path,accepted):
    m=module();state=m.new_run_directory(tmp_path/'candidate',[]);backup=tmp_path/'backup'
    for name,doc in [('deployment-checkpoint.json',{'source_archive_sha256':'a'*64}),
        ('runtime-compose.json',{'services':{'db':{'volumes':[{'source':str(backup)}]}}}),
        ('candidate-verification.json',{'status':'permissions_restart_verified','runtime_fingerprint':'fp','source_archive_sha256':'a'*64,'attempt_id':'same'}),
        ('api-acceptance.json',{'status':'internal_validated_not_cut_over' if accepted else 'invalid','verification_attempt_id':'same'})]:
        m.write_private_json(state/name,doc)
    source=inventory();source['objects'][0]['declared_size']='3'
    class Docker:
        def exec(self,*args,input):
            assert args[:2]==('psql','-X') and 'BEGIN READ ONLY;' in input
            return json.dumps({'buckets':source['buckets'],'objects':source['objects']})
    deploy=SimpleNamespace(private_file=m.private_path,runtime_fingerprint=lambda *a:'fp',ROOT=tmp_path/'repo',rd=SimpleNamespace(ADMIN='fixture-admin',DATABASE='fixture-db'))
    target=tmp_path/'transfer'
    if accepted:
        summary=m.export_inventory(Docker(),state,target,deploy)
        assert summary['selected_objects']==1
        assert m.read_private_json(target/'inventory.json')['objects'][0]['name']=='空间/模型 1%.glb'
    else:
        with pytest.raises(ValueError):m.export_inventory(Docker(),state,target,deploy)
        assert not target.exists()

def legacy(role):
    encode=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
    return encode({'alg':'HS256'})+'.'+encode({'role':role,'ref':'rzmbmwauomzwiyenafha'})+'.signature'

@pytest.mark.parametrize('key',['my-database-password','sb_publishable_'+'a'*40,legacy('anon'),'short'])
def test_source_credential_rejects_non_server_keys(key):
    m=module()
    with pytest.raises(ValueError):m.credential_headers(key)

def test_new_secret_is_apikey_not_user_jwt_and_legacy_role_is_supported():
    m=module();key='sb_secret_'+'a'*40
    h=m.credential_headers(key)
    assert h['apikey']==key and 'Authorization' not in h
    assert m.credential_headers(legacy('service_role'))['Authorization']=='Bearer '+legacy('service_role')

class Body(io.BytesIO):
    def __init__(self,data):super().__init__(data);self.headers={'Content-Length':str(len(data)),'ETag':'"etag-v1"'}
    def read(self,n=-1):
        assert 0<n<=1024*1024
        return super().read(n)

class Transport:
    def __init__(self,m,*,body=b'abc',size=None,etag='"etag-v1"',error=None):
        self.m=m;self.body=body;self.size=len(body) if size is None else size;self.etag=etag;self.error=error;self.gets=0
    def head(self,obj):
        if self.error:raise self.m.SourceFailure(self.error)
        return {'size':self.size,'etag':self.etag,'last_modified':'date'}
    def get(self,obj,etag):
        self.gets+=1;return Body(self.body)

def setup_copy(tmp_path,m):
    root=m.new_run_directory(tmp_path/'copy',[]);m.write_private_json(root/'inventory.json',inventory());return root

def test_copy_bytes_hash_private_mapping_resume_and_independent_verify(tmp_path):
    m=module();root=setup_copy(tmp_path,m);transport=Transport(m)
    result=m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,transport)
    assert result['copied']==1 and result['excluded_objects']==1
    digest=hashlib.sha256(b'abc').hexdigest()
    assert (root/'blobs'/digest).read_bytes()==b'abc'
    assert '空间' not in json.dumps(result,ensure_ascii=False)
    assert m.verify_copy(root)['status']=='private_copy_verified_not_cut_over'
    m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,transport)
    assert transport.gets==1
    (root/'blobs'/digest).write_bytes(b'bad')
    with pytest.raises(ValueError):m.verify_copy(root)
    with pytest.raises(ValueError):m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,transport)

@pytest.mark.parametrize('status',[401,403,404,429,503])
def test_source_errors_never_report_copy_success(tmp_path,status):
    m=module();root=setup_copy(tmp_path,m)
    if status in (401,403,429,503):
        with pytest.raises(RuntimeError):m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(m,error=status))
    else:
        report=m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(m,error=status))
        assert report['missing']==1
    assert m.verify_copy(root)['status']=='private_copy_incomplete'
    assert not list((root/'blobs').iterdir())

@pytest.mark.parametrize('bad',['size_changed','truncated','etag','disk'])
def test_changed_or_incomplete_transfer_cannot_be_verified(tmp_path,bad,monkeypatch):
    m=module();root=setup_copy(tmp_path,m)
    transport=Transport(m,size=4 if bad=='size_changed' else 3,body=b'ab' if bad=='truncated' else b'abc')
    if bad=='etag':
        original=transport.head;count=[0]
        def head(obj):
            count[0]+=1;result=original(obj)
            if count[0]>1:result['etag']='"etag-v2"'
            return result
        transport.head=head
    if bad=='disk':
        monkeypatch.setattr(m.shutil,'disk_usage',lambda _:SimpleNamespace(free=1))
    if bad=='disk':
        with pytest.raises(RuntimeError):m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,transport)
    else:m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,transport)
    assert m.verify_copy(root)['status']=='private_copy_incomplete'

def test_unknown_size_and_zero_bytes_are_handled(tmp_path):
    m=module();root=setup_copy(tmp_path,m);doc=inventory();doc['objects'][0]['declared_size']=None
    m.write_private_json(root/'inventory.json',doc)
    assert m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(m,body=b''))['copied']==1
    assert m.verify_copy(root)['verified_bytes']==0

def test_fixed_source_url_encoding_and_redirect_refusal():
    m=module();seen=[]
    class Opener:
        def open(self,request,timeout):seen.append(request);return Body(b'abc')
    transport=m.SourceTransport('sb_secret_'+'a'*40,opener=Opener())
    obj=inventory()['objects'][0];transport.head(obj)
    assert seen[0].full_url=='https://rzmbmwauomzwiyenafha.supabase.co/storage/v1/object/authenticated/scene-assets/%E7%A9%BA%E9%97%B4/%E6%A8%A1%E5%9E%8B%201%25.glb'
    assert seen[0].get_method()=='HEAD'
    with pytest.raises(ValueError):m.NoRedirect().redirect_request(None,None,302,'',{},'https://outside.invalid')

def test_partial_stream_failure_is_preserved_and_resume_starts_full_object(tmp_path):
    m=module();root=setup_copy(tmp_path,m)
    class Broken(Transport):
        def get(self,obj,etag):
            class Stream(Body):
                calls=0
                def read(self,n=-1):
                    self.calls+=1
                    if self.calls>1:raise OSError('private source error')
                    return b'a'
            return Stream(b'abc')
    assert m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Broken(m))['failed']==1
    partials=list(root.glob('.download-*.partial'));assert partials and partials[0].read_bytes()==b'a'
    assert m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(m))['copied']==1
    assert partials[0].read_bytes()==b'a'

def test_transfer_path_links_and_inventory_changes_are_refused(tmp_path):
    m=module();root=setup_copy(tmp_path,m)
    m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(m))
    changed=inventory();changed['objects'][0]['name']='other.glb';m.write_private_json(root/'inventory.json',changed)
    with pytest.raises(ValueError):m.verify_copy(root)
    m.write_private_json(root/'inventory.json',inventory())
    target=root/'blobs'/hashlib.sha256(b'abc').hexdigest();target.rename(root/'original')
    try:target.symlink_to(root/'original')
    except OSError:pytest.skip('Host does not allow symlinks')
    with pytest.raises(ValueError):m.verify_copy(root)

def test_transport_retries_only_transient_failures_and_never_echoes_secret(monkeypatch):
    import urllib.error
    m=module();monkeypatch.setattr(m.time,'sleep',lambda _:None)
    class Opener:
        calls=0
        def open(self,request,timeout):
            self.calls+=1
            raise urllib.error.HTTPError('https://private',self.status,'sb_secret_private',{},io.BytesIO(b'private rows'))
    for status,attempts in [(401,1),(403,1),(404,1),(429,3),(503,3)]:
        opener=Opener();opener.status=status
        with pytest.raises(RuntimeError) as caught:m.SourceTransport('sb_secret_'+'a'*40,opener).head(inventory()['objects'][0])
        assert opener.calls==attempts
        assert 'private' not in str(caught.value)

def test_disk_failure_is_distinct_from_source_auth_failure(tmp_path,monkeypatch):
    m=module();root=setup_copy(tmp_path,m)
    monkeypatch.setattr(m.shutil,'disk_usage',lambda _:SimpleNamespace(free=1))
    with pytest.raises(RuntimeError,match='STORAGE_DISK_RESERVE_REQUIRED'):
        m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(m))

def cli():
    spec=importlib.util.spec_from_file_location('storage_cli',S/'copy-business-storage.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def test_cli_verify_only_never_requests_a_key_and_reports_incomplete(tmp_path,capsys):
    m=module();root=setup_copy(tmp_path,m);command=cli()
    with patch('sys.argv',['copy','--run-dir',str(root),'--verify-only']),patch.object(command.getpass,'getpass',side_effect=AssertionError('No key needed')):
        assert command.main()==2
    output=capsys.readouterr()
    assert 'STORAGE_PRIVATE_COPY_INCOMPLETE' in output.out
    assert 'STORAGE_PRIVATE_COPY_VERIFIED_NOT_CUT_OVER' not in output.out

def test_cli_hidden_key_is_not_saved_or_printed(tmp_path,capsys):
    m=module();root=setup_copy(tmp_path,m);command=cli();key='sb_secret_'+'z'*40
    real_copy=m.copy_inventory
    with patch('sys.argv',['copy','--run-dir',str(root)]),patch.object(command.getpass,'getpass',return_value=key),patch.object(command,'copy_inventory',side_effect=lambda inv,out,k:real_copy(inv,out,k,Transport(m))):
        assert command.main()==0
    output=capsys.readouterr()
    assert key not in output.out+output.err
    for path in root.rglob('*'):
        if path.is_file():assert key.encode() not in path.read_bytes()

def test_two_objects_share_one_verified_content_blob(tmp_path):
    m=module();root=setup_copy(tmp_path,m);doc=inventory();obj=copy.deepcopy(doc['objects'][0]);obj['id']='another';obj['name']='other.glb';doc['objects'].append(obj)
    m.write_private_json(root/'inventory.json',doc)
    assert m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(m))['copied']==2
    assert len(list((root/'blobs').iterdir()))==1
