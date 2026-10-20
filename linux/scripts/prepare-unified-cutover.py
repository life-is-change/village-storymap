#!/usr/bin/env python3
"""Guarded Aliyun-only activation; source website and independent writes are retained."""
import argparse,copy,datetime as dt,getpass,hashlib,http.client,importlib.util,ipaddress,io,json,os,re,secrets,socket,ssl,sys,tarfile,time,urllib.error,urllib.parse,urllib.request,warnings
from pathlib import Path
S=Path(__file__).resolve().parent;ROOT=S.parents[1]
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,S/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
deploy=load('unified_cutover_deploy','deploy-unified-business.py');storage=deploy.storage
def validate_snapshot(manifest,*,now=None):
 now=now or dt.datetime.now(dt.timezone.utc)
 try:
  start=dt.datetime.fromisoformat(manifest['started_at_utc'].replace('Z','+00:00'));end=dt.datetime.fromisoformat(manifest['completed_at_utc'].replace('Z','+00:00'))
  if manifest.get('status')!='archive_verified_not_restored' or start.tzinfo is None or end.tzinfo is None or not start<=end or not dt.timedelta(0)<=now-start<=dt.timedelta(hours=24) or now-end<dt.timedelta(minutes=-5):raise ValueError()
 except (KeyError,TypeError,ValueError):raise ValueError('FRESH_SNAPSHOT_REQUIRED') from None
 return True
def https_origin(origin):
 try:
  value=urllib.parse.urlsplit(origin);host=value.hostname
  if value.scheme!='https' or value.username or value.password or value.port not in (None,443) or value.path not in ('','/') or value.query or value.fragment or not host or not re.fullmatch(r'(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',host) or '.' not in host or host.endswith('.') or '..' in host:raise ValueError()
  try:ipaddress.ip_address(host)
  except ValueError:pass
  else:raise ValueError()
  if host.endswith(('.localhost','.local','.internal')):raise ValueError()
  return 'https://'+host
 except ValueError:raise ValueError('HTTPS_DOMAIN_REQUIRED') from None
def verify_source_files(objects,records,head):
 total=0
 for obj in objects:
  row=records.get(obj['id'],{})
  try:current=head(obj)
  except Exception:raise ValueError('SOURCE_FILE_CHANGED_OR_MISSING') from None
  def etag(value):return value.strip('"') if isinstance(value,str) and value else None
  if row.get('status')!='copied' or not etag(row.get('source_etag')) or etag(current.get('etag'))!=etag(row['source_etag']) or etag(obj.get('snapshot_etag')) not in (None,etag(current.get('etag'))) or type(current.get('size')) is not int or current['size']!=row.get('received_bytes') or obj.get('declared_size') not in (None,current['size']):raise ValueError('SOURCE_FILE_CHANGED_OR_MISSING')
  total+=current['size']
 return {'objects':len(objects),'bytes':total}
def require_new_initialization(report):
 if report.get('activated_at') or report.get('initialized') or report.get('business_writes',0)!=0:raise ValueError('REINITIALIZATION_FORBIDDEN')
 return True
def difference_report(baseline,source,local):
 a={key for key in set(baseline)|set(source) if baseline.get(key)!=source.get(key)};b={key for key in set(baseline)|set(local) if baseline.get(key)!=local.get(key)}
 return {'source_only_changes':sorted(a-b),'local_only_changes':sorted(b-a),'conflicts':sorted(key for key in a&b if source.get(key)!=local.get(key)),'same_changes':sorted(key for key in a&b if source.get(key)==local.get(key)),'automatic_merge':False}
def source_package(output,meta):
 output=storage.no_links(output)
 if output.exists():raise ValueError('SOURCE_PACKAGE_EXISTS_RETAIN_IT')
 if not re.fullmatch('aliyun-[a-zA-Z0-9_-]{1,92}',meta.get('instanceId','')):raise ValueError('INVALID_INSTANCE')
 if output==ROOT or ROOT in output.parents:raise ValueError('PRIVATE_SOURCE_PACKAGE_OUTSIDE_REPOSITORY_REQUIRED')
 output.mkdir(parents=True,mode=0o700);load('unified_source_backup_acl','backup-managed-db.py').private_directory(output);token=secrets.token_urlsafe(36);password=secrets.token_urlsafe(36)
 sql=(ROOT/'supabase_SQL/Aliyun Task Bridge.sql').read_text(encoding='utf-8')
 backup="""CREATE TABLE aliyun_bridge.preinstall_functions AS SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('import_geoprocessing_result','request_geoprocessing_cancel','teacher_cancel_geoprocessing_run','request_facade_cancel','confirm_facade_crop','retry_failed_facade_run','submit_geoprocessing_run','submit_facade_run');\n"""
 sql=sql.replace('CREATE SCHEMA aliyun_bridge;','CREATE SCHEMA aliyun_bridge;\n'+backup)
 extra="CREATE ROLE village_aliyun_transport LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 PASSWORD '"+password+"';\nGRANT village_aliyun_bridge TO village_aliyun_transport;\n"
 if not sql.rstrip().endswith('COMMIT;'):raise ValueError('SOURCE_TRANSACTION_BOUNDARY_CHANGED')
 sql=sql.rstrip()[:-len('COMMIT;')]+extra+'COMMIT;\n'
 ca=(ROOT/'linux/certs/supabase-prod-ca-2021.crt').read_text(encoding='utf-8')
 url='postgresql://village_aliyun_transport:'+password+'@db.'+storage.PROJECT+'.supabase.co:5432/postgres'
 values={'ALIYUN_BRIDGE_INSTANCE_ID':meta['instanceId'],'ALIYUN_BRIDGE_TOKEN':token,'ALIYUN_BRIDGE_DATABASE_URL':url,'ALIYUN_BRIDGE_DB_CA':ca}
 for name,text in [('bridge-token',token+'\n'),('source-install.sql',sql),('source.env','\n'.join(k+'='+json.dumps(v) for k,v in values.items())+'\n')]:deploy.write_new(output/name,text)
 rollback="""-- First stop new Aliyun bridge submissions locally and disable its Edge credentials.
-- Never drop private tasks, objects, receipts or source tables.
BEGIN;
DO $$BEGIN IF EXISTS(SELECT 1 FROM aliyun_bridge.run_origins) THEN RAISE EXCEPTION 'PRIVATE_HISTORY_REQUIRES_RETAINED_BOUNDARY_AND_MANUAL_DRAIN';END IF;END$$;
ALTER ROLE village_aliyun_transport NOLOGIN;
REVOKE village_aliyun_bridge FROM village_aliyun_transport;
DO $$DECLARE r record;BEGIN FOR r IN SELECT * FROM aliyun_bridge.preinstall_functions LOOP EXECUTE r.definition;END LOOP;END$$;
COMMIT;
-- Origin policies/triggers and empty private tables are retained. Ordinary source grants were not revoked.
"""
 deploy.write_new(output/'source-rollback-after-drain.sql',rollback)
 storage.write_private_json(output/'source-package.json',{'status':'prepared_not_applied','instanceId':meta['instanceId'],'releaseId':meta['releaseId'],'git_sha':meta['git_sha'],'source_sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),'provider_functions':['aliyun-task-bridge','aliyun-facade-cloud'],'shared_auth_changed':False})
 return output
def build_handoff(image,backup,token,output,meta):
 output=storage.no_links(output);deploy.verify_archive(image,meta)
 if output.exists():raise ValueError('HANDOFF_EXISTS_RETAIN_IT')
 files={meta['archive_filename']:Path(image),'bridge-token':Path(token),**{'backup/'+name:Path(backup)/name for name in ['database.dump','roles.sql','inventory.json','contents.txt','manifest.json']}}
 manifest={'version':1,'releaseId':meta['releaseId'],'files':{name:{'bytes':path.stat().st_size,'sha256':deploy.rd.checksum(path)} for name,path in files.items()}}
 with output.open('xb') as stream,tarfile.open(fileobj=stream,mode='w:gz') as archive:
  for name,path in files.items():
   if path.is_symlink() or not path.is_file() or path.stat().st_nlink!=1:raise ValueError('LINKED_HANDOFF_INPUT')
   info=tarfile.TarInfo(name);info.size=path.stat().st_size;info.mode=0o600
   with path.open('rb') as f:archive.addfile(info,f)
  raw=json.dumps(manifest,sort_keys=True).encode();info=tarfile.TarInfo('handoff.json');info.size=len(raw);info.mode=0o600;archive.addfile(info,io.BytesIO(raw))
 output.chmod(0o600);return output
def package_handoff(image,output,bin_dir):
 output=storage.no_links(output);meta=deploy.read_meta();deploy.verify_archive(image,meta);deploy.synthetic_task_proof(meta)
 if output.exists():raise ValueError('HANDOFF_DIRECTORY_EXISTS_RETAIN_IT')
 tool=load('unified_handoff_backup','backup-managed-db.py');tool.validate_output_root(output,ROOT,Path.home());tool.private_directory(output)
 for name in ['psql','pg_dump','pg_dumpall','pg_restore']:
  if not os.access(tool.pg_tool(bin_dir,name),os.X_OK):raise ValueError('PG17_CLIENT_TOOLS_REQUIRED')
 password=getpass.getpass('Supabase DATABASE password for NEW consistent snapshot (hidden): ')
 try:backup=tool.backup(output/'backups',bin_dir,password,ROOT,Path.home())
 finally:password=None
 validate_snapshot(deploy.rd.verify_backup(backup));source=source_package(output/'source-private',meta)
 bundle=build_handoff(image,backup,source/'bridge-token',output/('village-handoff-'+meta['releaseId']+'.tar.gz'),meta)
 return {'status':'private_handoff_prepared_not_uploaded','bundle':str(bundle),'bundle_sha256':deploy.rd.checksum(bundle),'source_private_directory':str(source),'source_extension':'prepared_not_applied','source_site_changed':False}

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('REDIRECT_REFUSED')
def bridge_request(token,operation,input):
 if not re.fullmatch(r'[A-Za-z0-9_-]{48}',token):raise ValueError('PRIVATE_BRIDGE_TOKEN_REQUIRED')
 url=storage.ORIGIN+'/functions/v1/aliyun-task-bridge';body=json.dumps({'action':'call','operation':operation,'input':input}).encode()
 opener=urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()),NoRedirect())
 try:
  with opener.open(urllib.request.Request(url,data=body,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST'),timeout=30) as response:
   raw=response.read(2*1024**2+1)
   if len(raw)>2*1024**2:raise ValueError()
   return json.loads(raw)
 except Exception:raise ValueError('PRIVATE_SOURCE_BRIDGE_NOT_READY') from None
def source_default_proof():
 source=(ROOT/'deployment-config.js').read_text(encoding='utf-8')
 if "mode: 'source'" not in source or 'apiBase: null' not in source:raise ValueError('SOURCE_CONFIGURATION_CHANGED')
 return {'mode':'source','writable':True,'source_configuration_sha256':hashlib.sha256(source.encode()).hexdigest(),'write_proof':'source mode browser/native compatibility tests; no live source mutation performed'}
def cutover_checks(state,origin,*,files_key=None):
 state=storage.private_path(state,directory=True);binding=storage.read_private_json(state/'deployment.json');meta=deploy.read_meta();manifest=deploy.rd.verify_backup(Path(binding['backup_dir']));validate_snapshot(manifest)
 if binding['archive_sha256']!=meta['archive_sha256']:raise ValueError('RELEASE_MISMATCH')
 acceptance=storage.read_private_json(state/'acceptance.json');probe=storage.read_private_json(state/'probe-state.json')
 if acceptance.get('status')!='internal_validated_not_cut_over' or not probe.get('complete') or acceptance.get('releaseId')!=meta['releaseId'] or acceptance.get('instanceId')!=meta['instanceId'] or acceptance.get('restart_persistence') is not True:raise ValueError('CONSOLIDATED_ACCEPTANCE_REQUIRED')
 if [row.get('concurrency') for row in acceptance.get('load',[])]!=[1,5,10,20] or any(row.get('failures')!=0 for row in acceptance['load']):raise ValueError('CLOUD_LOAD_PROOF_REQUIRED')
 docker=deploy.Docker(state);deploy.unchanged_baseline(docker,binding['baseline']);runtime=deploy.runtime_receipt(docker,state,meta);schema=deploy.schema_receipt(docker,meta)
 if schema!=binding['steps']['schema']['receipt']:raise ValueError('SCHEMA_CHANGED')
 local_files=deploy.verify_storage(state,binding);site=https_origin(origin);token=storage.private_path(state/'bridge-token').read_text().strip();workers=bridge_request(token,'bridge_v1_availability',{'kind':'geoprocessing'});deploy.validate_worker_readiness(workers,meta['instanceId'])
 doc,objects,records=storage.load_transfer(state/'storage')
 missing=int(docker.sql("SELECT count(*) FROM public.teaching_projects p WHERE p.stage NOT IN('completed','archived') AND p.practice_village_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api_private.task_worker_villages m WHERE m.local_village_id=p.practice_village_id);").strip())
 if missing:raise ValueError('WORKER_VILLAGE_MAPPING_REQUIRED')
 if files_key is None:raise ValueError('SOURCE_FILE_RECHECK_KEY_REQUIRED')
 source_files=verify_source_files(objects,records['records'],storage.SourceTransport(files_key).head)
 return {'status':'cutover_gates_passed_not_activated','origin':site,'releaseId':meta['releaseId'],'instanceId':meta['instanceId'],'source_snapshot_started':manifest['started_at_utc'],'source_snapshot_completed':manifest['completed_at_utc'],'source_archive_sha256':binding['backup_sha256'],'files':source_files,'local_files':local_files,'runtime':runtime,'schema':schema,'workers':workers,'source_site':source_default_proof(),'checked_at':time.time()}
def validate_worker_mapping(mapping):
 if not isinstance(mapping,dict) or not 1<=len(mapping)<=100:raise ValueError('INVALID_WORKER_VILLAGE_MAPPING')
 for local,worker in mapping.items():
  if not re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',local) or not isinstance(worker,str) or not re.fullmatch('[-a-zA-Z0-9_]{1,100}',worker):raise ValueError('INVALID_WORKER_VILLAGE_MAPPING')
 return mapping
def configure_worker_mapping(state,path):
 state=storage.private_path(state,directory=True);docker=deploy.Docker(state);meta=deploy.read_meta();deploy.runtime_receipt(docker,state,meta)
 mapping=validate_worker_mapping(storage.read_private_json(path));token=storage.private_path(state/'bridge-token').read_text().strip()
 for worker in mapping.values():
  result=bridge_request(token,'bridge_v1_source_status',{'villageId':worker})
  if result.get('instanceId')!=meta['instanceId'] or result.get('data',{}).get('state')!='ready':raise ValueError('WORKER_VILLAGE_SOURCE_NOT_READY')
 # UUID and worker ID are strictly validated before SQL interpolation. Never infer a mapping from a display name.
 values=','.join("('"+local+"'::uuid,'"+worker+"')" for local,worker in mapping.items())
 docker.sql("BEGIN;DO $$BEGIN IF EXISTS(WITH proposed(local_id,worker_id) AS(VALUES "+values+") SELECT 1 FROM proposed p LEFT JOIN public.villages v ON v.id=p.local_id LEFT JOIN api_private.task_worker_villages m ON m.local_village_id=p.local_id WHERE v.id IS NULL OR m.local_village_id IS NOT NULL AND m.worker_village_id<>p.worker_id) THEN RAISE EXCEPTION 'WORKER_MAPPING_CONFLICT';END IF;END$$;INSERT INTO api_private.task_worker_villages(local_village_id,worker_village_id) VALUES "+values+" ON CONFLICT DO NOTHING;COMMIT;")
 storage.write_private_json(state/'worker-village-mapping.json',{'releaseId':meta['releaseId'],'mapping':mapping,'checked_at':time.time()})
def tls_configuration(origin,meta):
 domain=urllib.parse.urlsplit(https_origin(origin)).hostname
 live={'mode':'aliyun','stage':'live','instanceId':meta['instanceId'],'apiBase':'/api/v1','releaseId':meta['releaseId']};javascript='window.VILLAGE_DEPLOYMENT=Object.freeze('+json.dumps(live,separators=(',',':'))+');'
 return '''worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;
events { worker_connections 128; }
http { access_log off; server_tokens off; client_body_temp_path /tmp/client; proxy_temp_path /tmp/proxy;
 server { listen 8080; server_name DOMAIN; return 301 https://DOMAIN$request_uri; }
 server { listen 8443 ssl; server_name DOMAIN; ssl_certificate /run/tls/fullchain.pem; ssl_certificate_key /run/tls/private.key; ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 50m;
  location = /deployment-config.js { default_type application/javascript; add_header Cache-Control no-store; return 200 'JAVASCRIPT'; }
  location / { proxy_pass http://village-unified-preview:8080; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header Connection ""; proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 150s; proxy_send_timeout 150s; }
 }
}
'''.replace('DOMAIN',domain).replace('JAVASCRIPT',javascript)
class LoopbackTLS(http.client.HTTPSConnection):
 def connect(self):self.sock=self._context.wrap_socket(socket.create_connection(('127.0.0.1',self.port),timeout=10),server_hostname=self.host)
def tls_probe(origin,port,meta):
 domain=urllib.parse.urlsplit(https_origin(origin)).hostname;connection=LoopbackTLS(domain,port,context=ssl.create_default_context(),timeout=10)
 try:
  connection.request('GET','/deployment-config.js');response=connection.getresponse();raw=response.read(4096)
  if response.status!=200 or meta['releaseId'].encode() not in raw or meta['instanceId'].encode() not in raw or b'"stage":"live"' not in raw:raise ValueError('TLS_RELEASE_MISMATCH')
  connection.request('GET','/api/v1/me');response=connection.getresponse();response.read(4096)
  if response.status!=401:raise ValueError('TLS_AUTH_GUARD_FAILED')
  return {'verified':True,'hostname':domain,'protocol':'verified TLS with system trust and hostname validation','port':port}
 except (ssl.SSLError,OSError):raise ValueError('TLS_HOSTNAME_OR_CHAIN_FAILED') from None
 finally:connection.close()
def public_compose(state,meta,cert,key,*,public=False):
 base=deploy.compose_document(state,meta,uid=os.geteuid(),gid=os.getegid(),key=deploy.read_key())['services']['preview'];value=copy.deepcopy(base);value.pop('depends_on');value['container_name']='village-unified-public';value['volumes']=[{'type':'bind','source':str(path),'target':target,'read_only':True,'bind':{'create_host_path':False}} for path,target in [(state/'tls-nginx.conf','/etc/nginx/nginx.conf'),(cert,'/run/tls/fullchain.pem'),(key,'/run/tls/private.key')]];value['ports']=['0.0.0.0:80:8080','0.0.0.0:443:8443'] if public else ['127.0.0.1:18443:8443']
 return {'name':'village-unified-public','services':{'public':value},'networks':{'dbnet':{'external':True,'name':'village-api-validation_dbnet'}}}
def apply_activation(state,origin,cert,key,*,files_key):
 # Every prerequisite is checked before the old public HTTP container is stopped.
 state=storage.private_path(state,directory=True);proof=cutover_checks(state,origin,files_key=files_key);meta=deploy.read_meta();docker=deploy.Docker(state)
 if (state/'activation.json').exists():raise ValueError('ALREADY_ACTIVATED_DO_NOT_REINITIALIZE')
 domain=urllib.parse.urlsplit(https_origin(origin)).hostname
 if '8.148.248.237' not in {row[4][0] for row in socket.getaddrinfo(domain,443,family=socket.AF_INET,type=socket.SOCK_STREAM)}:raise ValueError('DOMAIN_DNS_MUST_POINT_TO_THIS_SERVER')
 cert=storage.private_path(cert);key=storage.private_path(key);config=tls_configuration(origin,meta)
 if (state/'tls-nginx.conf').exists():
  if (state/'tls-nginx.conf').read_text()!=config:raise ValueError('TLS_CONFIGURATION_CHANGED')
 else:deploy.write_new(state/'tls-nginx.conf',config)
 document=public_compose(state,meta,cert,key);storage.write_private_json(state/'public-compose.json',document);docker.run(['compose','-f',str(state/'public-compose.json'),'up','-d','--pull','never','--no-build'])
 proof['tls_candidate']=tls_probe(origin,18443,meta)
 # Allow private tasks only after the live source endpoint and both compatible Worker heartbeats passed.
 deploy.enable_bridge(state,docker,meta)
 proof['runtime_after_bridge']=deploy.runtime_receipt(docker,state,meta)
 # Persist intent first: uncertain public exposure must never automatically fall back to writable Supabase.
 proof.update(status='activation_started_no_automatic_source_fallback',activated_at=time.time(),initialized=True);storage.write_private_json(state/'activation.json',proof)
 docker.run(['stop','village-web-web-1']);document=public_compose(state,meta,cert,key,public=True);storage.write_private_json(state/'public-compose.json',document);docker.run(['compose','-f',str(state/'public-compose.json'),'up','-d','--pull','never','--no-build']);proof['tls_public']=tls_probe(origin,443,meta)
 proof.update(status='public_route_enabled_pending_real_browser_and_gpu',formal_complete=False);storage.write_private_json(state/'activation.json',proof);return proof
def rollback_code(state):
 state=storage.private_path(state,directory=True);receipt=storage.read_private_json(state/'activation.json');docker=deploy.Docker(state);meta=deploy.read_meta()
 if receipt.get('releaseId')!=meta['releaseId']:raise ValueError('ROLLBACK_RELEASE_MISMATCH')
 document=storage.read_private_json(state/'public-compose.json')
 if document['services']['public']['container_name']!='village-unified-public':raise ValueError('UNKNOWN_PUBLIC_CONTAINER')
 docker.run(['compose','-f',str(state/'public-compose.json'),'stop','public']);deploy.disable_bridge(state,docker,meta)
 receipt.update(status='public_code_stopped_local_data_retained',formal_complete=False);storage.write_private_json(state/'activation.json',receipt)
 return {'status':receipt['status'],'source_site_repointed':False,'manual_conflict_merge_required_for_source_return':True}
def main():
 p=argparse.ArgumentParser(description=__doc__);mode=p.add_mutually_exclusive_group(required=True)
 for name in ['plan','check','apply','rollback-code','package-handoff']:mode.add_argument('--'+name,action='store_true')
 p.add_argument('--state-dir',type=Path,default=deploy.STATE);p.add_argument('--source-output',type=Path);p.add_argument('--origin');p.add_argument('--cert',type=Path);p.add_argument('--key',type=Path);p.add_argument('--worker-map',type=Path);p.add_argument('--archive',type=Path);p.add_argument('--bin-dir',type=Path,default=Path.home()/'.codex/tools/village-pg17/pgsql/bin' if os.name=='nt' else Path('/usr/lib/postgresql/17/bin'));args=p.parse_args();os.umask(0o077);warnings.simplefilter('error',getpass.GetPassWarning)
 if args.package_handoff:
  if not args.archive or not args.source_output:raise ValueError('HANDOFF_IMAGE_AND_OUTPUT_REQUIRED')
  print(json.dumps(package_handoff(args.archive,args.source_output,args.bin_dir)));return
 if args.plan:
  meta=deploy.read_meta();out=args.source_output or Path.home()/('village-unified-source-'+meta['releaseId']);source_package(out,meta);print(json.dumps({'status':'source_package_prepared_not_applied','private_directory':str(out),'manual_requirements':['fresh verified snapshot','source SQL and two Edge transports','compatible4090 restart','HTTPS domain and private certificate','consolidated cloud acceptance'],'source_default':source_default_proof()}));return
 if sys.platform!='linux' or os.geteuid()==0:raise ValueError('NORMAL_LINUX_ADMIN_REQUIRED')
 with deploy.deployment_lock():
  if args.rollback_code:result=rollback_code(args.state_dir)
  else:
   if not args.origin:raise ValueError('HTTPS_DOMAIN_REQUIRED')
   https_origin(args.origin)
   if args.worker_map:configure_worker_mapping(args.state_dir,args.worker_map)
   if args.apply and (not args.cert or not args.key):raise ValueError('TLS_CERTIFICATE_AND_KEY_REQUIRED')
   credential=getpass.getpass('Supabase SERVER Secret key for final snapshot file HEAD checks (hidden): ')
   try:result=apply_activation(args.state_dir,args.origin,args.cert,args.key,files_key=credential) if args.apply else cutover_checks(args.state_dir,args.origin,files_key=credential)
   finally:credential=None
  print(json.dumps(result));print('UNIFIED_ACTIVATION_NOT_FORMALLY_COMPLETE')
if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error) if re.fullmatch('[A-Z][A-Z0-9_]{2,100}',str(error)) else 'CUTOVER_CHECK_FAILED'
  print('STOP: UNIFIED_CUTOVER_FAILED '+code+'. Retain local/source data; no automatic overwrite or source fallback.',file=sys.stderr);raise SystemExit(1)
