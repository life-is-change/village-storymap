"""Guarded, persistent correction of the proportional-height validation path."""
import base64,hashlib,json,os,pathlib,subprocess,zlib,time
payload=json.loads(zlib.decompress(base64.b64decode('PAYLOAD_PLACEHOLDER')))
home=pathlib.Path.home();stage=home/'village-campus-autonomous/photo-height-repair-20261105'
compose=home/'village-campus-autonomous/recovery-20261105/compose.json'
container='village-platform-facade-worker-1';target='/opt/village-components/rural_house_generator/backend/component_building/'
run=lambda args,**kw:subprocess.run(args,check=True,**kw)
read=lambda args:subprocess.check_output(args)
sha=lambda b:hashlib.sha256(b).hexdigest()
assert compose.is_file(),'RECOVERY_COMPOSE_MISSING'
assert not (stage/'receipt.json').exists(),'ALREADY_APPLIED'
old_compose=compose.read_bytes();config=json.loads(old_compose)
networks=config['services']['facade-worker'].get('networks',{})
if isinstance(networks,list):networks={name:{} for name in networks}
assert isinstance(networks,dict),'UNSUPPORTED_NETWORK_FORMAT'
assert config['networks']['egress'].get('name')=='village-platform_egress','EGRESS_NETWORK_CHANGED'
assert config['networks']['facade-internal'].get('name')=='village-platform_facade-internal','INTERNAL_NETWORK_CHANGED'
networks['egress']=networks.get('egress') or {}
networks.setdefault('egress',{})['priority']=100
networks.setdefault('facade-internal',{})
config['services']['facade-worker']['networks']=networks
info=json.loads(read(['docker','inspect',container]))[0]
assert info['State']['Running'],'WORKER_NOT_RUNNING'
assert info['Config']['Image']==config['services']['facade-worker']['image'],'WORKER_CONFIG_IMAGE_MISMATCH'
before={};patched={}
for name,spec in payload.items():
 raw=read(['docker','exec',container,'cat',target+name]);before[name]=raw
 text=raw.replace(b'\r\n',b'\n').decode()
 for old,new in spec['edits']:
  assert text.count(old)==1,'WORKER_SCALE_ANCHOR_CHANGED:'+name
  text=text.replace(old,new,1)
 compile(text,target+name,'exec');patched[name]=text.encode()
stage.mkdir(mode=0o700,parents=True,exist_ok=True)
(stage/'compose.before.json').write_bytes(old_compose);(stage/'compose.before.json').chmod(0o600)
volumes=config['services']['facade-worker'].setdefault('volumes',[])
assert isinstance(volumes,list),'UNSUPPORTED_VOLUME_FORMAT'
for name,spec in payload.items():
 backup=stage/'backup'/name;backup.parent.mkdir(parents=True,exist_ok=True);backup.write_bytes(before[name])
 path=stage/'code'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(patched[name]);path.chmod(0o644)
 destination=target+name
 volumes[:]=[v for v in volumes if (v.get('target') if isinstance(v,dict) else v.split(':')[1])!=destination]
 volumes.append({'type':'bind','source':str(path),'target':destination,'read_only':True})
candidate=stage/'compose.pending.json';candidate.write_text(json.dumps(config));candidate.chmod(0o600)
def recreate():
 # Attach both approved networks while stopped, before the health gate runs.
 run(['docker','compose','--project-name','village-platform','-f',str(compose),'up','--no-start','--no-deps','--no-build','--pull','never','--force-recreate','facade-worker'])
 row=json.loads(read(['docker','inspect',container]))[0]
 for name in ('village-platform_egress','village-platform_facade-internal'):
  if name not in row['NetworkSettings']['Networks']:run(['docker','network','connect','--alias','facade-worker',name,container])
 run(['docker','start',container])

def wait_ready():
 stable=None;last_pid=None
 for _ in range(45):
  row=json.loads(read(['docker','inspect',container]))[0];state=row['State'];pid=state.get('Pid')
  if state.get('Running') and not state.get('Restarting') and pid and row.get('RestartCount',0)==0:
   if stable is None or pid!=last_pid:stable=time.monotonic()
   if time.monotonic()-stable>=6:
    run(['docker','exec',container,'python','-c','from village_processing.health import run_facade_health_checks; raise SystemExit(run_facade_health_checks())'])
    return
  else:stable=None
  last_pid=pid;time.sleep(1)
 raise RuntimeError('WORKER_STARTUP_NOT_STABLE')
run(['docker','compose','--project-name','village-platform','-f',str(candidate),'config','--quiet'])
try:
 assert compose.read_bytes()==old_compose,'COMPOSE_CHANGED'
 os.replace(candidate,compose);recreate();wait_ready()
 probe="from PIL import Image; from pathlib import Path; import tempfile; from rural_house_generator.backend.component_building.adapter import build_spec; from rural_house_generator.backend.component_building.app.domain import floor_height; p=Path(tempfile.mkdtemp(prefix='height-smoke-')); f=p/'front.png'; Image.new('RGB',(641,641)).save(f); a={'feature_version':3,'building_box':[.10048475577939134,.13426178740264844,.8992389553980596,.9513150838533542],'detections':[{'kind':'roof','box':[.09961351701138359,.131245260491572,.9006101992126561,.2268871956050117],'score':.4497},{'kind':'window','box':[.2181120588,.2712314028,.3574441086,.3873533585],'score':.7541}]}; s=build_spec(f,a,{'buildingWidth':18.936,'buildingDepth':11.652,'modelPurpose':'design','floors':3})['spec']; assert abs(s['floor_height']-5.724650753393884)<1e-8; assert abs(s['metrics']['wall_height']-17.17395226018165)<1e-8; print('PHOTO_SCALE_17_17M_WARNING_SMOKE_OK')"
 run(['docker','exec',container,'python','-c',probe])
 (stage/'receipt.json').write_text(json.dumps({'status':'applied','files':{n:sha(b) for n,b in patched.items()}}))
 print('PHOTO_HEIGHT_REPAIR_APPLIED_AND_PERSISTED')
except Exception:
 compose.write_bytes(old_compose);compose.chmod(0o600);recreate()
 print('PHOTO_HEIGHT_REPAIR_ROLLED_BACK');raise
