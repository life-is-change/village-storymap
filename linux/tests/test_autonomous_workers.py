import sys
from pathlib import Path
import importlib.util
import hashlib
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'provision-local-workers.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('autonomous_workers_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_worker_registration_hashes_only_secret_component_and_never_embeds_key():
    m=module();key,record=m.new_credential('geo')
    identifier,secret=key.removeprefix('village_worker_').split('.')
    assert record['id']==identifier and record['digest']==hashlib.sha256(secret.encode()).hexdigest()
    sql=m.register_sql(record)
    assert key not in sql and secret not in sql
    assert record['digest'] in sql and "'geo'" in sql
    assert 'UPDATE api_private.local_gpu_workers' not in sql


def test_explicit_dataset_mapping_refuses_sql_injection_and_never_retargets_existing_mapping():
    m=module();uid='91000000-0000-4000-8000-000000000009';sql=m.mapping_sql(uid,'qiaoxi')
    assert 'SOURCE_MAPPING_ALREADY_DIFFERS' in sql and 'ON CONFLICT' in sql
    assert 'UPDATE api_private.task_worker_villages' not in sql
    for local,source in [('invalid','qiaoxi'),(uid,"qiaoxi';secret")]:
        with pytest.raises(ValueError):m.mapping_sql(local,source)


def test_worker_credential_resume_requires_exact_private_key_and_kind(tmp_path):
    m=module();root=tmp_path/'worker-credentials';root.mkdir(mode=0o700)
    first=m.credential(root,'geo');second=m.credential(root,'geo')
    assert first==second
    (root/'aliyun-facade.key').write_text((root/'aliyun-geo.key').read_text());(root/'aliyun-facade.key').chmod(0o600)
    with pytest.raises(ValueError):m.credential(root,'facade')
