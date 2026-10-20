import importlib.util
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[2]
def module():
 p=ROOT/'linux/scripts/build-unified-release.py'
 assert p.is_file(),'unified builder missing'
 spec=importlib.util.spec_from_file_location('unified_release',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def test_scene_adapter_uses_the_existing_audited_body_and_only_one_login():
 m=module();sql=m.scene_sql(ROOT)
 assert 'village_scene_files_login' not in sql
 assert 'CREATE ROLE' not in sql
 assert "current_database()<>'village_unified_candidate'" in sql
 assert 'CREATE SCHEMA scene_files;' in sql
 assert 'TO village_unified_login' in sql
 assert (ROOT/'linux/sql/unified/scene.sql').read_text(encoding='utf-8')==sql
def test_stage_release_changes_artifact_configuration_only_and_excludes_private_files(tmp_path):
 m=module();source=tmp_path/'repo';(source/'homepage/dist').mkdir(parents=True);(source/'features').mkdir()
 for name in ['index.html','homepage/dist/index.html']:(source/name).write_text('<html></html>')
 (source/'deployment-config.js').write_text('SOURCE_CONFIGURATION')
 (source/'features/client.js').write_text('browser');(source/'features/client.test.js').write_text('private test')
 (source/'business-api').mkdir();(source/'business-api/.env').write_text('SECRET')
 output=tmp_path/'public';m.stage_release(source,output,instance_id='aliyun-test',release_id='release-test')
 assert (source/'deployment-config.js').read_text()=='SOURCE_CONFIGURATION'
 assert 'aliyun-test' in (output/'deployment-config.js').read_text()
 assert not (output/'business-api').exists();assert not (output/'features/client.test.js').exists()
 with pytest.raises(ValueError):m.stage_release(source,output,instance_id='aliyun-test',release_id='release-test')
def test_build_refuses_existing_output_before_touching_base(tmp_path):
 m=module();out=tmp_path/'image.tar.gz';out.write_bytes(b'keep')
 with pytest.raises(ValueError):m.build_release(ROOT,tmp_path/'absent.tar',out)
 assert out.read_bytes()==b'keep'

def test_ci_attestation_requires_matching_successful_native_and_platform_commit():
 m=module();commit='a'*40
 runs={1:{'head_sha':commit,'conclusion':'success','status':'completed','name':'Unified native database tests','repository':{'full_name':'life-is-change/village-storymap'}},2:{'head_sha':commit,'conclusion':'success','status':'completed','name':'Platform regression','repository':{'full_name':'life-is-change/village-storymap'}}}
 assert m.verified_ci(commit,1,2,fetch_run=runs.__getitem__)['native_run_id']==1
 runs[1]['head_sha']='b'*40
 with pytest.raises(ValueError):m.verified_ci(commit,1,2,fetch_run=runs.__getitem__)
 runs[1]['head_sha']=commit;runs[2]['conclusion']='failure'
 with pytest.raises(ValueError):m.verified_ci(commit,1,2,fetch_run=runs.__getitem__)
def test_image_layout_preserves_first_party_module_resolution_and_excludes_private_state(tmp_path,monkeypatch):
 import gzip,io,json,tarfile,hashlib
 m=module();root=tmp_path/'repo';files={'index.html':'root','homepage/dist/index.html':'home','deployment-config.js':'SOURCE','business-api/package.json':'{"type":"module"}','business-api/package-lock.json':'{}','business-api/unified/main.mjs':'entry','business-api/node_modules/pg/package.json':'{}','business-api/.env':'SECRET','business-api/node_modules/pg/dist/parser.test.js':'test code','features/mc/mc-bridge.js':'math','features/admin/village-package.js':'package','linux/sql/unified/identity.sql':'schema','linux/sql/scene-files-candidate.sql':(ROOT/'linux/sql/scene-files-candidate.sql').read_text(encoding='utf-8'),'supabase_SQL/Scene Edit Studio.sql':(ROOT/'supabase_SQL/Scene Edit Studio.sql').read_text(encoding='utf-8')}
 for name,text in files.items():p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
 monkeypatch.setattr(m.subprocess,'check_output',lambda args,**kw:'a'*40 if args[1]=='rev-parse' else '')
 monkeypatch.setattr(m.image_builder,'validate_base',lambda _:({'os':'linux','architecture':'amd64','rootfs':{'diff_ids':[]},'config':{}},[]))
 out=tmp_path/'release.tar.gz';meta=m.build_release(root,tmp_path/'base',out)
 assert meta['runtime_execution']=='pending_linux_container_smoke_test'
 assert meta['archive_sha256']==hashlib.sha256(out.read_bytes()).hexdigest()
 with tarfile.open(out) as t:
  manifest=json.load(t.extractfile('manifest.json'))[0];config=json.load(t.extractfile(manifest['Config']));assert config['config']['WorkingDir']=='/opt/village/business-api';assert config['config']['Cmd']==['node','unified/main.mjs']
  with tarfile.open(fileobj=io.BytesIO(gzip.decompress(t.extractfile(manifest['Layers'][-1]).read()))) as layer:
   names=layer.getnames();assert 'opt/village/features/mc/mc-bridge.js' in names;assert 'opt/village-web/deployment-config.js' in names;assert not any('.env' in n or 'backups' in n or '.test.' in n for n in names)
 assert (root/'deployment-config.js').read_text()=='SOURCE'
