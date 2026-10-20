#!/usr/bin/env python3
"""Private, resumable unified candidate. Never changes the public/source website."""
import argparse,contextlib,datetime as dt,hashlib,importlib.util,ipaddress,json,os,re,secrets,shutil,socket,subprocess,sys,time,urllib.request
from pathlib import Path
S=Path(__file__).resolve().parent;ROOT=S.parents[1]
DATABASE='village_unified_candidate';ROLE='village_unified_login';API='village-unified-api';PREVIEW='village-unified-preview';STATE=Path.home()/'village-unified-deploy'
PG='village-api-validation-postgres';NGINX='village-web-nginx:ubuntu24-local';PROJECT='village-unified'
SCHEMAS=('identity','catalog','survey','planning','events','files','scene','tasks')
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,S/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
storage=load('unified_storage_copy','business_storage_copy.py');rd=load('unified_restore','restore-db-copy.py')
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def validate_resources(available,disk):
 if available<512*1024**2:raise ValueError('MEMORY_RESOURCE_LOW')
 if disk<4*1024**3:raise ValueError('DISK_RESOURCE_LOW')
def verify_archive(path,meta):
 path=storage.no_links(path)
 if path.name!=meta['archive_filename'] or not path.is_file() or path.stat().st_nlink!=1 or path.stat().st_size!=meta['archive_bytes'] or rd.checksum(path)!=meta['archive_sha256']:raise ValueError('ARCHIVE_CHECKSUM_DIFFERS')
 return path
def add_hba(before,subnet):
 network=ipaddress.ip_network(subnet,strict=True)
 if not network.is_private or network.version!=4:raise ValueError('UNKNOWN_DB_NETWORK')
 lines=before.splitlines();pair='host '+DATABASE+' '+ROLE+' '+subnet+' scram-sha-256'
 if not lines or lines[0]!='local all all trust' or lines[-2:]!=['host all all 0.0.0.0/0 reject','host all all ::/0 reject']:raise ValueError('UNKNOWN_HBA')
 pairs={('village_copy','village_api_login'),('village_copy','village_storage_read_login'),('village_scene_validation','village_scene_login'),('village_scene_files_validation','village_scene_files_login'),(DATABASE,ROLE)}
 seen=set()
 for line in lines[1:-2]:
  match=re.fullmatch(r'host (\w+) (\w+) '+re.escape(subnet)+r' scram-sha-256',line)
  if not match or match.groups() not in pairs or match.groups() in seen:raise ValueError('UNKNOWN_HBA')
  seen.add(match.groups())
 if ('village_copy','village_api_login') not in seen:raise ValueError('UNKNOWN_HBA')
 if pair in lines:return before
 return '\n'.join([*lines[:-2],pair,*lines[-2:]])+'\n'
def validate_worker_readiness(proof,instance,*,now=None):
 now=time.time() if now is None else now
 if proof.get('bridge_protocol')!=1 or proof.get('instanceId')!=instance:raise ValueError('WORKER_COMPATIBILITY_REQUIRED')
 for kind,version in [('geoprocessing','geo-aliyun-bridge-v1'),('facade','facade-aliyun-bridge-v1')]:
  value=proof.get('workers',{}).get(kind,{})
  if value.get('version')!=version or type(value.get('seen_at')) not in (float,int) or not 0<=now-value['seen_at']<120:raise ValueError('WORKER_COMPATIBILITY_REQUIRED')
 return True
class ResumeEngine:
 def __init__(self,state,persist):self.state=state;self.persist=persist
 def step(self,name,apply,check,*,recover=None):
  steps=self.state.setdefault('steps',{});old=steps.get(name)
  if old:
   if old.get('status')=='done':
    if not check(old['receipt']):raise ValueError('COMPLETED_STEP_CHANGED')
    return old['receipt']
   if old.get('status')!='pending' or recover is None:raise ValueError('PARTIAL_STEP_REQUIRES_INSPECTION')
   receipt=recover()
   if not check(receipt):raise ValueError('PARTIAL_STEP_NOT_PROVEN')
  else:
   steps[name]={'status':'pending'};self.persist(self.state);receipt=apply()
   if not check(receipt):raise ValueError('STEP_CHECK_FAILED')
  steps[name]={'status':'done','receipt':receipt};self.persist(self.state);return receipt
def compose_document(state,meta,*,uid,gid,key):
 state=Path(state)
 if uid<=0 or gid<0 or not re.fullmatch(r'unified-[a-zA-Z0-9_-]{1,92}',meta['releaseId']):raise ValueError('INVALID_DEPLOYMENT_IDENTITY')
 def bind(source,target,ro=True):return {'type':'bind','source':str(source),'target':target,'read_only':ro,'bind':{'create_host_path':False}}
 common={'pull_policy':'never','user':f'{uid}:{gid}','read_only':True,'restart':'unless-stopped','security_opt':['no-new-privileges:true'],'cap_drop':['ALL'],'pids_limit':64,'logging':{'driver':'local','options':{'max-size':'5m','max-file':'3'}}}
 api={**common,'image':meta['image'],'container_name':API,'mem_limit':'256m','memswap_limit':'256m','cpus':0.75,'tmpfs':['/tmp:size=16m,mode=1777'],'networks':['dbnet','authegress'],'ports':['127.0.0.1:18084:8080'],
 'environment':{'NODE_ENV':'production','NODE_OPTIONS':'--max-old-space-size=128','PORT':'8080','PGHOST':PG,'PGPORT':'5432','PGDATABASE':DATABASE,'PGUSER':ROLE,'PGPASSWORD_FILE':'/run/secrets/api-password','SUPABASE_AUTH_ORIGIN':storage.ORIGIN,'SUPABASE_PUBLISHABLE_KEY':key,'UNIFIED_INSTANCE_ID':meta['instanceId'],'UNIFIED_FILES_ROOT':'/srv/ordinary','UNIFIED_SCENE_ROOT':'/srv/scene','UNIFIED_LEGACY_ROOT':'/srv/legacy','UNIFIED_LEGACY_INDEX':'/run/storage/index.json','UNIFIED_RELEASE_FILE':'/opt/village/business-api/release.json','BRIDGE_ENABLED':'false'},
 'volumes':[bind(state/'api-password','/run/secrets/api-password'),bind(state/'files','/srv/ordinary',False),bind(state/'scene-files','/srv/scene',False),bind(state/'storage/blobs','/srv/legacy'),bind(state/'storage-index.json','/run/storage/index.json')],
 'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],'interval':'5s','timeout':'3s','retries':20}}
 preview={**common,'image':NGINX,'container_name':PREVIEW,'mem_limit':'64m','memswap_limit':'64m','cpus':0.25,'tmpfs':['/tmp:size=16m,mode=1777'],'networks':['dbnet'],'ports':['127.0.0.1:18085:8080'],
 'volumes':[bind(state/'releases'/meta['releaseId']/'web','/srv/village-web'),bind(state/'nginx.conf','/etc/nginx/nginx.conf')],'depends_on':{'api':{'condition':'service_healthy'}}}
 return {'name':PROJECT,'services':{'api':api,'preview':preview},'networks':{name:{'external':True,'name':'village-api-validation_'+name} for name in ['dbnet','authegress']}}

class Docker(rd.LocalDocker):
 def __init__(self,state):super().__init__(state,target=rd.select_target('api-validation'))
 def sql(self,sql,database=DATABASE):
  return self.exec('psql','-X','-q','-w','-A','-t','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-U',rd.ADMIN,'-d',database,input=sql)
 def archive_tool(self,archive,args,*,output=None):
  # The verified custom archive is streamed; no backup mount or shared PG restart.
  command=self.prefix+['exec','-i','--user','0',PG,'pg_restore',*args]
  self.phase='archive-tool';error=self.state/('archive-error-'+secrets.token_hex(8)+'.log')
  with Path(archive).open('rb') as source,error.open('xb') as errors:
   if output:
    with Path(output).open('xb') as target:
     process=subprocess.Popen(command,stdin=source,stdout=subprocess.PIPE,stderr=errors);total=0
     try:
      while block:=process.stdout.read(1024**2):
       total+=len(block)
       if total>64*1024**2:raise ValueError('ARCHIVE_DECODE_EXCEEDS_MEMORY_BUDGET')
       target.write(block)
      if process.wait(timeout=300):raise ValueError('ARCHIVE_TOOL_FAILED')
     finally:
      if process.poll() is None:process.kill();process.wait()
      process.stdout.close()
   else:
    result=subprocess.run(command,stdin=source,stdout=subprocess.DEVNULL,stderr=errors,timeout=300)
    if result.returncode:raise ValueError('ARCHIVE_TOOL_FAILED')

def read_meta():
 meta=json.loads((ROOT/'linux/unified-release.json').read_text(encoding='utf-8'))
 if meta.get('os')!='linux' or meta.get('architecture')!='amd64' or meta.get('schemaVersion')!=1 or not re.fullmatch('aliyun-[a-zA-Z0-9_-]{1,92}',meta.get('instanceId','')) or not re.fullmatch('village-unified:[a-f0-9]{12}',meta.get('image','')):raise ValueError('UNKNOWN_RELEASE')
 return meta
def read_key():
 match=re.search(r'^const SUPABASE_PUBLISHABLE_KEY\s*=\s*"(sb_publishable_[^"\r\n]+)";', (ROOT/'app.js').read_text(encoding='utf-8'),re.M)
 if not match:raise ValueError('PUBLIC_AUTH_CONFIGURATION_MISSING')
 return match[1]
def image_identity(docker,meta):
 value=json.loads(docker.run(['image','inspect',meta['image']]))[0]
 if value.get('Id') not in meta['accepted_image_ids'] or (value.get('Os'),value.get('Architecture'))!=('linux','amd64') or value['Config'].get('Cmd')!=['node','unified/main.mjs'] or value['Config'].get('Labels',{}).get('village.api.code-sha256')!=meta['code_sha256']:raise ValueError('IMAGE_IDENTITY_DIFFERS')
 return value['Id']
def baseline(docker):
 # Reuse the last exact C2a container/HBA/mount/role validation, not a guessed server layout.
 old=load('unified_c2a_baseline','deploy-scene-files-validation.py');old.validate_runtime(docker)
 info=json.loads(docker.run(['inspect',PG]))[0];network=json.loads(docker.run(['network','inspect','village-api-validation_dbnet']))[0]
 if not network.get('Internal') or len(network['IPAM']['Config'])!=1:raise ValueError('UNKNOWN_DB_NETWORK')
 subnet=network['IPAM']['Config'][0]['Subnet'];before=docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf');add_hba(before,subnet)
 web=json.loads(docker.run(['inspect','village-web-web-1']))[0];nginx=json.loads(docker.run(['image','inspect',NGINX]))[0]
 if info['Image'] not in rd.IMAGE_IDS or web['Image']!=nginx['Id'] or info['HostConfig'].get('PortBindings') or info['HostConfig'].get('Memory')!=768*1024**2:raise ValueError('UNKNOWN_BASELINE_CONTAINER')
 return {'pg_id':info['Id'],'pg_started':info['State']['StartedAt'],'web_id':web['Id'],'web_started':web['State']['StartedAt'],'nginx_id':nginx['Id'],'hba_before':before,'subnet':subnet}
def unchanged_baseline(docker,binding):
 if json.loads(docker.run(['image','inspect',NGINX]))[0]['Id']!=binding['nginx_id']:raise ValueError('BASELINE_NGINX_IMAGE_CHANGED')
 for name,key in [(PG,'pg'),('village-web-web-1','web')]:
  value=json.loads(docker.run(['inspect',name]))[0]
  if value['Id']!=binding[key+'_id'] or value['State']['StartedAt']!=binding[key+'_started'] or not value['State']['Running']:raise ValueError('BASELINE_CHANGED')
 before=binding['hba_before'];actual=docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')
 if actual not in {before,add_hba(before,binding['subnet'])}:raise ValueError('HBA_CHANGED')
def database_oid(docker):return docker.sql("SELECT oid::text FROM pg_database WHERE datname='village_unified_candidate';",'postgres').strip()
def inspect_container(docker,name,spec,image_id):
 value=json.loads(docker.run(['inspect',name]))[0];host=value['HostConfig'];config=value['Config'];labels=config.get('Labels',{})
 if value['Image']!=image_id or config.get('Image')!=spec['image'] or config.get('User')!=spec['user'] or labels.get('com.docker.compose.project')!=PROJECT or labels.get('com.docker.compose.service')!=('api' if name==API else 'preview'):raise ValueError('CANDIDATE_IDENTITY_CHANGED')
 if host.get('Privileged') or not host.get('ReadonlyRootfs') or host.get('CapAdd') or host.get('CapDrop')!=['ALL'] or host.get('SecurityOpt')!=['no-new-privileges:true'] or host.get('Memory')!=(256 if name==API else 64)*1024**2 or host.get('MemorySwap')!=host['Memory']:raise ValueError('CANDIDATE_LIMITS_CHANGED')
 image_config=json.loads(docker.run(['image','inspect',spec['image']]))[0]['Config']
 if config.get('Cmd')!=image_config.get('Cmd') or config.get('Entrypoint')!=image_config.get('Entrypoint') or config.get('WorkingDir')!=image_config.get('WorkingDir') or host.get('PidMode')=='host' or host.get('IpcMode')=='host' or host.get('NanoCpus')!=int(spec['cpus']*10**9) or host.get('PidsLimit')!=64:raise ValueError('CANDIDATE_EXECUTION_CHANGED')
 wanted={'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'18084' if name==API else '18085'}]}
 if host.get('PortBindings')!=wanted:raise ValueError('CANDIDATE_PORT_CHANGED')
 expected={row['target']:(str(storage.no_links(row['source'])),not row['read_only']) for row in spec['volumes']};actual={row['Destination']:(str(storage.no_links(row['Source'])),row['RW']) for row in value['Mounts']}
 if any(row['Type']!='bind' for row in value['Mounts']) or len(value['Mounts'])!=len(expected) or actual!=expected or set(value['NetworkSettings']['Networks'])!={'village-api-validation_'+n for n in spec['networks']}:raise ValueError('CANDIDATE_MOUNTS_CHANGED')
 environment=dict(row.split('=',1) for row in config['Env']);base_env=dict(row.split('=',1) for row in json.loads(docker.run(['image','inspect',spec['image']]))[0]['Config']['Env'])
 if environment!={**base_env,**spec.get('environment',{})}:raise ValueError('CANDIDATE_ENVIRONMENT_CHANGED')
 return value
def resource_snapshot(docker):
 available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])*1024
 return {'available_bytes':available,'disk_free_bytes':shutil.disk_usage(Path.home()).free,'containers':docker.run(['stats','--no-stream','--format','{{json .}}',API,PG]).splitlines()}

def deploy_candidate(archive,backup,state,*,resume=False,check=False,docker=None):
 state=storage.no_links(state);archive=storage.no_links(archive);backup=storage.no_links(backup);meta=read_meta();verify_archive(archive,meta);manifest=rd.verify_backup(backup)
 for protected in [backup,ROOT,Path.home()/'village-deploy',Path.home()/'village-api-validation',Path.home()/'village-scene-files-validation']:
  if state==protected or state in protected.parents or protected in state.parents:raise ValueError('STATE_PATH_OVERLAP')
 docker=docker or Docker(state)
 if resume:
  binding=storage.read_private_json(state/'deployment.json');unchanged_baseline(docker,binding['baseline'])
  if binding['archive_sha256']!=meta['archive_sha256'] or binding['backup_sha256']!=manifest['files']['database.dump']['sha256'] or binding['backup_dir']!=str(backup):raise ValueError('RESUME_BINDING_DIFFERS')
 else:
  if state.exists():raise ValueError('STATE_EXISTS_USE_RESUME')
  base=baseline(docker)
  if database_oid(docker) or docker.sql("SELECT 1 FROM pg_roles WHERE rolname='village_unified_login';",'postgres').strip():raise ValueError('TARGET_ALREADY_EXISTS')
  names=docker.run(['ps','-a','--format','{{.Names}}']).splitlines()
  if any(name in names for name in [API,PREVIEW,'village-unified-extract']):raise ValueError('TARGET_CONTAINER_EXISTS')
  for port in [18084,18085]:
   with socket.socket() as sock:
    if sock.connect_ex(('127.0.0.1',port))==0:raise ValueError('CANDIDATE_PORT_OCCUPIED')
  binding={'version':1,'deployment_nonce':secrets.token_hex(16),'releaseId':meta['releaseId'],'archive_sha256':meta['archive_sha256'],'backup_sha256':manifest['files']['database.dump']['sha256'],'backup_dir':str(backup),'baseline':base,'steps':{}}
 resources=resource_snapshot_preflight();validate_resources(resources['available_bytes'],resources['disk_free_bytes'])
 if check:return {'status':'preflight_ok','releaseId':meta['releaseId']}
 if not resume:
  state.mkdir(mode=0o700);storage.write_private_json(state/'deployment.json',binding)
  for name in ['files','scene-files','releases']: (state/name).mkdir(mode=0o700)
 persist=lambda value:storage.write_private_json(state/'deployment.json',value);engine=ResumeEngine(binding,persist)
 def load_image():docker.run(['load','-i',str(archive)]);return {'id':image_identity(docker,meta)}
 image=engine.step('image',load_image,lambda receipt:receipt=={'id':image_identity(docker,meta)},recover=lambda:{'id':image_identity(docker,meta)})
 release=state/'releases'/meta['releaseId']
 def extract():
  release.mkdir(mode=0o700)
  docker.run(['create','--name','village-unified-extract','--network','none','--read-only','--label','village.release='+meta['releaseId'],meta['image']])
  for source,destination in [('/opt/village-web/.','web'),('/opt/village-schema/.','schema')]:
   (release/destination).mkdir(mode=0o700);docker.run(['cp','village-unified-extract:'+source,str(release/destination)])
  docker.run(['rm','village-unified-extract']);return {'web':tree_digest(release/'web'),'schema':tree_digest(release/'schema')}
 engine.step('extract',extract,lambda receipt:receipt=={'web':meta['static_sha256'],'schema':meta['schema_sha256']} and tree_digest(release/'web')==receipt['web'] and tree_digest(release/'schema')==receipt['schema'])
 def create_database():
  docker.sql('CREATE DATABASE '+DATABASE+' OWNER postgres TEMPLATE template0;','postgres');docker.sql("COMMENT ON DATABASE "+DATABASE+" IS 'village-unified-"+binding['deployment_nonce']+"';",'postgres');return created_database_receipt(docker,binding)
 engine.step('create_database',create_database,lambda receipt:receipt==created_database_receipt(docker,binding),recover=lambda:created_database_receipt(docker,binding))
 def restore():
  docker.archive_tool(backup/'database.dump',['--exit-on-error','--single-transaction','-h','/var/run/postgresql','-U',rd.ADMIN,'-d',DATABASE]);return verify_restored_archive(docker,backup,state)
 def restored(receipt):return receipt.get('oid')==database_oid(docker) and receipt.get('archive_sha256')==binding['backup_sha256']
 engine.step('restore',restore,restored,recover=lambda:verify_restored_archive(docker,backup,state))
 def schema():
  password=secrets.token_urlsafe(36);secret=state/'api-password'
  with secret.open('x',encoding='ascii') as f:f.write(password+'\n')
  secret.chmod(0o600)
  sql='BEGIN;\n'+''.join((release/'schema'/f'{name}.sql').read_text(encoding='utf-8')+'\n' for name in SCHEMAS)+"\nSET LOCAL password_encryption='scram-sha-256';ALTER ROLE "+ROLE+" PASSWORD '"+password+"';COMMIT;"
  docker.sql(sql);return schema_receipt(docker,meta)
 engine.step('schema',schema,lambda receipt:receipt==schema_receipt(docker,meta),recover=lambda:schema_receipt(docker,meta))
 engine.step('storage',lambda:copy_storage(docker,state,binding),lambda receipt:verify_storage(state,binding)==receipt,recover=lambda:verify_storage(state,binding))
 def hba():
  before=binding['baseline']['hba_before'];after=add_hba(before,binding['baseline']['subnet'])
  if docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf')!=before:raise ValueError('HBA_CHANGED')
  docker.exec('sh','-c','set -eu; umask 077; test ! -e /var/lib/postgresql/data/.unified-hba.partial; cp -p /var/lib/postgresql/data/pg_hba.conf /var/lib/postgresql/data/.unified-hba.partial; cat > /var/lib/postgresql/data/.unified-hba.partial; mv /var/lib/postgresql/data/.unified-hba.partial /var/lib/postgresql/data/pg_hba.conf',input=after)
  if docker.sql('SELECT pg_reload_conf();').strip()!='t' or docker.sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;').strip()!='0':raise ValueError('HBA_RELOAD_FAILED')
  return {'sha256':hashlib.sha256(after.encode()).hexdigest()}
 def hba_receipt():return {'sha256':hashlib.sha256(docker.exec('cat','/var/lib/postgresql/data/pg_hba.conf').encode()).hexdigest()}
 wanted_hba={'sha256':hashlib.sha256(add_hba(binding['baseline']['hba_before'],binding['baseline']['subnet']).encode()).hexdigest()}
 engine.step('hba',hba,lambda receipt:receipt==wanted_hba==hba_receipt(),recover=hba_receipt)
 spec=compose_document(state,meta,uid=os.geteuid(),gid=os.getegid(),key=read_key())
 def start():
  storage.write_private_json(state/'compose.json',spec);write_new(state/'nginx.conf',(ROOT/'linux/nginx.unified.conf').read_text(encoding='utf-8'))
  docker.run(['compose','-f',str(state/'compose.json'),'up','-d','--pull','never','--no-build']);wait_ready(docker,state,meta);return runtime_receipt(docker,state,meta)
 engine.step('runtime',start,lambda receipt:receipt==runtime_receipt(docker,state,meta),recover=lambda:runtime_receipt(docker,state,meta))
 unchanged_baseline(docker,binding['baseline']);return {'status':'internal_deployed_not_accepted','releaseId':meta['releaseId']}

def tree_digest(root):
 # Matches build-unified-release.py's names + LF-normalized byte digest.
 if any(p.is_symlink() for p in Path(root).rglob('*')):raise ValueError('LINKED_RELEASE_FILE')
 return load('unified_release_digest','build-unified-release.py').digest_files([(p.relative_to(root).as_posix(),p.read_bytes()) for p in sorted(Path(root).rglob('*')) if p.is_file() and not p.is_symlink()])
def write_new(path,text):
 with Path(path).open('x',encoding='utf-8') as f:f.write(text)
 Path(path).chmod(0o600)
def resource_snapshot_preflight():
 return {'available_bytes':int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1])*1024,'disk_free_bytes':shutil.disk_usage(Path.home()).free}
def verify_restored_archive(docker,backup,state):
 decoded=state/('archive-data-'+secrets.token_hex(8)+'.sql');docker.archive_tool(backup/'database.dump',['--data-only','--file=-'],output=decoded)
 try:expected=rd.parse_data_snapshot(decoded.read_text(encoding='utf-8'))
 finally:decoded.unlink()
 class Target:
  def sql(self,sql):return docker.sql(sql)
 target=Target();rd.compare_snapshot(expected,rd.actual_snapshot(target,expected))
 toc=(backup/'contents.txt').read_text(encoding='utf-8');rd.verify_structure(target,toc,json.loads(docker.sql(rd.CATALOG_SQL)))
 inventory=json.loads((backup/'inventory.json').read_text(encoding='utf-8'));rd.check_extensions(inventory['extensions'],json.loads(docker.sql("SELECT json_agg(json_build_object('name',extname,'version',extversion)) FROM pg_extension;")))
 return {'oid':database_oid(docker),'archive_sha256':rd.checksum(backup/'database.dump'),'tables':len(expected['rows']),'sequences':len(expected['sequences'])}
def created_database_receipt(docker,binding):
 if not re.fullmatch('[a-f0-9]{32}',binding.get('deployment_nonce','')):raise ValueError('INVALID_DEPLOYMENT_NONCE')
 value=json.loads(docker.sql("SELECT json_build_object('oid',oid::text,'owner',pg_get_userbyid(datdba),'comment',shobj_description(oid,'pg_database')) FROM pg_database WHERE datname='village_unified_candidate';",'postgres'))
 if value.get('owner')!='postgres' or value.get('comment')!='village-unified-'+binding['deployment_nonce']:raise ValueError('TARGET_OWNERSHIP_NOT_PROVEN')
 return {'oid':value['oid'],'nonce':binding['deployment_nonce']}
def schema_receipt(docker,meta):
 value=json.loads(docker.sql("SELECT json_build_object('version',api_private.installation_version(),'role',(SELECT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit AND rolconnlimit=4 FROM pg_roles WHERE rolname='village_unified_login'),'schemas',(SELECT count(*) FROM pg_namespace WHERE nspname IN ('api_private','scene_files')));"))
 if value!={'version':1,'role':True,'schemas':2}:raise ValueError('SCHEMA_IDENTITY_DIFFERS')
 fingerprint=docker.sql("""SELECT md5(json_build_object(
 'functions',(SELECT json_agg(json_build_array(p.oid::regprocedure::text,p.proacl,pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('api_private','scene_files','public') AND p.prokind='f'),
 'relations',(SELECT json_agg(json_build_array(n.nspname,c.relname,c.relacl,c.relrowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('api_private','scene_files','public') AND c.relkind IN('r','p','S')),
 'policies',(SELECT json_agg(json_build_array(n.nspname,c.relname,p.polname,p.polroles,p.polcmd,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY n.nspname,c.relname,p.polname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('api_private','scene_files','public')),
 'membership',(SELECT json_agg(json_build_array(r.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY r.rolname) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='village_unified_login'::regrole))::text);""").strip()
 if not re.fullmatch('[a-f0-9]{32}',fingerprint):raise ValueError('SCHEMA_FINGERPRINT_UNAVAILABLE')
 return {'oid':database_oid(docker),'schema_sha256':meta['schema_sha256'],'fingerprint':fingerprint,'version':1}

INVENTORY_SQL="""SELECT json_build_object(
 'buckets',(SELECT coalesce(json_agg(json_build_object('id',id,'public',public) ORDER BY id),'[]'::json) FROM storage.buckets),
 'objects',(SELECT coalesce(json_agg(json_build_object('id',id,'bucket',bucket_id,'name',name,'snapshot_updated_at',updated_at,'declared_size',metadata->'size','snapshot_etag',metadata->>'eTag','snapshot_version',to_jsonb(o)->>'version') ORDER BY bucket_id,name),'[]'::json) FROM (SELECT * FROM storage.objects ORDER BY bucket_id,name LIMIT 20001) o));"""
def snapshot_inventory(docker,archive_sha):
 raw=docker.sql(INVENTORY_SQL)
 if len(raw)>32*1024**2:raise ValueError('STORAGE_INVENTORY_TOO_LARGE')
 doc=json.loads(raw)
 for obj in doc['objects']:
  if isinstance(obj['declared_size'],str) and obj['declared_size'].isdigit():obj['declared_size']=int(obj['declared_size'])
 return storage.validate_inventory({**doc,'version':1,'project_ref':storage.PROJECT,'source_archive_sha256':archive_sha,'generated_at':storage.now()})
def copy_storage(docker,state,binding):
 import getpass
 run=state/'storage'
 if not run.exists():
  run.mkdir(mode=0o700);(run/'blobs').mkdir(mode=0o700);storage.write_private_json(run/'inventory.json',snapshot_inventory(docker,binding['backup_sha256']))
 else:
  doc=storage.read_private_json(run/'inventory.json')
  if doc['source_archive_sha256']!=binding['backup_sha256']:raise ValueError('STORAGE_SNAPSHOT_DIFFERS')
 try:return verify_storage(state,binding)
 except (ValueError,FileNotFoundError):pass
 key=getpass.getpass('Supabase SERVER Secret key for snapshot file copy (hidden): ')
 try:storage.copy_inventory(run/'inventory.json',run,key)
 finally:key=None
 return verify_storage(state,binding)
def verify_storage(state,binding):
 doc,objects,manifest=storage.load_transfer(state/'storage')
 if doc['source_archive_sha256']!=binding['backup_sha256'] or any(value['status']!='copied' for value in manifest['records'].values()):raise ValueError('STORAGE_COPY_INCOMPLETE')
 rows=[]
 for obj in objects:
  record=manifest['records'][obj['id']];row={key:obj[key] for key in ['id','bucket','name','declared_size','snapshot_etag','snapshot_version']}
  row.update(snapshot_updated_at=dt.datetime.fromisoformat(obj['snapshot_updated_at'].replace('Z','+00:00')).astimezone(dt.timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z'),size=record['received_bytes'],sha256=record['sha256']);rows.append(row)
 index={'version':1,'source_archive_sha256':binding['backup_sha256'],'objects':rows};path=state/'storage-index.json'
 if path.exists():
  if storage.read_private_json(path)!=index:raise ValueError('STORAGE_INDEX_CHANGED')
 else:storage.write_private_json(path,index)
 return {'index_sha256':digest(index),'objects':len(rows),'bytes':sum(row['size'] for row in rows)}
def runtime_receipt(docker,state,meta):
 spec=storage.read_private_json(state/'compose.json');expected=compose_document(state,meta,uid=os.geteuid(),gid=os.getegid(),key=read_key())
 if spec!=expected or (state/'nginx.conf').read_bytes()!=(ROOT/'linux/nginx.unified.conf').read_bytes():raise ValueError('RUNTIME_CONFIGURATION_CHANGED')
 ids={API:image_identity(docker,meta),PREVIEW:json.loads(docker.run(['image','inspect',NGINX]))[0]['Id']};result={}
 for name,service in [(API,'api'),(PREVIEW,'preview')]:
  info=inspect_container(docker,name,spec['services'][service],ids[name])
  if not info['State']['Running']:raise ValueError('CANDIDATE_NOT_RUNNING')
  result[name]={'id':info['Id'],'image':info['Image']}
 return result
def wait_ready(docker,state,meta):
 for _ in range(50):
  info=json.loads(docker.run(['inspect',API]))[0]
  if not info['State']['Running']:raise ValueError('API_STOPPED')
  if info['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(1)
 else:raise ValueError('API_HEALTH_TIMEOUT')
 no_proxy=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 def get(path):
  try:
   with no_proxy.open('http://127.0.0.1:18085'+path,timeout=10) as response:return response.status,response.read(2*1024**2)
  except urllib.error.HTTPError as e:return e.code,b''
 for path in ['/','/homepage/dist/index.html','/app.js','/deployment-config.js']:
  status,body=get(path)
  if status!=200 or not body:raise ValueError('PREVIEW_STATIC_FAILED')
  if path=='/deployment-config.js' and (meta['releaseId'].encode() not in body or meta['instanceId'].encode() not in body):raise ValueError('PREVIEW_RELEASE_DIFFERS')
 for path in ['/.git/config','/linux/.env.example','/business-api/package.json']:
  if get(path)[0] not in [403,404]:raise ValueError('PREVIEW_PRIVATE_FILE_EXPOSED')
 status,_=get('/api/v1/me')
 if status!=401:raise ValueError('PREVIEW_AUTH_GUARD_FAILED')
def restart_candidate(docker,state,meta):
 runtime_receipt(docker,state,meta);before=json.loads(docker.run(['inspect',API]))[0];docker.run(['compose','-f',str(state/'compose.json'),'restart','api']);wait_ready(docker,state,meta);runtime_receipt(docker,state,meta);after=json.loads(docker.run(['inspect',API]))[0]
 return {'same_container':before['Id']==after['Id'],'started_at_changed':before['State']['StartedAt']!=after['State']['StartedAt']}

def prepare_context(docker,admin,member,previous):
 if not all(re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',value) for value in [admin,member]) or admin==member:raise ValueError('INVALID_TEST_IDENTITY')
 sql=(ROOT/'linux/sql/scene-files-test-context.sql').read_text(encoding='utf-8').replace('village_scene_files_validation',DATABASE).replace('c2a-test-20261019','unified-test-20261020').replace('c2a-test-group-20261019','unified-test-group-20261020').replace('c2a-test-space-20261019','unified-test-space-20261020').replace('c2a00000','c3a00000').replace('C2a TEST','Unified TEST').replace("student_id='332'","id='"+admin+"'").replace("student_id='25213040'","id='"+member+"'").replace('__BEGIN__','BEGIN;').replace('__BOUNDARY_EWKT__','SRID=4326;MULTIPOLYGON(((112.999 22.999,113.001 22.999,113.001 23.001,112.999 23.001,112.999 22.999)))')
 context={'teachingProjectId':'c3a00000-0000-4000-8000-000000000002','villageId':'c3a00000-0000-4000-8000-000000000001','courseId':'unified-test-20261020','groupId':'unified-test-group-20261020','spaceId':'unified-test-space-20261020'}
 if previous is not None and previous!=context:raise ValueError('TEST_CONTEXT_CHANGED')
 raw=docker.sql(sql);report=json.loads(raw)
 if report.get('status')!='ready' or report.get('test_memberships')!=1:raise ValueError('TEST_CONTEXT_NOT_READY')
 return context
def synthetic_task_proof(meta):
 proof=meta.get('validation',{})
 if proof.get('native_status')!='success' or proof.get('platform_status')!='success' or proof.get('code_sha256')!=meta['code_sha256'] or proof.get('schema_sha256')!=meta['schema_sha256'] or not all(type(proof.get(key)) is int and proof[key]>0 for key in ['native_run_id','platform_run_id']):raise ValueError('MATCHING_NATIVE_CI_PROOF_REQUIRED')
 return {'verified':True,'releaseId':meta['releaseId'],'native_run_id':proof['native_run_id'],'platform_run_id':proof['platform_run_id'],'real_jobs':False}
def probe_environment(state):
 state=storage.private_path(state,directory=True);binding=storage.read_private_json(state/'deployment.json');meta=read_meta();docker=Docker(state)
 if binding['archive_sha256']!=meta['archive_sha256'] or binding.get('steps',{}).get('runtime',{}).get('status')!='done':raise ValueError('DEPLOYMENT_NOT_READY')
 unchanged_baseline(docker,binding['baseline']);runtime_receipt(docker,state,meta);schema_receipt(docker,meta);verify_storage(state,binding)
 probe=load('unified_probe_runtime','probe-unified-business.py');api=probe.HttpApi('http://127.0.0.1:18084',read_key(),prepare_context=lambda admin,member,old:prepare_context(docker,admin,member,old),restart=lambda:restart_candidate(docker,state,meta),persist=lambda value:storage.write_private_json(state/'probe-state.json',value),resources=lambda:resource_snapshot(docker),task_proof=lambda:synthetic_task_proof(meta))
 api.persist_report=lambda value:storage.write_private_json(state/'acceptance.json',value)
 return api,storage.read_private_json(state/'probe-state.json') if (state/'probe-state.json').exists() else {}
def verify_candidate(state):
 api,probe=probe_environment(state);meta=read_meta();docker=Docker(state);proof=restart_candidate(docker,state,meta)
 if not proof['same_container'] or not proof['started_at_changed']:raise ValueError('RESTART_NOT_PROVEN')
 storage.write_private_json(state/'verification.json',{'releaseId':meta['releaseId'],'proof':proof,'verified_at':time.time()});return {'status':'restart_verified_not_accepted'}
def rollback_code(state):
 binding=storage.read_private_json(state/'deployment.json');meta=read_meta();docker=Docker(state);unchanged_baseline(docker,binding['baseline']);runtime_receipt(docker,state,meta)
 # Initial candidate has no previous unified release. Stop only its code; keep DB and files.
 docker.run(['compose','-f',str(state/'compose.json'),'stop','api','preview']);return {'status':'candidate_code_stopped_database_retained'}
@contextlib.contextmanager
def deployment_lock():
 import fcntl
 path=storage.no_links(Path.home()/'.village-unified-deployment.lock');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  if os.fstat(fd).st_uid!=os.geteuid() or os.fstat(fd).st_nlink!=1 or os.fstat(fd).st_mode&0o077:raise ValueError('INVALID_DEPLOYMENT_LOCK')
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise ValueError('DEPLOYMENT_ALREADY_RUNNING') from None
  yield
 finally:os.close(fd)
def main():
 parser=argparse.ArgumentParser(description=__doc__);mode=parser.add_mutually_exclusive_group(required=True)
 for name in ['check','deploy','verify','resume','rollback-code']:mode.add_argument('--'+name,action='store_true')
 parser.add_argument('--archive',type=Path);parser.add_argument('--backup-dir',type=Path);parser.add_argument('--state-dir',type=Path,default=STATE);args=parser.parse_args();os.umask(0o077)
 if sys.platform!='linux' or os.geteuid()==0:raise ValueError('NORMAL_LINUX_ADMIN_REQUIRED')
 with deployment_lock():
  if args.verify:report=verify_candidate(args.state_dir)
  elif args.rollback_code:report=rollback_code(args.state_dir)
  else:
   if not args.archive or not args.backup_dir:raise ValueError('ARCHIVE_AND_BACKUP_REQUIRED')
   report=deploy_candidate(args.archive,args.backup_dir,args.state_dir,resume=args.resume,check=args.check)
   if not args.check:
    import getpass
    api,state=probe_environment(args.state_dir);probe=load('unified_probe_entry','probe-unified-business.py')
    admin=(input('Website ADMIN student ID [332]: ').strip() or '332',getpass.getpass('Website ADMIN LOGIN password (hidden): '));member=(input('Website MEMBER student ID [25213040]: ').strip() or '25213040',getpass.getpass('Website MEMBER LOGIN password (hidden): '))
    report=probe.run_probe(api,admin,member,state);api.persist_report(report)
  print(json.dumps(report));print('UNIFIED_INTERNAL_VALIDATED_NOT_CUT_OVER' if report.get('status')=='internal_validated_not_cut_over' else 'UNIFIED_CANDIDATE_NOT_CUT_OVER')
if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error) if re.fullmatch('[A-Z][A-Z0-9_]{2,90}',str(error)) else 'DEPLOYMENT_CHECK_FAILED'
  if hasattr(error,'phase') and hasattr(error,'code'):code='phase='+error.phase+' code='+error.code
  print('STOP: UNIFIED_DEPLOYMENT_FAILED '+code+'. Retain private data/logs; do not reset or paste credentials/rows.',file=sys.stderr);raise SystemExit(1)
