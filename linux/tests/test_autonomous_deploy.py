import sys
import importlib.util
from pathlib import Path
import pytest
import json
from unittest.mock import patch

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'deploy-autonomous.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('autonomous_deploy_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_candidate_stop_checks_entire_receipt_set_before_stopping_anything():
    m=module();calls=[]
    from test_autonomous_operator import baseline
    names=['village-api-validation-api','village-api-validation-postgres']
    objects={n:baseline(n,'sha256:'+'a'*64,'village-api-validation','api' if n.endswith('api') else 'db') for n in names}
    receipts=[m.stop_receipt(obj) for obj in objects.values()]
    class Docker:
        def inspect(self,name):return objects[name]
        def run(self,*args):calls.append(args)
    objects[names[-1]]['Image']='sha256:'+'b'*64
    with pytest.raises(ValueError):m.stop_old_candidates(Docker(),receipts)
    assert calls==[]
    objects[names[-1]]['Image']='sha256:'+'a'*64
    m.stop_old_candidates(Docker(),receipts)
    assert calls==[('stop','--time','30','c'*64),('stop','--time','30','c'*64)]


def test_resource_gate_uses_available_ram_and_includes_database_and_all_file_budget():
    m=module();m.check_resources(available=700*1024**2,disk=10*1024**3,database=100*1024**2,files=30*1024**2)
    for kwargs in [dict(available=100*1024**2,disk=10*1024**3,database=100,files=100),
                   dict(available=700*1024**2,disk=5*1024**3,database=1024**3,files=1024**3)]:
        with pytest.raises(ValueError):m.check_resources(**kwargs)


def test_partial_schema_is_resumed_only_from_matching_database_transaction_receipt():
    m=module();sql='CREATE TABLE synthetic(id int);';digest=m.schema.step_hash(sql);calls=[]
    class Docker:
        def sql(self,query):
            calls.append(query)
            if query.startswith('SELECT'):return json.dumps({'sha256':digest})
            pytest.fail('already committed SQL must not repeat')
    assert m.install_schema_step(Docker(),'identity.sql',sql)=={'sha256':digest}
    with pytest.raises(ValueError):m.install_schema_step(Docker(),'identity.sql',sql+'-- changed')
    assert all(query.startswith('SELECT') for query in calls)


def test_apply_refuses_missing_recent_acceptance_before_touching_public_web(tmp_path):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
    class Docker:
        def run(self,*args):pytest.fail('no public operation before acceptance')
    with pytest.raises(ValueError,match='RECENT_LOCAL_ACCEPTANCE_REQUIRED'):m.require_acceptance(state,{'releaseId':'fixture'},now=10000)


def test_existing_public_switch_blocks_replaying_fresh_candidate_deployment(tmp_path):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
    m.storage.write_private_json(state/'public-switch.json',{'status':'pending'})
    with pytest.raises(ValueError,match='PUBLIC_SWITCH_REQUIRES_EXPLICIT_RECOVERY'):
        m.deploy({'releaseId':'fixture'},tmp_path/'image',tmp_path/'backup',tmp_path/'files',state=state)
