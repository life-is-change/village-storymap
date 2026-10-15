import importlib.util
import io
import json
from pathlib import Path
import pytest
S=Path(__file__).resolve().parents[1]/'scripts/probe-business-api.py'
def module():
    assert S.is_file(),'Private login probe missing'
    s=importlib.util.spec_from_file_location('probe_api',S);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def test_probe_restricts_urls_and_never_includes_credentials_in_report():
    m=module()
    for url in ['http://8.148.248.237','https://evil.invalid','http://u:p@localhost:18080','http://127.0.0.1:18080/?secret=x']:
        with pytest.raises(ValueError):m.validate_api_url(url)
    uid='10000000-0000-4000-8000-000000000001'
    class Response(io.BytesIO):
        def __enter__(self):return self
        def __exit__(self,*a):self.close()
    class Opener:
        def open(self,request,timeout):
            if '/token?' in request.full_url:return Response(json.dumps({'access_token':'private-token','user':{'id':uid}}).encode())
            return Response(json.dumps({'data':{'id':uid} if request.full_url.endswith('/me') else []}).encode())
    report=m.perform_probe('http://127.0.0.1:18080','student','private-password',Opener())
    assert report['status']=='authenticated_read_probe_passed'
    assert 'private' not in json.dumps(report)
def test_probe_outage_never_emits_success_and_redirect_is_refused():
    m=module()
    class Bad:
        def open(self,*a,**kw):raise OSError('private-password token')
    with pytest.raises(RuntimeError,match='PROBE_FAILED') as e:m.perform_probe('http://127.0.0.1:18080','student','private-password',Bad())
    assert 'private-password' not in str(e.value)
    with pytest.raises(ValueError):m.NoRedirect().redirect_request(None,None,302,'','', 'https://evil.invalid')
def test_acceptance_requires_matching_sql_restart_and_auth_proof():
    m=module()
    with pytest.raises(ValueError):m.acceptance_ready({}, {}, {'status':'authenticated_read_probe_passed'})
    checkpoint={'source_archive_sha256':'a','api_image_id':'i'}
    assert m.acceptance_ready({'status':'permissions_restart_verified','source_archive_sha256':'a','api_image_id':'i'},checkpoint,{'status':'authenticated_read_probe_passed'})
