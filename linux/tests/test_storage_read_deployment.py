import hashlib
import importlib.util
import json
import copy as deepcopy_module
from pathlib import Path
import pytest

S=Path(__file__).resolve().parents[1]/'scripts'
def module():
    p=S/'deploy-storage-read-validation.py'
    assert p.exists(),'B2 deployment missing'
    spec=importlib.util.spec_from_file_location('storage_read_deploy',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def run_fixture(tmp_path,m):
    root=tmp_path/'copy';root.mkdir(mode=0o700);(root/'blobs').mkdir(mode=0o700)
    blob=b'private test GLB';digest=hashlib.sha256(blob).hexdigest()
    o={'id':'a0000000-0000-4000-8000-000000000001','bucket':'group-models','name':'users/test/模型.glb','declared_size':len(blob),'snapshot_updated_at':'2026-10-16T00:00:00Z','snapshot_etag':None,'snapshot_version':None}
    doc={'version':1,'project_ref':m.copy.PROJECT,'source_archive_sha256':'a'*64,'generated_at':'now','buckets':[{'id':'group-models','public':False}],'objects':[o]}
    (root/'blobs'/digest).write_bytes(blob);(root/'blobs'/digest).chmod(0o600)
    m.copy.write_private_json(root/'inventory.json',doc)
    m.copy.write_private_json(root/'copy-manifest.json',{'version':1,'inventory_sha256':m.copy.inventory_digest(doc),'records':{o['id']:{'status':'copied','sha256':digest,'received_bytes':len(blob),'needs_final_refresh':True}}})
    return root,o

def test_index_rechecks_private_bytes_and_archive_without_credentials(tmp_path):
    m=module();root,o=run_fixture(tmp_path,m)
    idx=m.prepare_index(root,'a'*64)
    assert idx['objects']==[{'id':o['id'],'bucket':'group-models','name':o['name'],'size':16,'sha256':hashlib.sha256(b'private test GLB').hexdigest(),
       'snapshot_updated_at':'2026-10-16T00:00:00.000000Z','declared_size':16,'snapshot_etag':None,'snapshot_version':None}]
    assert not (root/'.transfer.lock').exists()
    with pytest.raises(ValueError):m.prepare_index(root,'b'*64)
    (root/'blobs'/idx['objects'][0]['sha256']).write_bytes(b'bad')
    with pytest.raises(ValueError):m.prepare_index(root,'a'*64)

def test_index_rejects_incomplete_source_changed_and_existing_lock(tmp_path):
    m=module();root,o=run_fixture(tmp_path,m)
    for status in ['pending','missing','failed','source_changed']:
        manifest=m.copy.read_private_json(root/'copy-manifest.json');manifest['records'][o['id']]['status']=status;m.copy.write_private_json(root/'copy-manifest.json',manifest)
        with pytest.raises(ValueError):m.prepare_index(root,'a'*64)
    lock=m.copy.acquire_transfer_lock(root)
    try:
        with pytest.raises(RuntimeError):m.prepare_index(root,'a'*64)
    finally:lock.unlink()

def test_database_identity_must_match_index_exactly():
    m=module();obj={'id':'one','bucket':'group-models','name':'a','snapshot_updated_at':'2026-10-16T00:00:00.000000Z','declared_size':16,'snapshot_etag':'etag','snapshot_version':'v1'};idx={'objects':[obj]}
    assert m.validate_database_objects(idx,[obj]) is None
    for rows in [[],[obj|{'name':'b'}],[obj|{'bucket':'facade-generation'}],[obj|{'snapshot_version':'v2'}],[obj|{'snapshot_updated_at':'2026-10-16T00:00:00.000001Z'}],[obj|{'declared_size':17}],[obj|{'snapshot_etag':'changed'}]]:
        with pytest.raises(ValueError):m.validate_database_objects(idx,rows)

def test_candidate_compose_never_changes_db_or_exposes_public_files(tmp_path):
    m=module();doc=m.compose_document(tmp_path/'state',tmp_path/'api-a',tmp_path/'copy',uid=1000,gid=1000,key='public-test')
    assert list(doc['services'])==['api']
    s=doc['services']['api'];assert s['ports']==['127.0.0.1:18081:8080'];assert s['read_only'];assert s['cap_drop']==['ALL'];assert s['mem_limit']=='192m'
    assert {v['target'] for v in s['volumes']}=={'/run/secrets/api-password','/run/storage/index.json','/srv/business-storage/blobs'}
    assert all(v['read_only'] and not v['bind']['create_host_path'] for v in s['volumes'])
    assert s['environment']['PGUSER']=='village_storage_read_login';assert s['environment']['PGHOST']=='village-api-validation-postgres'
    password=next(v for v in s['volumes'] if v['target']=='/run/secrets/api-password')
    assert Path(password['source'])==tmp_path/'state/api-password'
    assert set(doc['networks'])=={'dbnet','authegress'};assert all(n['external'] for n in doc['networks'].values())

@pytest.mark.parametrize('bad',['none','image','public','write','socket','env','root','command','network','limits'])
def test_runtime_refuses_modified_security_and_identity(tmp_path,bad):
    m=module();spec=m.compose_document(tmp_path/'state',tmp_path/'a',tmp_path/'copy',uid=1000,gid=1000,key='public')['services']['api']
    image_config={'Cmd':['node','src/main.mjs'],'Entrypoint':None,'WorkingDir':'/app','Env':['BASE=base']}
    info={'Image':'sha256:known','Config':{'Image':m.IMAGE,'User':'1000:1000','Cmd':['node','src/main.mjs'],'Entrypoint':None,'WorkingDir':'/app',
      'Labels':{'com.docker.compose.project':m.PROJECT,'com.docker.compose.service':'api'},'Env':['BASE=base']+[k+'='+v for k,v in spec['environment'].items()]},
      'HostConfig':{'ReadonlyRootfs':True,'Privileged':False,'CapAdd':None,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges:true'],'Memory':192*1024**2,'MemorySwap':192*1024**2,'NanoCpus':500000000,'PidsLimit':64,'PortBindings':{'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18081'}]}},
      'Mounts':[{'Type':'bind','Destination':v['target'],'Source':v['source'],'RW':False} for v in spec['volumes']],
      'NetworkSettings':{'Networks':{'village-api-validation_dbnet':{},'village-api-validation_authegress':{}}}}
    if bad=='image':info['Image']='sha256:wrong'
    if bad=='public':info['HostConfig']['PortBindings']['8080/tcp'][0]['HostIp']='0.0.0.0'
    if bad=='write':info['Mounts'][0]['RW']=True
    if bad=='socket':info['Mounts'].append({'Type':'bind','Destination':'/var/run/docker.sock','Source':'/var/run/docker.sock','RW':True})
    if bad=='env':info['Config']['Env'].append('SUPABASE_SERVICE_ROLE_KEY=bad')
    if bad=='root':info['Config']['User']='0:0'
    if bad=='command':info['Config']['Cmd']=['sh']
    if bad=='network':info['NetworkSettings']['Networks']['public']={}
    if bad=='limits':info['HostConfig']['Memory']=0
    if bad=='none':m.validate_container(info,spec,image_config,'sha256:known',uid=1000)
    else:
        with pytest.raises(ValueError):m.validate_container(info,spec,image_config,'sha256:known',uid=1000)

def test_preflight_existing_state_never_mutates_containers(tmp_path,monkeypatch):
    m=module();state=tmp_path/'existing';state.mkdir();monkeypatch.setattr(m,'STATE',state)
    class Docker:
        def run(self,*a,**kw):pytest.fail('Should refuse before Docker mutation')
    with pytest.raises(ValueError):m.preflight(Docker())

def test_hba_addition_keeps_a_rule_and_restricts_b2_to_same_db_subnet():
    m=module()
    old='local all all trust\nhost village_copy village_api_login 172.28.0.0/16 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'
    expected='local all all trust\nhost village_copy village_api_login 172.28.0.0/16 scram-sha-256\nhost village_copy village_storage_read_login 172.28.0.0/16 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'
    assert m.storage_hba(old)==expected
    for bad in [old.replace('scram-sha-256','trust'),old+'host all all 0.0.0.0/0 trust\n',old.replace('village_api_login','other')]:
        with pytest.raises(ValueError):m.storage_hba(bad)

def test_image_builder_supports_distinct_tag_and_metadata_without_retagging_a(tmp_path,monkeypatch):
    spec=importlib.util.spec_from_file_location('builder_b2',S/'build-business-api-image.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    config={'os':'linux','architecture':'amd64','rootfs':{'diff_ids':[]},'config':{}}
    monkeypatch.setattr(m,'validate_base',lambda _: (config,[]))
    root=tmp_path/'api';(root/'src').mkdir(parents=True);(root/'node_modules/pg').mkdir(parents=True)
    for p in [root/'package.json',root/'package-lock.json',root/'node_modules/pg/package.json']:p.write_text('{}')
    (root/'src/main.mjs').write_text('console.log(1)')
    meta=m.build(tmp_path/'base',tmp_path/'image.tar.gz',root,image='village-business-api:stage-b2-read')
    assert meta['image']=='village-business-api:stage-b2-read'
    import tarfile
    with tarfile.open(tmp_path/'image.tar.gz') as t:assert json.load(t.extractfile('manifest.json'))[0]['RepoTags']==['village-business-api:stage-b2-read']
