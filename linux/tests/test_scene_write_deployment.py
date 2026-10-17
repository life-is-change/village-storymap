import importlib.util
import json
import io
import tarfile
import gzip
from pathlib import Path
import pytest
S=Path(__file__).resolve().parents[1]/'scripts'
def load(name):
    spec=importlib.util.spec_from_file_location('scene_test_'+name,S/name)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def test_scene_digest_and_image_cannot_change_a_b2_profiles(tmp_path,monkeypatch):
    m=load('build-business-api-image.py');root=tmp_path/'api';(root/'src').mkdir(parents=True);(root/'scene').mkdir()
    for p in ['package.json','package-lock.json','src/main.mjs']:(root/p).write_text('{}')
    (root/'scene/main.mjs').write_text('scene1');before=m.code_digest(root)
    digest=m.code_digest(root,include_scene=True);(root/'scene/main.mjs').write_text('scene2')
    assert m.code_digest(root)==before
    assert m.code_digest(root,include_scene=True)!=digest
    assert m.metadata_filename('village-business-api:stage-c1-scene')=='scene-write-image.json'
    assert m.metadata_filename('village-business-api:stage-b2-read')=='storage-read-image.json'

def test_scene_image_contains_separate_entrypoint_without_including_tests(tmp_path,monkeypatch):
    m=load('build-business-api-image.py');root=tmp_path/'api'
    for d in ['src','scene','node_modules/pg','test']:(root/d).mkdir(parents=True)
    for f in ['package.json','package-lock.json','src/main.mjs','scene/main.mjs','node_modules/pg/package.json']:(root/f).write_text('{}')
    (root/'test/private.test.mjs').write_text('not runtime')
    monkeypatch.setattr(m,'validate_base',lambda p:({'rootfs':{'diff_ids':[]},'config':{}},[]))
    target=tmp_path/'scene.tar.gz';metadata=m.build('unused',target,root,image='village-business-api:stage-c1-scene')
    with tarfile.open(target) as archive:
        manifest=json.load(archive.extractfile('manifest.json'))[0];cfg=json.load(archive.extractfile(manifest['Config']))
        assert cfg['config']['Cmd']==['node','scene/main.mjs']
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress(archive.extractfile(manifest['Layers'][0]).read()))) as runtime:
            names=runtime.getnames();assert 'app/scene/main.mjs' in names and all('/test/' not in p for p in names)
    assert metadata['code_sha256']==m.code_digest(root,include_scene=True)

def test_scene_compose_shares_database_instance_but_separates_database_and_loopback(tmp_path):
    m=load('deploy-scene-write-validation.py');doc=m.compose_document(tmp_path,uid=1000,gid=1000,key='public')
    assert set(doc['services'])=={'api'}
    api=doc['services']['api'];assert api['image']=='village-business-api:stage-c1-scene'
    assert api['ports']==['127.0.0.1:18082:8080']
    assert api['environment']['PGDATABASE']=='village_scene_validation'
    assert api['environment']['PGUSER']=='village_scene_login'
    assert api['read_only'] and api['mem_limit']=='192m' and api['cap_drop']==['ALL']
    assert len(api['volumes'])==1 and api['volumes'][0]['read_only']
    assert all(n['external'] for n in doc['networks'].values())

def test_scene_hba_only_adds_specific_role_in_specific_database():
    m=load('deploy-scene-write-validation.py')
    before='local all all trust\nhost village_copy village_api_login 172.20.0.0/16 scram-sha-256\nhost village_copy village_storage_read_login 172.20.0.0/16 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'
    after=m.b2.scene_hba(before)
    assert after.replace('host village_scene_validation village_scene_login 172.20.0.0/16 scram-sha-256\n','')==before
    with pytest.raises(ValueError):m.b2.scene_hba(after)
    with pytest.raises(ValueError):m.b2.scene_hba(before.replace('172.20.0.0/16','0.0.0.0/0'))

def test_restore_uses_new_database_and_never_replays_cluster_roles(monkeypatch,tmp_path):
    m=load('deploy-scene-write-validation.py');monkeypatch.setattr(m,'STATE',tmp_path)
    calls=[]
    class Docker:
        phase=''
        def sql(self,sql,database=None):calls.append(('sql',sql,database));return ''
        def exec(self,*args,input=None):calls.append(('exec',args,input));return ''
    monkeypatch.setattr(m,'check_snapshot',lambda d: None)
    m.restore_database(Docker())
    assert 'CREATE DATABASE village_scene_validation' in calls[0][1]
    cmd=next(c[1] for c in calls if c[0]=='exec')
    assert cmd[0]=='pg_restore' and '--single-transaction' in cmd
    assert cmd[cmd.index('-d')+1]=='village_scene_validation'
    assert all('roles.sql' not in str(c) for c in calls)
    assert all('DROP ' not in str(c) for c in calls)

def test_candidate_guard_preserves_existing_state(tmp_path,monkeypatch):
    m=load('deploy-scene-write-validation.py');monkeypatch.setattr(m,'STATE',tmp_path/'state')
    m.new_state_guard();(tmp_path/'state').mkdir()
    with pytest.raises(ValueError):m.new_state_guard()
    monkeypatch.setattr(m,'STATE',m.deploy.ROOT/'candidate')
    with pytest.raises(ValueError):m.new_state_guard()

def test_image_transfer_checksum_is_checked_before_docker_load(tmp_path,monkeypatch):
    m=load('deploy-scene-write-validation.py');artifact=tmp_path/'village-business-api-stage-c1-scene-amd64.tar.gz';artifact.write_bytes(b'bad')
    monkeypatch.setattr(m,'source_context',lambda d:{'backup':tmp_path})
    monkeypatch.setattr(m,'image_metadata',lambda:{'archive_filename':artifact.name,'archive_bytes':4,'archive_sha256':'a'*64})
    class Docker:
        def run(self,args,**kw):
            assert args[0]=='ps','Must not load unchecked archive';return ''
    with pytest.raises(ValueError):m.load_image_archive(Docker())
