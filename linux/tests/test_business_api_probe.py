import importlib.util
import io
import json
import ssl
from pathlib import Path
import pytest
import urllib.error
from unittest.mock import patch
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

@pytest.mark.parametrize('failed_path,phase,status', [
    ('/token?', 'auth_login', 400),
    ('/me', 'api_me', 503),
    ('/courses', 'api_courses', 500),
    ('kind=group', 'api_group_spaces', 403),
    ('kind=personal', 'api_personal_spaces', 502),
])
def test_probe_identifies_failing_step_without_echoing_remote_error(failed_path,phase,status):
    m=module();uid='10000000-0000-4000-8000-000000000001'
    class Response(io.BytesIO):
        def __enter__(self):return self
        def __exit__(self,*args):self.close()
    class Opener:
        def open(self,request,timeout):
            if failed_path in request.full_url:
                raise urllib.error.HTTPError('https://private-url',status,'private-token-password',{},io.BytesIO(b'private rows'))
            if '/token?' in request.full_url:return Response(json.dumps({'access_token':'private-token','user':{'id':uid}}).encode())
            return Response(json.dumps({'data':{'id':uid} if request.full_url.endswith('/me') else []}).encode())
    with pytest.raises(RuntimeError) as caught:
        m.perform_probe('http://127.0.0.1:18080','332','private-password',Opener())
    assert str(caught.value)==f'PROBE_FAILED phase={phase} category=http http_status={status}'
    assert 'private' not in str(caught.value)

def test_probe_cli_emits_only_safe_diagnostic_for_failed_login(capsys):
    m=module()
    with patch('sys.argv',['probe']),patch('builtins.input',return_value='332'),patch.object(m.getpass,'getpass',return_value='private-password'),patch.object(m,'perform_probe',side_effect=m.ProbeFailure('auth_login','network')):
        assert m.main()==1
    output=capsys.readouterr()
    assert 'PROBE_FAILED phase=auth_login category=network' in output.err
    assert 'private-password' not in output.err and 'VALIDATED_NOT_CUT_OVER' not in output.out

@pytest.mark.parametrize('error,category', [
    (OSError('private-password'), 'network'),
    (urllib.error.URLError(ssl.SSLCertVerificationError('private-url')), 'tls'),
    (ValueError('private-response'), 'response'),
])
def test_probe_redacts_network_tls_and_response_errors(error,category):
    m=module()
    class Opener:
        def open(self,*args,**kwargs):raise error
    with pytest.raises(RuntimeError) as caught:
        m.perform_probe('http://127.0.0.1:18080','332','private-password',Opener())
    assert str(caught.value)==f'PROBE_FAILED phase=auth_login category={category}'
def test_acceptance_requires_matching_sql_restart_and_auth_proof():
    m=module()
    with pytest.raises(ValueError):m.acceptance_ready({}, {}, {'status':'authenticated_read_probe_passed'})
    checkpoint={'source_archive_sha256':'a','api_image_id':'i'}
    import time
    verification={'status':'permissions_restart_verified','source_archive_sha256':'a','api_image_id':'i','attempt_id':'new','runtime_fingerprint':'current'}
    attempt={'status':'passed','attempt_id':'new','started_at':time.time()}
    assert m.acceptance_ready(verification,checkpoint,{'status':'authenticated_read_probe_passed'},attempt=attempt,runtime_fingerprint='current')
    for bad in ({**attempt,'status':'failed'},{**attempt,'status':'running'},{**attempt,'attempt_id':'old'},{**attempt,'started_at':0}):
        with pytest.raises(ValueError):m.acceptance_ready(verification,checkpoint,{'status':'authenticated_read_probe_passed'},attempt=bad,runtime_fingerprint='current')
    with pytest.raises(ValueError):m.acceptance_ready(verification,checkpoint,{'status':'authenticated_read_probe_passed'},attempt=attempt,runtime_fingerprint='different')

def test_saved_acceptance_has_final_status_and_preserves_probe_status():
    m=module();assert hasattr(m,'acceptance_report'),'Final acceptance writer missing'
    value=m.acceptance_report({'status':'authenticated_read_probe_passed','counts':{}},{'attempt_id':'new'})
    assert value['status']=='internal_validated_not_cut_over'
    assert value['probe_status']=='authenticated_read_probe_passed'
