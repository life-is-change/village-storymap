import importlib.util,json
from pathlib import Path
import pytest
S=Path(__file__).resolve().parents[1]/'scripts'
def load(file):
 p=S/file
 if not p.is_file():return None
 spec=importlib.util.spec_from_file_location(file.replace('-','_'),p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def test_scene_files_image_excludes_new_runtime_from_old_tags(tmp_path):
 m=load('build-business-api-image.py');root=tmp_path/'api';(root/'src').mkdir(parents=True);(root/'scene').mkdir();(root/'scene-files').mkdir()
 for n in ['package.json','package-lock.json','src/main.mjs','scene/main.mjs','scene-files/main.mjs']:(root/n).write_text('{}')
 old=m.code_digest(root,include_scene=True);new=m.code_digest(root,include_scene=True,include_scene_files=True)
 (root/'scene-files/main.mjs').write_text('changed');assert m.code_digest(root,include_scene=True)==old;assert m.code_digest(root,include_scene=True,include_scene_files=True)!=new
 assert m.metadata_filename('village-business-api:stage-c2a-scene-files')=='scene-files-image.json'

def test_scene_files_compose_only_owns_its_private_writable_files(tmp_path):
 m=load('deploy-scene-files-validation.py');assert m is not None
 doc=m.compose_document(tmp_path,uid=1000,gid=1000,key='sb_publishable_test');api=doc['services']['api']
 assert api['ports']==['127.0.0.1:18083:8080'];assert api['mem_limit']=='256m';assert api['environment']['PGDATABASE']=='village_scene_files_validation';assert api['environment']['PGUSER']=='village_scene_files_login'
 writable=[v for v in api['volumes'] if not v.get('read_only',False)];assert len(writable)==1 and writable[0]['source']==str(tmp_path/'files') and writable[0]['target']=='/srv/scene-files'
 assert api['read_only'];assert not any(v['target']=='/var/run/docker.sock' for v in api['volumes'])

def test_scene_files_preflight_refuses_low_resources():
 m=load('deploy-scene-files-validation.py');assert m is not None
 m.validate_resources(512*1024**2,2*1024**3)
 for ram,disk in [(511*1024**2,4*1024**3),(1024**3,2*1024**3-1)]:
  with pytest.raises(ValueError):m.validate_resources(ram,disk)

def test_scene_files_guard_protects_all_previous_state(tmp_path,monkeypatch):
 m=load('deploy-scene-files-validation.py');assert m is not None
 monkeypatch.setattr(m,'STATE',tmp_path/'new');m.new_state_guard();(tmp_path/'new').mkdir()
 with pytest.raises(ValueError):m.new_state_guard()
 monkeypatch.setattr(m,'STATE',m.c1.STATE/'nested')
 with pytest.raises(ValueError):m.new_state_guard()

def test_scene_files_hba_adds_only_exact_new_database_role_and_preserves_old_rules():
 m=load('deploy-storage-read-validation.py');before='local all all trust\nhost village_copy village_api_login 172.20.0.0/16 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'
 existing=m.scene_hba(m.storage_hba(before));new=m.scene_files_hba(existing);assert new.replace('host village_scene_files_validation village_scene_files_login 172.20.0.0/16 scram-sha-256\n','')==existing
 with pytest.raises(ValueError):m.scene_files_hba(existing.replace('172.20.0.0/16','0.0.0.0/0'))

def test_scene_files_transfer_checks_bytes_before_loading(tmp_path,monkeypatch):
 m=load('deploy-scene-files-validation.py');p=tmp_path/'api.tar.gz';p.write_bytes(b'bad')
 monkeypatch.setattr(m,'source_context',lambda d:{'backup':tmp_path});monkeypatch.setattr(m,'image_metadata',lambda:{'archive_filename':p.name,'archive_bytes':4,'archive_sha256':'a'*64})
 class Docker:
  def run(self,args,**kw):assert args[0]=='ps';return ''
 with pytest.raises(ValueError):m.load_image_archive(Docker())

def test_scene_files_restore_never_replays_roles_or_replaces_old_database(monkeypatch):
 m=load('deploy-scene-files-validation.py');calls=[]
 class Docker:
  def sql(self,sql,database=None):calls.append(('sql',sql,database));return ''
  def exec(self,*args,**kw):calls.append(('exec',args));return ''
 monkeypatch.setattr(m.copy,'read_private_json',lambda p:{'tables':[]});monkeypatch.setattr(m.deploy.rd,'actual_snapshot',lambda *a:{});monkeypatch.setattr(m.deploy.rd,'compare_snapshot',lambda *a:None)
 m.restore_database(Docker());assert 'CREATE DATABASE village_scene_files_validation' in calls[0][1]
 cmd=calls[1][1];assert cmd[0]=='pg_restore' and '--single-transaction' in cmd and cmd[cmd.index('-d')+1]==m.DATABASE
 assert not any('roles.sql' in str(c) or 'DROP ' in str(c) for c in calls)

@pytest.mark.parametrize('bad',['none','memory','swap','write','path','port','env'])
def test_scene_files_runtime_security_drift(tmp_path,monkeypatch,bad):
 m=load('deploy-scene-files-validation.py');monkeypatch.setattr(m.os,'geteuid',lambda:1000,raising=False)
 spec=m.compose_document(tmp_path,uid=1000,gid=1000,key='public')['services']['api'];config={'Cmd':['node','scene-files/main.mjs'],'Entrypoint':None,'WorkingDir':'/app','Env':[]}
 info={'Image':'sha256:known','Config':{'Image':m.IMAGE,'User':'1000:1000',**config,'Labels':{'com.docker.compose.project':m.PROJECT,'com.docker.compose.service':'api'},'Env':[k+'='+v for k,v in spec['environment'].items()]},
 'HostConfig':{'ReadonlyRootfs':True,'Privileged':False,'CapAdd':None,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges:true'],'Memory':256*1024**2,'MemorySwap':256*1024**2,'NanoCpus':500000000,'PidsLimit':64,'PortBindings':{'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18083'}]}},
 'Mounts':[{'Type':'bind','Destination':v['target'],'Source':v['source'],'RW':not v.get('read_only',False)} for v in spec['volumes']],
 'NetworkSettings':{'Networks':{'village-api-validation_dbnet':{},'village-api-validation_authegress':{}}}}
 if bad=='memory':info['HostConfig']['Memory']=0
 if bad=='swap':info['HostConfig']['MemorySwap']=0
 if bad=='write':info['Mounts'][0]['RW']=True
 if bad=='path':info['Mounts'][-1]['Source']=str(tmp_path/'other')
 if bad=='port':info['HostConfig']['PortBindings']['8080/tcp'][0]['HostIp']='0.0.0.0'
 if bad=='env':info['Config']['Env'].append('SUPABASE_SERVICE_ROLE_KEY=bad')
 if bad=='none':m.validate_container(info,spec,{'Id':'sha256:known','Config':config})
 else:
  with pytest.raises(ValueError):m.validate_container(info,spec,{'Id':'sha256:known','Config':config})
