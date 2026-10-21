import importlib.util,copy
from pathlib import Path
import pytest
S=Path(__file__).resolve().parents[1]/'scripts/probe-unified-business.py'
def module():
 assert S.is_file(),'consolidated probe missing'
 spec=importlib.util.spec_from_file_location('unified_probe',S);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
class FakeApi:
 def __init__(self):self.calls=[];self.logins=[];self.files={};self.documents={};self.version=None;self.fail=None;self.restarts=0
 def health(self):return {'releaseId':'release-test','instanceId':'aliyun-test'}
 def login(self,credentials):self.logins.append(credentials[0]);return {'userId':credentials[0],'role':'admin' if credentials[0]=='admin' else 'student'}
 def prepare_context(self,admin,member,state):return {'teachingProjectId':'project','villageId':'village','spaceId':'unified-test-space','courseId':'TEST-course','groupId':'TEST-group'}
 def execute(self,actor,action,input):
  self.calls.append((action,copy.deepcopy(input)))
  if action==self.fail:raise RuntimeError('private-password SQL business row')
  if action=='identity.me':return {'id':actor['userId'],'role':actor['role']}
  if action=='identity.bootstrap':return {'courses':[],'spaces':[]}
  if action=='planning.listFeatures':return [self.feature] if hasattr(self,'feature') else []
  if action=='planning.saveBatch':self.feature={'object_code':'TEST-building','geometry_revision':1,'props':input['changes'][0]['afterProps']};return {}
  if action=='planning.acquireLock':return {'success':True,'lockToken':'lease'}
  if action=='survey.getAttributes':return copy.deepcopy(self.attribute)
  if action=='survey.saveAttributes':self.attribute=input['data'];return input['data']
  if action=='models.bindings':return [{'asset_id':'model'}]
  if action=='tasks.availability':return {'available':False,'state':'not_ready'}
  return {}
 def upload(self,actor,kind,context,files,record,request_id):
  self.calls.append(('upload:'+kind,{'requestId':request_id}));key='model' if kind=='group-model' else 'photo';self.files[key]=next(iter(files.values()))[0];return {'id':key,'fileId':key}
 def read_file(self,actor,file_id,scene=False):return self.files[file_id]
 def scene(self,actor,action,input):
  self.calls.append(('scene:'+action,copy.deepcopy(input)))
  if action=='create':self.documents['scene']={'projectId':'scene','revision':0,'objects':[],'assetRefs':[],'baselineRef':{'revision':0}};return {'id':'scene'}
  if action=='load':return copy.deepcopy(self.documents[input['projectId']])
  if action=='save':self.documents['scene']={**input['document'],'revision':1};return self.documents['scene']
  if action=='versions':return [{'id':'version'}] if self.version else []
  return {'id':'scene-asset'}
 def upload_scene(self,actor,purpose,context,raw,record,request_id):
  if purpose=='version-preview':self.version='version';return {'id':'version'}
  return {'id':'scene-asset'}
 def synthetic_task_proof(self):return {'verified':True,'releaseId':'release-test'}
 def restart(self):self.restarts+=1;return {'same_container':True,'started_at_changed':True}
 def load_probe(self,actor,**_):return [{'concurrency':n,'samples':n,'failures':0,'p50_ms':1,'p95_ms':2,'auth_ms':1,'sql_ms':1,'file_ms':0} for n in [1,5,10,20]]
 def resource_snapshot(self):return {'available_bytes':1024**3,'api_peak_bytes':40*1024**2}
def test_one_credentials_entry_covers_reads_writes_files_versions_restart_and_never_real_tasks():
 m=module();api=FakeApi();state={};report=m.run_probe(api,('admin','password'),('member','password'),state)
 assert report['status']=='internal_validated_not_cut_over';assert report['restart_persistence'] is True
 assert api.logins==['admin','member'];assert api.restarts==1
 assert not any(action.startswith('tasks.submit') for action,_ in api.calls)
 assert 'password' not in str(state);assert state['complete'] is True
 ids=[body['requestId'] for action,body in api.calls if action=='upload:photo'];api.calls=[]
 m.run_probe(api,('admin','password'),('member','password'),state)
 assert [body['requestId'] for action,body in api.calls if action=='upload:photo']==ids
 assert len(api.documents)==1
def test_partial_failure_has_precise_safe_phase_and_no_complete_marker():
 m=module();api=FakeApi();api.fail='survey.getAttributes';state={}
 with pytest.raises(m.ProbeFailure,match='phase=survey') as error:m.run_probe(api,('admin','secret'),('member','secret'),state)
 assert state['complete'] is False;assert 'private-password' not in str(error.value);assert api.restarts==0
def test_changed_release_and_failed_restart_never_pass():
 m=module();api=FakeApi();state={'releaseId':'other'}
 with pytest.raises(m.ProbeFailure,match='phase=health'):m.run_probe(api,('admin','secret'),('member','secret'),state)
 assert api.logins==[]
 state={};api.restart=lambda:{'same_container':True,'started_at_changed':False}
 with pytest.raises(m.ProbeFailure,match='phase=restart'):m.run_probe(api,('admin','secret'),('member','secret'),state)
 assert state['complete'] is False
def test_probe_transport_rejects_real_task_submissions_before_network():
 m=module();assert m.allowed_probe_action('tasks.submitGeo') is False;assert m.allowed_probe_action('tasks.submitFacade') is False
 assert m.allowed_probe_action('identity.me') is True

def test_load_report_captures_per_request_server_timing_without_tokens():
 from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
 from threading import Thread
 class Handler(BaseHTTPRequestHandler):
  def do_GET(self):
   self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Server-Timing','auth;dur=4.5, sql;dur=2.25, file;dur=0');self.end_headers();self.wfile.write(b'{"data":{"id":"synthetic"}}')
  def log_message(self,*_):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
 try:
  api=module().HttpApi('http://127.0.0.1:'+str(server.server_port),'sb_publishable_synthetic',prepare_context=None,restart=None,persist=None,resources=None,task_proof=None)
  report=api.load_probe({'token':'private-test-token'})
  assert [row['concurrency'] for row in report]==[1,5,10,20]
  assert all(row['samples']>=3*row['concurrency'] and row['failures']==0 and row['auth_p95_ms']==4.5 and row['sql_p95_ms']==2.25 for row in report)
  assert 'private-test-token' not in str(report)
 finally:server.shutdown();server.server_close();thread.join()

def test_load_failure_counts_retain_only_allowlisted_categories_not_exception_details():
 m=module();api=m.HttpApi('http://127.0.0.1:18088','sb_publishable_fixture',prepare_context=None,restart=None,persist=None,resources=None,task_proof=None)
 def failed(*args,**kwargs):raise m.TransportFailure('FILE_BUSY',503)
 api.request=failed;rows=api.load_probe({'token':'never-print'})
 assert all(row['failure_categories']=={'FILE_BUSY:503':row['samples']} for row in rows)
 def private(*args,**kwargs):raise RuntimeError('private-password private-row')
 api.request=private;rows=api.load_probe({'token':'never-print'})
 assert all(row['failure_categories']=={'CHECK_FAILED':row['samples']} for row in rows)
 assert 'private' not in str(rows) and 'never-print' not in str(rows)
