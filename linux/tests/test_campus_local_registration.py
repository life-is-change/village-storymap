import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),S/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def encode(doc):return base64.urlsafe_b64encode(json.dumps(doc).encode()).decode().rstrip('=')


def test_local_private_keys_never_appear_in_public_enrollment_or_registration_sql(tmp_path):
    create=module('prepare-campus-local-credentials');cloud=module('register-campus-local-workers')
    root=tmp_path/'private';root.mkdir(mode=0o700)
    public=create.prepare(root)
    assert create.prepare(root)==public
    doc=cloud.decode(public);sql=cloud.registration_sql(doc)
    for kind in ('geo','facade'):
        raw=(root/('aliyun-'+kind+'.key')).read_text().strip();secret=raw.split('.')[1]
        assert secret not in public and secret not in sql and raw not in sql
        record=next(r for r in doc['workers'] if r['kind']==kind)
        assert record['digest']==hashlib.sha256(secret.encode()).hexdigest()
    assert "'campus-local-geo'" in sql and "'campus-local-facade'" in sql
    assert 'UPDATE ' not in sql and 'DELETE ' not in sql and 'REVOKE ' not in sql
    assert sql.startswith('BEGIN;') and sql.rstrip().endswith('COMMIT;')


def test_public_registration_rejects_injected_fields_duplicate_kinds_and_wrong_instance(tmp_path):
    create=module('prepare-campus-local-credentials');cloud=module('register-campus-local-workers')
    root=tmp_path/'private';root.mkdir(mode=0o700);valid=cloud.decode(create.prepare(root))
    for change in ('instance','secret','duplicate','sql'):
        doc=json.loads(json.dumps(valid))
        if change=='instance':doc['instanceId']='other'
        elif change=='secret':doc['workers'][0]['key']='must-not-be-received'
        elif change=='duplicate':doc['workers'][0]['kind']=doc['workers'][1]['kind']
        else:doc['workers'][0]['digest']="a'; SELECT secret"
        with pytest.raises(ValueError):cloud.decode(encode(doc))
    for raw in ('village_worker_PRIVATE','x'*4096,encode([]),encode({'version':True})):
        with pytest.raises((ValueError,TypeError)):cloud.decode(raw)
