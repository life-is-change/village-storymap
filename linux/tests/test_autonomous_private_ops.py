import sys
from pathlib import Path
import importlib.util
import pytest
import json

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'autonomous_private_ops.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('autonomous_private_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_recovery_ephemeral_mounts_only_private_required_secrets_and_never_password_arguments(tmp_path):
    m=module();meta={'kind':'autonomous','schemaVersion':2,'accepted_image_ids':['sha256:'+'a'*64]}
    command=m.recovery_command(meta,tmp_path,'village-autonomous_dbnet',image='sha256:'+'a'*64,uid=1000,gid=1000)
    assert command[:3]==['run','--rm','-i'] and command[-2:]==['node','auth/recovery-cli.mjs']
    assert '--read-only' in command and '--pull=never' in command
    assert command.count('--mount')==2 and '--env' not in command
    assert 'api-password' in ' '.join(command) and 'auth-jwt' in ' '.join(command)
    with pytest.raises(ValueError):m.recovery_command(meta,tmp_path,'other',image='sha256:'+'a'*64,uid=1000,gid=1000)


def test_cloud_reconciliation_uses_owner_db_operation_not_provider_resubmission():
    m=module();request='91000000-0000-4000-8000-000000000009'
    sql=m.cloud_reconcile_sql(request,'known-provider-id','aliyun-village')
    assert "'reconcile'" in sql and 'local_cloud_call' in sql and 'local_gpu_runs' in sql
    assert 'https://' not in sql and 'INSERT INTO' not in sql
    for req,job in [('not-a-uuid','x'),(request,"x');DROP TABLE users;--")]:
        with pytest.raises(ValueError):m.cloud_reconcile_sql(req,job,'aliyun-village')


def test_chunk_cleanup_removes_only_exact_expired_upload_folders_and_retains_unknown_files(tmp_path):
    m=module();root=tmp_path/'task-chunks';root.mkdir(mode=0o700)
    (root/'instance').write_text('aliyun-village');(root/'instance').chmod(0o600)
    one='91000000-0000-4000-8000-000000000009';two='92000000-0000-4000-8000-000000000009'
    for uid in [one,two]:
        p=root/uid;p.mkdir(mode=0o700);(p/'0.chunk').write_bytes(b'fixture');(p/'0.chunk').chmod(0o600)
    assert m.remove_expired_chunks(root,[one],instance='aliyun-village')=={'uploads':1,'bytes':7}
    assert (root/two/'0.chunk').is_file()
    with pytest.raises(ValueError):m.remove_expired_chunks(root,['../elsewhere'],instance='aliyun-village')
    (root/two/'unknown').write_text('retain')
    with pytest.raises(ValueError):m.remove_expired_chunks(root,[two],instance='aliyun-village')
    assert (root/two/'0.chunk').is_file()


def test_cleanup_query_only_aborts_stale_invalid_leases_and_keeps_blob_tables():
    m=module();sql=m.EXPIRED_CHUNKS_SQL
    assert "interval '24 hours'" in sql and 'lease_token' in sql and 'lease_until' in sql
    assert 'local_gpu_uploads' in sql and 'DELETE' not in sql
    assert 'task_artifacts' not in sql and 'file_objects' not in sql
