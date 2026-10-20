import importlib.util,hashlib,json
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[2]
def module():
 p=ROOT/'linux/scripts/deploy-unified-business.py';assert p.exists(),'unified deployment missing'
 s=importlib.util.spec_from_file_location('deploy_unified_tests',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def test_resource_and_archive_preflight_fails_closed(tmp_path):
 m=module()
 for mem,disk in [(511*1024**2,10*1024**3),(1024**3,4*1024**3-1)]:
  with pytest.raises(ValueError):m.validate_resources(mem,disk)
 m.validate_resources(512*1024**2,4*1024**3)
 p=tmp_path/'image.tar.gz';p.write_bytes(b'verified');meta={'archive_filename':p.name,'archive_bytes':8,'archive_sha256':hashlib.sha256(b'verified').hexdigest()}
 assert m.verify_archive(p,meta)==p
 p.write_bytes(b'corrupted')
 with pytest.raises(ValueError):m.verify_archive(p,meta)
def test_hba_only_adds_exact_database_login_before_reject_and_rejects_drift():
 m=module();before='local all all trust\nhost village_copy village_api_login 172.22.0.0/16 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'
 after=m.add_hba(before,'172.22.0.0/16');assert after.count('village_unified_candidate village_unified_login')==1;assert after.endswith('host all all ::/0 reject\n')
 for text in [before.replace('scram-sha-256','trust'),before.replace('172.22.0.0','0.0.0.0'),before+'host all all 0.0.0.0/0 trust\n']:
  with pytest.raises(ValueError):m.add_hba(text,'172.22.0.0/16')
 assert m.add_hba(after,'172.22.0.0/16')==after
def test_compose_shares_existing_pg_without_restarting_it_and_keeps_preview_private(tmp_path):
 m=module();meta=json.loads((ROOT/'linux/unified-release.json').read_text());spec=m.compose_document(tmp_path,meta,uid=1000,gid=1000,key='sb_publishable_synthetic')
 assert set(spec['services'])=={'api','preview'};api=spec['services']['api'];preview=spec['services']['preview']
 assert api['ports']==['127.0.0.1:18084:8080'];assert preview['ports']==['127.0.0.1:18085:8080'];assert api['mem_limit']=='256m';assert api['environment']['BRIDGE_ENABLED']=='false';assert api['environment']['PGDATABASE']=='village_unified_candidate'
 assert not any('PGPASSWORD=' in str(x) for x in api['environment']);assert spec['networks']['dbnet']['external'] is True
def test_schema_order_installs_every_and_only_packaged_schema():
 m=module();assert set(m.SCHEMAS)=={path.stem for path in (ROOT/'linux/sql/unified').glob('*.sql')};assert m.SCHEMAS.index('identity')==0;assert m.SCHEMAS.index('catalog')<m.SCHEMAS.index('files')
def test_container_drift_in_command_network_privileges_or_mount_types_is_rejected():
 # A claimed image/label alone must not authorize operating on an unrelated container.
 import copy
 m=module();meta=json.loads((ROOT/'linux/unified-release.json').read_text());spec=m.compose_document(Path.home()/'unified-test',meta,uid=1000,gid=1000,key='sb_publishable_synthetic')['services']['api'];base={'Env':[],'Cmd':['node','unified/main.mjs'],'Entrypoint':None,'WorkingDir':'/opt/village/business-api'}
 info={'Id':'known','Image':'sha256:verified','Config':{**base,'Image':spec['image'],'User':spec['user'],'Env':[key+'='+value for key,value in spec['environment'].items()],'Labels':{'com.docker.compose.project':m.PROJECT,'com.docker.compose.service':'api'}},'HostConfig':{'Privileged':False,'ReadonlyRootfs':True,'CapAdd':None,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges:true'],'Memory':256*1024**2,'MemorySwap':256*1024**2,'NanoCpus':750000000,'PidsLimit':64,'PidMode':'','IpcMode':'private','PortBindings':{'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18084'}]}},'Mounts':[{'Type':'bind','Destination':row['target'],'Source':row['source'],'RW':not row['read_only']} for row in spec['volumes']],'NetworkSettings':{'Networks':{'village-api-validation_'+name:{} for name in spec['networks']}}}
 class Fake:
  def run(self,args):return json.dumps([{'Config':base}] if args[:2]==['image','inspect'] else [self.info])
 fake=Fake();fake.info=info;assert m.inspect_container(fake,m.API,spec,'sha256:verified')['Id']=='known'
 for target,key,value in [('Config','Cmd',['sh']),('Config','Entrypoint',['sh']),('Config','WorkingDir','/'),('HostConfig','PidMode','host'),('HostConfig','IpcMode','host'),('HostConfig','PidsLimit',1000),('HostConfig','NanoCpus',0)]:
  fake.info=copy.deepcopy(info);fake.info[target][key]=value
  with pytest.raises(ValueError):m.inspect_container(fake,m.API,spec,'sha256:verified')
 fake.info=copy.deepcopy(info);fake.info['Mounts'][0]['Type']='volume'
 with pytest.raises(ValueError):m.inspect_container(fake,m.API,spec,'sha256:verified')
