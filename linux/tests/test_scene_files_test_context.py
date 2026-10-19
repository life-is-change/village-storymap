"""Approved append-only candidate fixture; no source permission/RPC changes."""
import importlib.util
from pathlib import Path
import pytest
P=Path(__file__).resolve().parents[1]/'scripts/prepare-scene-files-test-context.py'

def load():
 assert P.is_file(),'C2a test context helper is missing'
 s=importlib.util.spec_from_file_location('c2a_fixture',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def test_scene_files_fixture_check_is_read_only_and_candidate_scoped():
 m=load();sql=m.context_sql(create=False)
 assert 'BEGIN READ ONLY;' in sql and 'village_scene_files_validation' in sql
 assert "student_id='25213040'" in sql and "student_id='332'" in sql
 assert 'INSERT INTO' not in sql and 'GRANT ' not in sql and 'UPDATE ' not in sql and 'DELETE ' not in sql

def test_scene_files_fixture_create_is_atomic_append_only_and_explicit():
 m=load();sql=m.context_sql(create=True)
 for table in ['courses','villages','teaching_projects','course_groups','planning_spaces','group_memberships']:assert 'INSERT INTO public.'+table in sql
 assert '\nBEGIN;' in sql and sql.rstrip().endswith('COMMIT;')
 assert 'UPDATE ' not in sql and 'DELETE ' not in sql and 'GRANT ' not in sql and 'CREATE ROLE' not in sql
 assert "C2A_TEST_CONTEXT_COLLISION" in sql and 'pg_advisory_xact_lock' in sql

def test_scene_files_fixture_requires_real_member_and_does_not_redeploy(monkeypatch,tmp_path):
 m=load();calls=[];monkeypatch.setattr(m.deploy,'STATE',tmp_path)
 monkeypatch.setattr(m.deploy,'validate_runtime',lambda d: calls.append('validate'))
 class Docker:
  phase=''
  def sql(self,s,database=None):calls.append(database);assert database==m.deploy.DATABASE;return '{"status":"empty","course_id":"c2a-test-20261019"}'
 value=m.prepare(Docker(),create=False);assert value['status']=='empty';assert calls==['validate',m.deploy.DATABASE]
 assert list(tmp_path.iterdir())==[]

def test_scene_files_fixture_never_accepts_arbitrary_mode():
 m=load()
 with pytest.raises(ValueError):m.context_sql(create='true')

def test_scene_files_fixture_cli_uses_existing_database_container(monkeypatch):
 m=load();seen=[];monkeypatch.setattr(m.sys,'platform','linux');monkeypatch.setattr(m.os,'geteuid',lambda:1000,raising=False);monkeypatch.setattr(m.sys,'argv',['prepare','--check'])
 monkeypatch.setattr(m.deploy.deploy.rd,'LocalDocker',lambda state,*,target: seen.append(target) or object())
 monkeypatch.setattr(m,'prepare',lambda d,*,create: {'status':'empty','course_id':m.COURSE})
 assert m.main()==0;assert seen==[m.deploy.deploy.TARGET]

def test_scene_files_fixture_creation_archives_old_proofs_and_keeps_private_receipt(monkeypatch,tmp_path):
 m=load();monkeypatch.setattr(m.deploy,'STATE',tmp_path);monkeypatch.setattr(m.deploy,'validate_runtime',lambda d:None)
 for name in ['verification.json','acceptance.json']:(tmp_path/name).write_text('{}')
 calls=[]
 class Docker:
  phase=''
  def sql(self,s,database=None):calls.append(s);return '{"status":"ready","course_id":"c2a-test-20261019","test_memberships":1}'
 assert m.prepare(Docker(),create=True)['status']=='ready'
 assert len(calls)==3 and not (tmp_path/'verification.json').exists() and not (tmp_path/'acceptance.json').exists()
 assert len(list(tmp_path.glob('*.before-test-context-*')))==2 and (tmp_path/'test-context.json').is_file()
