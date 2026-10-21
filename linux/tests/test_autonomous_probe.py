import sys
from pathlib import Path
import importlib.util
import json
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'probe-autonomous.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('autonomous_probe_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_local_probe_cannot_send_credentials_to_source_or_an_operator_supplied_origin():
    m=module();calls=[];api=m.AutonomousHttpApi(port=18443,request_impl=lambda *a,**k:calls.append((a,k)))
    for url in ['https://rzmbmwauomzwiyenafha.supabase.co/auth/v1/token','https://8.148.248.237.evil.test/api/v1/me','http://8.148.248.237/api/v1/me']:
        with pytest.raises(m.old.TransportFailure):api.request(url,method='POST',data={'password':'fixture hidden'})
    assert calls==[]
    with pytest.raises(ValueError):m.AutonomousHttpApi(port=9999)


def test_local_auth_probe_proves_profile_uuid_refresh_and_logged_out_session_denial():
    m=module();calls=[];logged_out=False;user='91000000-0000-4000-8000-000000000009'
    def request(path,method,headers,data,binary):
        nonlocal logged_out
        calls.append(path)
        if path.startswith('/auth/v1/token'):
            return 200,json.dumps({'user':{'id':user},'access_token':'fixture-local-token','refresh_token':'fixture-refresh'}).encode(),{}
        if path.startswith('/auth/v1/logout'):logged_out=True;return 204,b'',{}
        if path=='/api/v1/me':
            if logged_out or headers.get('Authorization')!='Bearer fixture-local-token':return 401,b'{"error":{"code":"UNAUTHORIZED"}}',{}
            return 200,json.dumps({'data':{'id':user,'role':'admin'}}).encode(),{}
        if path.endswith('list-courses'):
            assert method=='POST' and json.loads(data)=={}
            return 200,b'{"data":[]}',{}
        pytest.fail('unexpected probe path')
    api=m.AutonomousHttpApi(port=18443,request_impl=request)
    report=m.auth_probe(api,('332','fixture password'))
    assert all(report[key] for key in ('login','refresh','business_read','logout_revocation','source_token_rejected'))
    assert 'fixture-local-token' not in json.dumps(report) and 'fixture-refresh' not in json.dumps(report) and not any('supabase.co' in p for p in calls)


def test_autonomous_test_context_is_isolated_and_does_not_change_current_project_slot(tmp_path):
    builder_path=S/'build-autonomous-release.py'
    spec=importlib.util.spec_from_file_location('autonomous_context_builder_test',builder_path);builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    sql=builder.test_context_template(S.parents[1])
    assert 'Autonomous TEST' in sql and 'village_unified_candidate' in sql
    assert "id='__ADMIN_ID__'" in sql and "id='__MEMBER_ID__'" in sql
    assert "'practice_shared'" in sql and "'completed'" in sql
    assert 'UPDATE public.teaching_projects' not in sql
    control=tmp_path/'control';control.mkdir(mode=0o700);template=control/'autonomous-test-context.sql';template.write_text(sql);template.chmod(0o600)
    class Docker:
        def sql(self,text):return '{"status":"ready","test_memberships":1}'
    context=module().context_callback(Docker(),tmp_path)('91000000-0000-4000-8000-000000000009','91000000-0000-4000-8000-000000000008',None)
    assert context['spaceId'].startswith('unified-test-') and context['spaceId'] in sql
