import importlib.util
from pathlib import Path
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
