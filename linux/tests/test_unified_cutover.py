from pathlib import Path
import importlib.util,copy,datetime as dt
import pytest
ROOT=Path(__file__).resolve().parents[2]
def module():
 p=ROOT/'linux/scripts/prepare-unified-cutover.py';assert p.is_file(),'cutover gates missing'
 s=importlib.util.spec_from_file_location('unified_cutover_test',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def test_old_future_or_unverified_snapshot_cannot_authorize_activation():
 m=module();now=dt.datetime(2026,10,20,12,tzinfo=dt.timezone.utc)
 for value in ['2026-10-15T03:45:26Z','2026-10-21T03:45:26Z','invalid']:
  with pytest.raises(ValueError):m.validate_snapshot({'status':'archive_verified_not_restored','started_at_utc':value,'completed_at_utc':value},now=now)
 assert m.validate_snapshot({'status':'archive_verified_not_restored','started_at_utc':'2026-10-20T03:45:26Z','completed_at_utc':'2026-10-20T03:46:26Z'},now=now)
def test_public_auth_never_uses_http_ip_foreign_origin_or_redirect():
 m=module()
 for origin in ['http://8.148.248.237','https://8.148.248.237','https://localhost','https://example.com/path','https://user:pass@example.com','https://example.com:444']:
  with pytest.raises(ValueError):m.https_origin(origin)
 assert m.https_origin('https://village.example.com')=='https://village.example.com'
def test_source_file_change_or_missing_metadata_blocks_consistency_proof():
 m=module();objects=[{'id':'one','declared_size':4,'snapshot_etag':'"v1"'}];records={'one':{'status':'copied','received_bytes':4,'source_etag':'"v1"','sha256':'a'*64}}
 assert m.verify_source_files(objects,records,lambda _:{'size':4,'etag':'"v1"'})=={'objects':1,'bytes':4}
 for head in [{'size':4,'etag':'"v2"'},{'size':5,'etag':'"v1"'},{}]:
  with pytest.raises(ValueError):m.verify_source_files(objects,records,lambda _:head)
 records['one']['status']='source_changed'
 with pytest.raises(ValueError):m.verify_source_files(objects,records,lambda _:{'size':4,'etag':'"v1"'})
def test_independent_site_additions_are_preserved_and_conflicts_are_reported_without_rows():
 m=module();base={'same':'a','stable':'s'};source={'same':'source-change','stable':'s','source-only':'new'};local={'same':'local-change','stable':'s','local-only':'new'};saved=copy.deepcopy((base,source,local))
 report=m.difference_report(base,source,local);assert report['conflicts']==['same'];assert report['source_only_changes']==['source-only'];assert report['local_only_changes']==['local-only'];assert report['automatic_merge'] is False;assert (base,source,local)==saved;assert 'source-change' not in str(report)
def test_existing_application_writes_never_allow_reinitialization():
 m=module()
 for report in [{'activated_at':1},{'business_writes':1},{'business_writes':0,'initialized':True}]:
  with pytest.raises(ValueError,match='REINITIALIZATION_FORBIDDEN'):m.require_new_initialization(report)
 assert m.require_new_initialization({}) is True
def test_source_package_has_no_broad_database_access_or_source_site_write_revocation(tmp_path):
 m=module();meta={'instanceId':'aliyun-test','releaseId':'unified-test','git_sha':'a'*40};result=m.source_package(tmp_path/'source-private',meta)
 assert (result/'bridge-token').is_file();sql=(result/'source-install.sql').read_text();env=(result/'source.env').read_text()
 assert 'village_aliyun_transport' in sql;assert 'NOINHERIT NOSUPERUSER NOBYPASSRLS' in sql;assert 'GRANT village_aliyun_bridge TO village_aliyun_transport' in sql;assert 'GRANT authenticated TO village_aliyun_transport' not in sql;assert 'SUPABASE_SECRET' not in env;assert 'ALIYUN_BRIDGE_TOKEN=' in env
 assert (ROOT/'deployment-config.js').read_text().find("mode: 'source'")>=0
def test_failed_tls_never_stops_current_site_and_success_still_requires_real_browser(tmp_path,monkeypatch):
 import json,os,sys
 m=module();state=tmp_path/'state';state.mkdir(mode=0o700);cert=tmp_path/'cert.pem';key=tmp_path/'key.pem'
 for path in [cert,key]:path.write_text('synthetic');path.chmod(0o600)
 meta={'releaseId':'unified-test','instanceId':'aliyun-test'};commands=[]
 class Docker:
  def run(self,args):commands.append(args);return ''
 monkeypatch.setattr(m.deploy,'Docker',lambda _:Docker());monkeypatch.setattr(m.deploy,'read_meta',lambda:meta);monkeypatch.setattr(m,'cutover_checks',lambda *_args,**_kwargs:{'releaseId':meta['releaseId']});monkeypatch.setattr(m,'public_compose',lambda *_args,**kwargs:{'public':kwargs.get('public',False)});monkeypatch.setattr(m.deploy,'enable_bridge',lambda *_:commands.append(['enable-private-bridge']));monkeypatch.setattr(m.deploy,'runtime_receipt',lambda *_:{'known':'api'});monkeypatch.setattr(m.socket,'getaddrinfo',lambda *_args,**_kwargs:[(2,1,6,'',('8.148.248.237',443))])
 def bad_tls(*_):raise ValueError('TLS_HOSTNAME_OR_CHAIN_FAILED')
 monkeypatch.setattr(m,'tls_probe',bad_tls)
 with pytest.raises(ValueError,match='TLS_HOSTNAME_OR_CHAIN_FAILED'):m.apply_activation(state,'https://village.example.com',cert,key,files_key='synthetic')
 assert not any('stop' in args for args in commands);assert not (state/'activation.json').exists()
 monkeypatch.setattr(m,'tls_probe',lambda *_:{'verified':True});commands.clear();result=m.apply_activation(state,'https://village.example.com',cert,key,files_key='synthetic')
 assert commands.index(['enable-private-bridge'])<commands.index(['stop','village-web-web-1']);assert result['formal_complete'] is False;assert 'pending_real_browser_and_gpu' in result['status'];assert json.loads((state/'activation.json').read_text())['initialized'] is True
def test_worker_mapping_accepts_explicit_identity_only_and_never_guesses_a_display_name():
 m=module();mapping={'b0000000-0000-4000-8000-000000000001':'existing-worker-village'};assert m.validate_worker_mapping(mapping)==mapping
 for value in [{},{'Changcun':'village'},{next(iter(mapping)):'bad;drop table'}]:
  with pytest.raises(ValueError):m.validate_worker_mapping(value)
def test_one_private_handoff_bundle_contains_only_image_snapshot_and_bridge_token(tmp_path):
 import json,hashlib,tarfile
 m=module();image=tmp_path/'image.tar.gz';image.write_bytes(b'image');backup=tmp_path/'backup';backup.mkdir();token=tmp_path/'token';token.write_text('a'*48+'\n');meta={'archive_filename':image.name,'archive_bytes':5,'archive_sha256':hashlib.sha256(b'image').hexdigest(),'releaseId':'unified-test'}
 for name in ['database.dump','roles.sql','inventory.json','contents.txt','manifest.json']:(backup/name).write_text('synthetic')
 output=tmp_path/'handoff.tar.gz';m.build_handoff(image,backup,token,output,meta)
 with tarfile.open(output) as archive:
  names=set(archive.getnames());assert names=={'handoff.json','image.tar.gz','bridge-token',*('backup/'+name for name in ['database.dump','roles.sql','inventory.json','contents.txt','manifest.json'])};assert not any('.env' in name or 'source-install.sql' in name for name in names)
 with pytest.raises(ValueError):m.build_handoff(image,backup,token,output,meta)
