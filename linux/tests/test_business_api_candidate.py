import importlib.util
from pathlib import Path
import json
from unittest.mock import patch
import pytest
S=Path(__file__).resolve().parents[1]/'scripts/verify-business-api-candidate.py'
def module():
    assert S.is_file(),'Candidate acceptance verifier missing'
    s=importlib.util.spec_from_file_location('candidate_verifier',S);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def test_catalog_contract_rejects_unsafe_role_or_missing_rls():
    m=module()
    good={'safe_role':True,'safe_membership':True,'rls_tables':5,'required_columns':25}
    m.validate_contract(good)
    for key,value in [('safe_role',False),('safe_membership',False),('rls_tables',4),('required_columns',24)]:
        with pytest.raises(ValueError):m.validate_contract({**good,key:value})
def test_permission_failure_does_not_produce_success_report(tmp_path):
    m=module()
    class Bad:
        def sql(self,*a,**kw):raise RuntimeError('private SQL failure')
    with pytest.raises(RuntimeError):m.verify_permissions(Bad())
    assert not (tmp_path/'candidate-verification.json').exists()

def test_new_verification_attempt_invalidates_old_success_but_preserves_history(tmp_path):
    m=module();assert hasattr(m,'start_attempt'),'Attempt invalidation missing'
    for name in ('candidate-verification.json','api-acceptance.json'):
        (tmp_path/name).write_text('{"status":"old success"}');(tmp_path/name).chmod(0o600)
    attempt=m.start_attempt(tmp_path)
    assert attempt['status']=='running' and attempt['attempt_id']
    assert not (tmp_path/'candidate-verification.json').exists()
    assert not (tmp_path/'api-acceptance.json').exists()
    assert list(tmp_path.glob('candidate-verification.previous-*.json'))

def test_candidate_cannot_accept_socket_permissions_without_api_tcp(tmp_path,capsys):
    m=module()
    (tmp_path/'candidate-verification.json').write_text('{"status":"old success"}')
    (tmp_path/'candidate-verification.json').chmod(0o600)
    class Disconnected:
        def __init__(self,*args,**kwargs):pass
        def run(self,args,**kwargs):
            assert args[:3]==['exec','-i',m.deploy.API]
            raise RuntimeError('API database connection refused')
    with patch.object(m.rd,'LocalDocker',Disconnected),patch.object(m.deploy,'validate_runtime',return_value={}):
        with pytest.raises(RuntimeError,match='connection refused'):
            m.verify(tmp_path/'backup',tmp_path)
    assert json.loads((tmp_path/'verification-attempt.json').read_text())['status']=='failed'
    assert not (tmp_path/'candidate-verification.json').exists()
    assert 'CANDIDATE_PERMISSIONS_RESTART_VERIFIED' not in capsys.readouterr().out
