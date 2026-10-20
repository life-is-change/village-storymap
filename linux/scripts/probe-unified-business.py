#!/usr/bin/env python3
"""One hidden-input, resumable TEST-only acceptance pass. Never submits GPU/provider tasks."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse,base64,copy,getpass,hashlib,importlib.util,json,re,ssl,struct,time,urllib.error,urllib.parse,urllib.request,uuid

ROOT=Path(__file__).resolve().parents[2]
ORIGIN='https://rzmbmwauomzwiyenafha.supabase.co'
PHASES={'health','admin_login','member_login','context','catalog','survey','planning','files','models','scene','tasks','load','restart','after_restart'}
SAFE_CODES={'CHECK_FAILED','AUTH_REJECTED','AUTH_UNAVAILABLE','DB_UNAVAILABLE','FORBIDDEN','UNAUTHORIZED','PROFILE_NOT_SYNCED','PROFILE_DISABLED','NOT_FOUND','INVALID_INPUT','REVISION_CONFLICT','FILE_IN_USE','FILE_UNAVAILABLE','FILE_BUSY','UPLOAD_CONFLICT','UPLOAD_EXPIRED','QUOTA_EXCEEDED','SOURCE_NOT_READY','WORKER_OFFLINE','BRIDGE_UNAVAILABLE','RELEASE_MISMATCH','RESTART_NOT_PROVEN','LOAD_FAILED','TASK_PROOF_REQUIRED','REAL_TASK_DISABLED','TEST_CONTEXT_REQUIRED'}
ALLOWED_ACTIONS={'identity.me','identity.bootstrap','identity.ensureProfile','catalog.listCourses','survey.saveAttributes','survey.getAttributes','planning.listFeatures','planning.acquireLock','planning.releaseLock','planning.saveBatch','models.place','models.bindings','tasks.availability'}
def allowed_probe_action(action):return action in ALLOWED_ACTIONS
class ProbeFailure(RuntimeError):
 def __init__(self,phase,code='CHECK_FAILED',status=None):
  self.phase=phase if phase in PHASES else 'health';self.code=code if code in SAFE_CODES else 'CHECK_FAILED';self.status=status if type(status) is int and 100<=status<=599 else None
  super().__init__('UNIFIED_PROBE_FAILED phase='+self.phase+' code='+self.code+(f' http_status={self.status}' if self.status else ''))
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def synthetic_files():
 png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=')
 data=json.dumps({'asset':{'version':'2.0'}},separators=(',',':')).encode();data+=b' '*((-len(data))%4)
 return struct.pack('<4sIIII',b'glTF',2,20+len(data),len(data),0x4e4f534a)+data,png
def run_probe(api,adminCredentials,memberCredentials,state):
 phase='health';state['complete']=False;started=time.monotonic()
 def checkpoint():getattr(api,'persist',lambda _state:None)(state)
 def request_id(name):return str(uuid.uuid5(uuid.UUID(state['runId']),name))
 def execute(actor,action,input):
  if not allowed_probe_action(action):raise ProbeFailure(phase,'REAL_TASK_DISABLED')
  return api.execute(actor,action,input)
 try:
  health=api.health()
  if state.get('releaseId',health['releaseId'])!=health['releaseId'] or state.get('instanceId',health['instanceId'])!=health['instanceId']:raise ProbeFailure(phase,'RELEASE_MISMATCH')
  state.update(releaseId=health['releaseId'],instanceId=health['instanceId']);state.setdefault('runId',str(uuid.uuid4()));checkpoint()
  phase='admin_login';admin=api.login(adminCredentials);me=execute(admin,'identity.me',{})
  if me.get('role')!='admin':raise ProbeFailure(phase,'FORBIDDEN')
  phase='member_login';member=api.login(memberCredentials);member_me=execute(member,'identity.me',{})
  if admin['userId']==member['userId'] or member_me.get('role')!='student':raise ProbeFailure(phase,'FORBIDDEN')
  actors={'admin':admin['userId'],'member':member['userId']}
  if state.get('actors',actors)!=actors:raise ProbeFailure(phase,'TEST_CONTEXT_REQUIRED')
  state['actors']=actors
  phase='context';context=api.prepare_context(admin['userId'],member['userId'],state.get('context'))
  if not context.get('spaceId','').startswith('unified-test-'):raise ProbeFailure(phase,'TEST_CONTEXT_REQUIRED')
  state['context']=context;target={key:context[key] for key in ['teachingProjectId','villageId','spaceId']};checkpoint()
  phase='catalog';execute(admin,'identity.bootstrap',{});execute(member,'catalog.listCourses',{})
  phase='planning';rows=execute(admin,'planning.listFeatures',{**target,'layerKey':'building'})
  found=next((row for row in rows if row.get('props',{}).get('probeRunId')==state['runId']),None)
  if not found:
   temporary='TEST-'+state['runId'][:12];lease=execute(admin,'planning.acquireLock',{**target,'layerKey':'building','objectCode':temporary})
   if not lease.get('success') or not lease.get('lockToken'):raise ProbeFailure(phase)
   try:execute(admin,'planning.saveBatch',{**target,'requestId':request_id('geometry'),'summary':'Unified TEST geometry','changes':[{'action':'add','layerKey':'building','objectCode':temporary,'objectName':'Unified TEST','afterGeom':{'type':'Polygon','coordinates':[[[113,23],[113.00001,23],[113.00001,23.00001],[113,23]]]},'afterProps':{'probeRunId':state['runId']},'expectedGeometryRevision':0,'lockToken':lease['lockToken']}]})
   finally:execute(admin,'planning.releaseLock',{**target,'layerKey':'building','objectCode':temporary,'lockToken':lease['lockToken']})
   rows=execute(admin,'planning.listFeatures',{**target,'layerKey':'building'});found=next((row for row in rows if row.get('props',{}).get('probeRunId')==state['runId']),None)
  if not found:raise ProbeFailure(phase)
  state['objectCode']=found['object_code'];object_target={**target,'objectCode':state['objectCode'],'objectType':'building'};checkpoint()
  phase='survey';attributes={'probeRunId':state['runId'],'label':'Unified TEST attributes'}
  execute(member,'survey.saveAttributes',{**object_target,'data':attributes,'requestId':request_id('attributes')})
  if execute(member,'survey.getAttributes',object_target)!=attributes:raise ProbeFailure(phase)
  glb,png=synthetic_files();phase='files'
  photo=api.upload(member,'photo',target,{'photo':(png,'image/png','png')},{'objectCode':state['objectCode'],'objectType':'building','surveyLayerKey':'building'},request_id('photo'))
  if api.read_file(member,photo['fileId'])!=png:raise ProbeFailure(phase)
  state['photoFileId']=photo['fileId'];checkpoint()
  phase='models';model=api.upload(admin,'group-model',target,{role:(glb,'model/gltf-binary','glb') for role in ['display','original','low']},{'name':'Unified TEST model','metadata':{'normalized':True,'size':[1,1,1]}},request_id('model'))
  execute(admin,'models.place',{**target,'assetId':model['id'],'objectCode':state['objectCode'],'transform':{'scale':1},'requestId':request_id('place-model')})
  if not any(row.get('asset_id')==model['id'] for row in execute(admin,'models.bindings',target)):raise ProbeFailure(phase)
  state['modelId']=model['id'];checkpoint()
  phase='scene';asset=api.upload_scene(member,'asset',{'courseId':context['courseId'],'groupId':None,'scopeKind':'personal','kind':'model'},glb,{'displayName':'Unified TEST asset','license':'synthetic-test','metadata':{}},request_id('scene-asset'))
  if not state.get('sceneAssetId'):
   shared=api.scene(member,'publishAsset',{'assetId':asset['id']});state['sceneAssetId']=shared['id'];checkpoint()
  else:shared={'id':state['sceneAssetId']}
  if not state.get('projectId'):
   project=api.scene(admin,'create',{**target,'groupId':None,'scopeKind':'admin_sandbox','title':'Unified TEST '+state['runId'][:8],'baselineRevision':0});state['projectId']=project['id'];checkpoint()
  document=api.scene(admin,'load',{'projectId':state['projectId']})
  if document['revision']==0:
   document=copy.deepcopy(document);document['assetRefs']=[shared['id']];document['objects']=[{'id':'unified-test-asset','kind':'asset','category':'bench','layerId':'design','groupId':None,'zIndex':0,'geometry':{'type':'Point','coordinates':[113,23]},'transform':{'headingDeg':0,'pitchDeg':0,'rollDeg':0,'heightOffsetM':0,'scale':[1,1,1]},'properties':{'assetRef':shared['id']}}]
   api.scene(admin,'save',{'document':document});document=api.scene(admin,'load',{'projectId':state['projectId']})
  if document['revision']!=1 or document['assetRefs']!=[shared['id']]:raise ProbeFailure(phase)
  version=api.upload_scene(admin,'version-preview',{'projectId':state['projectId'],'revision':1},png,{'label':'Unified TEST '+state['runId'][:8],'description':'TEST private preview'},request_id('preview'))
  state['versionId']=version['id'];state['document_sha256']=digest(document);checkpoint()
  phase='tasks';proof=api.synthetic_task_proof()
  if proof.get('verified') is not True or proof.get('releaseId')!=state['releaseId']:raise ProbeFailure(phase,'TASK_PROOF_REQUIRED')
  readiness={}
  for kind in ['geoprocessing','facade','cloud-facade']:
   try:
    value=execute(member,'tasks.availability',{'kind':kind});readiness[kind]={'available':value.get('available') is True,'state':value.get('state') if value.get('state') in {'ready','offline','pending','not_ready'} else 'reported'}
   except Exception as e:
    if getattr(e,'code',None) not in {'SOURCE_NOT_READY','WORKER_OFFLINE','BRIDGE_UNAVAILABLE'}:raise
    readiness[kind]={'available':False,'code':e.code}
  phase='load';load=api.load_probe(member)
  if [row.get('concurrency') for row in load]!=[1,5,10,20] or any(row.get('failures')!=0 for row in load):raise ProbeFailure(phase,'LOAD_FAILED')
  resources=api.resource_snapshot();state['load']=load;checkpoint()
  phase='restart';restart=api.restart()
  if restart.get('same_container') is not True or restart.get('started_at_changed') is not True:raise ProbeFailure(phase,'RESTART_NOT_PROVEN')
  phase='after_restart'
  if api.health()!=health:raise ProbeFailure(phase,'RELEASE_MISMATCH')
  if digest(api.scene(admin,'load',{'projectId':state['projectId']}))!=state['document_sha256']:raise ProbeFailure(phase)
  if not any(row['id']==state['versionId'] for row in api.scene(admin,'versions',{'projectId':state['projectId']})):raise ProbeFailure(phase)
  if api.read_file(member,state['photoFileId'])!=png:raise ProbeFailure(phase)
  state['complete']=True;checkpoint()
  return {'status':'internal_validated_not_cut_over','releaseId':state['releaseId'],'instanceId':state['instanceId'],'restart_persistence':True,'ordinary_files_verified_bytes':len(png),'task_submission':'not_executed','synthetic_task_proof':proof,'task_readiness':readiness,'load':load,'resources':resources,'elapsed_ms':round((time.monotonic()-started)*1000)}
 except Exception as e:
  state['complete']=False;checkpoint()
  if isinstance(e,ProbeFailure):raise
  raise ProbeFailure(phase,getattr(e,'code','CHECK_FAILED'),getattr(e,'status',None)) from None

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Redirect refused')
class TransportFailure(RuntimeError):
 def __init__(self,code,status=None):self.code=code if code in SAFE_CODES else 'CHECK_FAILED';self.status=status;super().__init__(self.code)
class HttpApi:
 """Only loopback candidate URLs and fixed source Auth; no generic task submission surface."""
 def __init__(self,base,public_key,*,prepare_context,restart,persist,resources,task_proof):
  url=urllib.parse.urlsplit(base)
  if url.scheme!='http' or url.hostname not in {'127.0.0.1','localhost','::1'} or not url.port or url.path not in {'','/'} or url.query or url.fragment or url.username or url.password:raise ValueError('Loopback API required')
  if not public_key.startswith('sb_publishable_'):raise ValueError('Publishable key required')
  self.base=base.rstrip('/');self.key=public_key;self.prepare_context=prepare_context;self.restart=restart;self.persist=persist;self.resource_snapshot=resources;self.synthetic_task_proof=task_proof
  self.routes=json.loads((ROOT/'linux/unified-operation-routes.json').read_text(encoding='utf-8'))
 def request(self,url,actor=None,*,method='GET',data=None,binary=False,mime=None,timings=None):
  if not url.startswith(self.base+'/') and url!=ORIGIN+'/auth/v1/token?grant_type=password':raise TransportFailure('FORBIDDEN')
  headers={'Cache-Control':'no-store'}
  if actor:headers['Authorization']='Bearer '+actor['token']
  if url.startswith(ORIGIN):headers['apikey']=self.key
  if data is not None:headers['Content-Type']=mime or 'application/json';data=data if isinstance(data,bytes) else json.dumps(data,separators=(',',':')).encode()
  opener=urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()),NoRedirect())
  try:
   with opener.open(urllib.request.Request(url,method=method,headers=headers,data=data),timeout=30) as response:
    if timings is not None:
     header=response.headers.get('Server-Timing','')
     for kind in ['auth','sql','file']:
      match=re.search(r'(?:^|,\s*)'+kind+r';dur=([0-9]+(?:\.[0-9]+)?)',header)
      if not match:raise TransportFailure('CHECK_FAILED')
      timings[kind]=float(match[1])
    limit=50*1024**2 if binary else 2*1024**2;raw=response.read(limit+1)
    if len(raw)>limit:raise TransportFailure('CHECK_FAILED')
    return raw if binary else json.loads(raw)
  except urllib.error.HTTPError as error:
   try:value=json.loads(error.read(2*1024**2));code=value.get('error',{}).get('code')
   except Exception:code='CHECK_FAILED'
   if url.startswith(ORIGIN):code='AUTH_REJECTED' if error.code in {400,401,403} else 'AUTH_UNAVAILABLE'
   raise TransportFailure(code,error.code) from None
  except (OSError,ValueError,urllib.error.URLError):raise TransportFailure('AUTH_UNAVAILABLE' if url.startswith(ORIGIN) else 'DB_UNAVAILABLE') from None
 def health(self):
  value=self.request(self.base+'/healthz');return {key:value[key] for key in ['releaseId','instanceId']}
 def login(self,credentials):
  student,password=credentials;student=student.strip().lower()
  if not re.fullmatch('[a-z0-9_-]{2,32}',student) or not password:raise TransportFailure('AUTH_REJECTED')
  value=self.request(ORIGIN+'/auth/v1/token?grant_type=password',method='POST',data={'email':'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co','password':password})
  if not re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',value.get('user',{}).get('id','')) or not isinstance(value.get('access_token'),str):raise TransportFailure('AUTH_REJECTED')
  return {'userId':value['user']['id'],'token':value['access_token']}
 def execute(self,actor,action,input):
  if not allowed_probe_action(action):raise TransportFailure('REAL_TASK_DISABLED')
  route=self.routes[action];value=self.request(self.base+route['path'],actor,method=route['method'],data=input if route['method']=='POST' else None);return value['data']
 def upload(self,actor,kind,context,files,record,request_id):
  prefix='/api/v1/files';spec={'purpose':kind,'context':context,'requestId':request_id,'files':[{'role':role,'size':len(value[0]),'mime':value[1],'extension':value[2]} for role,value in files.items()]}
  session=self.request(self.base+prefix+'/sessions',actor,method='POST',data=spec)['data']
  if session['state']!='committed':
   for role,value in files.items():self.request(self.base+prefix+'/sessions/'+session['id']+'/'+role,actor,method='PUT',data=value[0],mime='application/octet-stream')
  return self.request(self.base+prefix+'/sessions/'+session['id']+'/commit',actor,method='POST',data=record)['data']
 def read_file(self,actor,file_id,scene=False):
  if not re.fullmatch('[a-f0-9-]{36}',file_id):raise TransportFailure('INVALID_INPUT')
  return self.request(self.base+('/api/v1/scene-files/files/' if scene else '/api/v1/files/')+file_id,actor,binary=True)
 def scene(self,actor,action,input):
  if action not in {'find','create','load','save','versions','restore','branch','submit','publishAsset','copyAsset','assets','components'}:raise TransportFailure('FORBIDDEN')
  return self.request(self.base+'/api/v1/scene-files/scene/'+action,actor,method='POST',data=input)['data']
 def upload_scene(self,actor,purpose,context,raw,record,request_id):
  role='display' if purpose=='asset' else 'preview';mime='model/gltf-binary' if purpose=='asset' else 'image/png';extension='glb' if purpose=='asset' else 'png'
  prefix=self.base+'/api/v1/scene-files/sessions';session=self.request(prefix,actor,method='POST',data={'purpose':purpose,'context':context,'requestId':request_id,'files':[{'role':role,'size':len(raw),'mime':mime,'extension':extension}]})['data']
  if session['state']!='committed':self.request(prefix+'/'+session['id']+'/files/'+role,actor,method='PUT',data=raw,mime=mime)
  return self.request(prefix+'/'+session['id']+'/commit',actor,method='POST',data=record)['data']
 def load_probe(self,actor):
  results=[]
  for concurrency in [1,5,10,20]:
   def sample(_):
    start=time.monotonic();timings={}
    try:self.request(self.base+self.routes['identity.me']['path'],actor,timings=timings);return (time.monotonic()-start)*1000,False,timings
    except Exception:return (time.monotonic()-start)*1000,True,{}
   with ThreadPoolExecutor(max_workers=concurrency) as executor:samples=list(executor.map(sample,range(3*concurrency)))
   def percentile(values,p):
    values=sorted(values);return round(values[max(0,(p*len(values)+99)//100-1)],2) if values else None
   times=[value[0] for value in samples];row={'concurrency':concurrency,'samples':len(samples),'failures':sum(value[1] for value in samples),'p50_ms':percentile(times,50),'p95_ms':percentile(times,95)}
   for kind in ['auth','sql','file']:row[kind+'_p95_ms']=percentile([value[2][kind] for value in samples if kind in value[2]],95)
   results.append(row)
  return results
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--state-dir',type=Path,default=Path.home()/'village-unified-deploy');args=parser.parse_args()
 # The deployment module provides exact container identities, private state IO and TEST-only context preparation.
 path=Path(__file__).with_name('deploy-unified-business.py');spec=importlib.util.spec_from_file_location('unified_deploy',path);deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
 api,state=deploy.probe_environment(args.state_dir)
 admin=(input('Website ADMIN student ID [332]: ').strip() or '332',getpass.getpass('Website ADMIN LOGIN password (hidden): '))
 member=(input('Website MEMBER student ID [25213040]: ').strip() or '25213040',getpass.getpass('Website MEMBER LOGIN password (hidden): '))
 report=run_probe(api,admin,member,state);api.persist_report(report);print(json.dumps(report));print('UNIFIED_INTERNAL_VALIDATED_NOT_CUT_OVER')
if __name__=='__main__':
 try:main()
 except ProbeFailure as e:print('STOP: '+str(e));raise SystemExit(1)
 except Exception:print('STOP: UNIFIED_PROBE_FAILED phase=health code=CHECK_FAILED');raise SystemExit(1)
