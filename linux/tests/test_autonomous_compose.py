import sys
from pathlib import Path
import pytest
import json

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))


def module():
    import autonomous_compose
    return autonomous_compose


def metadata():
    return {'schemaVersion':2,'kind':'autonomous','releaseId':'autonomous-'+'a'*12,'instanceId':'aliyun-village',
            'image':'village-autonomous:'+'a'*12,'accepted_image_ids':['sha256:'+'a'*64],
            'nginx_image_id':'sha256:'+'b'*64,'postgres_image_id':'sha256:'+'c'*64,
            'auth_image_id':'sha256:'+'d'*64}


def test_candidate_has_private_ports_bounded_resources_and_no_source_credentials(tmp_path):
    m=module();meta=metadata();doc=m.compose_document(tmp_path,meta,uid=1000,gid=1000)
    assert doc['name']=='village-autonomous' and len(doc['services'])==4
    db,api,auth,web=[doc['services'][n] for n in ('postgres','api','auth','web')]
    assert not db.get('ports') and not auth.get('ports')
    assert api['ports']==['127.0.0.1:18087:8080']
    assert web['ports']==['127.0.0.1:18086:8080','127.0.0.1:18443:8443']
    assert db['mem_limit']=='768m' and api['mem_limit']=='256m' and auth['mem_limit']=='128m'
    assert doc['networks']['dbnet']['internal'] is True
    assert 'egress' not in db['networks'] and 'egress' not in auth['networks']
    assert 'egress' in api['networks']
    assert 'frontnet' in web['networks'] and not doc['networks']['frontnet'].get('internal',False)
    assert api['environment']['AUTH_MODE']=='local'
    assert api['environment']['AUTH_INTERNAL_ORIGIN']=='http://auth:9999'
    assert api['environment']['FACADE_CLOUD_ENABLED']=='false'
    encoded=json.dumps(doc)
    assert all(x not in encoded for x in ('SUPABASE_','BRIDGE_TOKEN','GOTRUE_JWT_SECRET'))
    assert all(v['pull_policy']=='never' for v in doc['services'].values())
    for svc in doc['services'].values():
        assert svc['labels']['village.autonomous.release']==meta['releaseId']
        assert svc['read_only'] is True


def test_public_switch_changes_only_web_ports_and_tls_mount_is_directory(tmp_path):
    m=module();meta=metadata();before=m.compose_document(tmp_path,meta,uid=1000,gid=1000)
    after=m.compose_document(tmp_path,meta,uid=1000,gid=1000,public=True)
    assert after['services']['web']['ports']==['0.0.0.0:80:8080','0.0.0.0:443:8443']
    before['services']['web']['ports']=after['services']['web']['ports']
    assert before==after
    tls=next(v for v in after['services']['web']['volumes'] if v['target']=='/run/tls')
    assert tls['source']==str(tmp_path/'tls') and tls['read_only']


def test_fixed_identity_refuses_legacy_manifest_or_source_auth_mode(tmp_path):
    m=module();meta=metadata()
    for update in [{'schemaVersion':1},{'kind':'source'},{'releaseId':'unified-'+'a'*12},{'instanceId':'other'}]:
        with pytest.raises(ValueError):m.compose_document(tmp_path,{**meta,**update},uid=1000,gid=1000)
    with pytest.raises(ValueError):m.compose_document(tmp_path,meta,uid=0,gid=0)
