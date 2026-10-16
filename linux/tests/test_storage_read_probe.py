import hashlib
import importlib.util
import io
import json
from pathlib import Path
import urllib.error
import pytest
import warnings

def module():
    p=Path(__file__).resolve().parents[1]/'scripts/probe-storage-read.py'
    assert p.exists(),'B2 file probe missing'
    spec=importlib.util.spec_from_file_location('storage_probe',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

DATA=b'GLB-test';OID='a0000000-0000-4000-8000-000000000001'
INDEX={'version':1,'objects':[{'id':OID,'bucket':'group-models','name':'private.glb','size':8,'sha256':hashlib.sha256(DATA).hexdigest()}]}
class Response(io.BytesIO):
    def __init__(self,body,status=200,headers=None):super().__init__(body);self.status=status;self.headers=headers or {}
class Opener:
    def __init__(self,mode='good'):self.mode=mode
    def open(self,r,timeout):
        auth=r.get_header('Authorization')
        if '/auth/v1/token' in r.full_url:
            assert r.full_url.startswith('https://rzmbmwauomzwiyenafha.supabase.co/')
            return Response(json.dumps({'access_token':'private-token','user':{'id':'user'}}).encode())
        if not auth or auth=='Bearer invalid':raise urllib.error.HTTPError(r.full_url,401,'hidden',{},None)
        if r.full_url.endswith('/api/v1/me'):return Response(b'{"data":{"id":"user","role":"student"}}')
        if self.mode=='deny':raise urllib.error.HTTPError(r.full_url,404,'private detail',{},None)
        headers={'Cache-Control':'no-store','Content-Length':'8','ETag':'"sha256-'+INDEX['objects'][0]['sha256']+'"'}
        if r.method=='HEAD':return Response(b'',headers=headers)
        if r.get_header('Range'):
            headers.update({'Content-Range':'bytes 0-7/8','Content-Length':'8'});return Response(DATA,206,headers)
        return Response(b'corrupt!' if self.mode=='corrupt' else DATA,headers=headers)

def test_real_download_hash_head_range_and_no_auth_are_required():
    m=module();r=m.perform_probe(INDEX,'332','synthetic-only',opener=Opener())
    assert r['status']=='authenticated_files_probe_passed';assert r['readable']==1;assert r['verified_bytes']==8
    assert 'private-token' not in json.dumps(r);assert 'private.glb' not in json.dumps(r)

@pytest.mark.parametrize('mode',['deny','corrupt'])
def test_missing_readable_coverage_or_corrupt_bytes_cannot_pass(mode):
    m=module()
    with pytest.raises(m.ProbeFailure) as e:m.perform_probe(INDEX,'332','synthetic-only',opener=Opener(mode))
    assert not any(x in str(e.value) for x in ('private-token','private.glb','synthetic-only'))

def test_acceptance_binds_current_runtime_and_fresh_restart_proof():
    m=module();proof={'status':'restart_verified','runtime_fingerprint':'same','verified_at':1000,'attempt_id':'one'}
    assert m.acceptance_ready(proof,'same',now=1100)
    for change,fp,now in [({},'wrong',1100),({},'same',5000),({'status':'failed'},'same',1100),({'attempt_id':''},'same',1100)]:
        with pytest.raises(ValueError):m.acceptance_ready(proof|change,fp,now=now)

def test_hidden_password_warning_stops_before_password_or_network_use(monkeypatch,capsys,tmp_path):
    m=module();monkeypatch.setattr(m.sys,'argv',['probe-storage-read.py']);monkeypatch.setattr(m.sys,'platform','linux')
    monkeypatch.setattr(m.os,'geteuid',lambda:1000,raising=False)
    monkeypatch.setattr(m.deploy,'STATE',tmp_path/'candidate')
    monkeypatch.setattr(m.deploy.deploy.rd,'LocalDocker',lambda *a,**k:object())
    monkeypatch.setattr(m.deploy,'runtime_fingerprint',lambda _: 'fp')
    monkeypatch.setattr(m.deploy.copy,'read_private_json',lambda _: {'status':'restart_verified','runtime_fingerprint':'fp','verified_at':m.time.time(),'attempt_id':'one'})
    monkeypatch.setattr('builtins.input',lambda _: '332')
    def no_hidden(_):warnings.warn('no hidden terminal',m.getpass.GetPassWarning);return 'must-not-be-used'
    monkeypatch.setattr(m.getpass,'getpass',no_hidden)
    monkeypatch.setattr(m,'perform_probe',lambda *a,**k:pytest.fail('Must stop before using a password'))
    assert m.main()==1
    assert 'must-not-be-used' not in capsys.readouterr().err
