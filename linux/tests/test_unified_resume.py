from test_unified_deployment import module
import pytest
def test_resumable_steps_do_not_repeat_committed_restore_or_reset_partial_target(tmp_path):
 m=module();state={'binding':'source-one','steps':{}};calls=[];saved=[]
 def apply():calls.append('restore');return {'database_oid':12}
 def check(receipt):return receipt=={'database_oid':12}
 engine=m.ResumeEngine(state,lambda value:saved.append(str(value)))
 engine.step('restore',apply,check);engine.step('restore',apply,check);assert calls==['restore']
 with pytest.raises(ValueError):engine.step('restore',apply,lambda _:False)
 assert calls==['restore'];assert state['steps']['restore']['status']=='done'
 def failed():calls.append('partial');raise RuntimeError('retain data')
 with pytest.raises(RuntimeError):engine.step('schema',failed,lambda _:False)
 assert state['steps']['schema']['status']=='pending'
 with pytest.raises(ValueError):engine.step('schema',failed,lambda _:False)
 assert calls.count('partial')==1
def test_pending_completed_action_can_be_recovered_only_with_exact_external_proof():
 m=module();state={'steps':{'restore':{'status':'pending'}}};engine=m.ResumeEngine(state,lambda _:None)
 result=engine.step('restore',lambda:pytest.fail('must not restore again'),lambda r:r=={'database_oid':12},recover=lambda:{'database_oid':12})
 assert result=={'database_oid':12};assert state['steps']['restore']['status']=='done'

def test_complete_candidate_command_is_idempotent_and_never_restarts_existing_services(tmp_path,monkeypatch):
 import json,hashlib
 m=module();archive=tmp_path/'release.tar.gz';archive.write_bytes(b'verified');backup=tmp_path/'backup';backup.mkdir();(backup/'database.dump').write_bytes(b'archive');state=tmp_path/'candidate';meta={'releaseId':'unified-test','instanceId':'aliyun-test','image':'village-unified:123456789abc','code_sha256':'c'*64,'schema_sha256':'s'*64,'static_sha256':'w'*64,'archive_filename':archive.name,'archive_bytes':8,'archive_sha256':hashlib.sha256(b'verified').hexdigest()}
 hba='local all all trust\nhost village_copy village_api_login 172.22.0.0/16 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'
 class Fake:
  def __init__(self):self.commands=[];self.sqls=[];self.hba=hba;self.exists=False;self.restores=0
  def run(self,args,**kwargs):
   self.commands.append(args)
   if args[:3]==['ps','-a','--format']:return ''
   if args[0]=='cp' and 'village-schema' in args[1]:
    from pathlib import Path
    for name in m.SCHEMAS:(Path(args[2])/(name+'.sql')).write_text((m.ROOT/'linux/sql/unified'/(name+'.sql')).read_text(encoding='utf-8'),encoding='utf-8')
   return ''
  def sql(self,sql,database=m.DATABASE):
   self.sqls.append((sql,database))
   if sql.startswith('CREATE DATABASE'):self.exists=True
   if sql.startswith('SELECT oid::text'):return '12' if self.exists else ''
   if 'pg_roles' in sql:return ''
   if 'pg_reload_conf' in sql:return 't'
   if 'pg_hba_file_rules' in sql:return '0'
   return ''
  def exec(self,*args,input=None):
   if args[0]=='cat':return self.hba
   if args[0]=='sh':self.hba=input
   return ''
  def archive_tool(self,*args,**kwargs):self.restores+=1
 fake=Fake();manifest={'files':{'database.dump':{'sha256':'a'*64}}}
 monkeypatch.setattr(m,'read_meta',lambda:meta);monkeypatch.setattr(m.rd,'verify_backup',lambda _:manifest);monkeypatch.setattr(m,'baseline',lambda _: {'hba_before':hba,'subnet':'172.22.0.0/16'});monkeypatch.setattr(m,'unchanged_baseline',lambda *_:None);monkeypatch.setattr(m,'resource_snapshot_preflight',lambda:{'available_bytes':1024**3,'disk_free_bytes':8*1024**3});monkeypatch.setattr(m,'image_identity',lambda *_:'known');monkeypatch.setattr(m,'tree_digest',lambda path:meta['static_sha256' if path.name=='web' else 'schema_sha256']);monkeypatch.setattr(m,'created_database_receipt',lambda *_:{'oid':'12'});monkeypatch.setattr(m,'verify_restored_archive',lambda *_:{'oid':'12','archive_sha256':'a'*64});monkeypatch.setattr(m,'schema_receipt',lambda *_:{'version':1});monkeypatch.setattr(m,'copy_storage',lambda *_:{'objects':23});monkeypatch.setattr(m,'verify_storage',lambda *_:{'objects':23});monkeypatch.setattr(m,'runtime_receipt',lambda *_:{'api':'known'});monkeypatch.setattr(m,'wait_ready',lambda *_:None);monkeypatch.setattr(m.os,'geteuid',lambda:1000,raising=False);monkeypatch.setattr(m.os,'getegid',lambda:1000,raising=False)
 assert m.deploy_candidate(archive,backup,state,check=True,docker=fake)['status']=='preflight_ok';assert not state.exists();assert not fake.commands or all(command[0]=='ps' for command in fake.commands)
 assert m.deploy_candidate(archive,backup,state,docker=fake)['status']=='internal_deployed_not_accepted'
 first_commands=list(fake.commands);assert fake.restores==1;assert sum(sql.startswith('CREATE DATABASE') for sql,_ in fake.sqls)==1
 # All actual schema SQL is sent inside the same BEGIN/COMMIT, never piecemeal.
 installs=[sql for sql,_ in fake.sqls if sql.startswith('BEGIN;')];assert len(installs)==1;assert installs[0].endswith('COMMIT;')
 assert not any('restart' in command or 'stop' in command or 'down' in command for command in first_commands)
 assert json.loads((state/'deployment.json').read_text())['steps']['restore']['status']=='done'
 m.deploy_candidate(archive,backup,state,resume=True,docker=fake)
 assert fake.restores==1;assert sum(sql.startswith('CREATE DATABASE') for sql,_ in fake.sqls)==1;assert fake.commands==first_commands
