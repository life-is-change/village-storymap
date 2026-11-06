import base64,hashlib,json,os,pathlib,subprocess,time,urllib.request,zlib
payload=json.loads(zlib.decompress(base64.b64decode('PAYLOAD_PLACEHOLDER')))
home=pathlib.Path.home();stage=home/'generation-repair-20261105';root=home/'village-autonomous/files/semester-groups-20261028-v1/web';compose=home/'village-autonomous/compose.json'
stage.mkdir(mode=0o700,exist_ok=True)
assert not (stage/'receipt.json').exists(),'ALREADY_APPLIED'
sha=lambda b:hashlib.sha256(b).hexdigest()
run=lambda args,**kw:subprocess.run(args,check=True,**kw)
def put(p,b):
 p.parent.mkdir(parents=True,exist_ok=True);t=p.with_name(p.name+'.repair-pending');t.write_bytes(b);t.chmod(0o644);os.replace(t,p)
run(['sudo','-n','true'])
before={};after={};api_name='business-api/unified/files.mjs'
for name,spec in payload.items():
 raw=subprocess.check_output(['sudo','-n','docker','exec','village-autonomous-api','cat','/opt/village/'+name]) if name==api_name else (root/name).read_bytes()
 before[name]=raw;normalized=raw.replace(b'\r\n',b'\n');assert sha(normalized)==spec['before'],'LIVE_CHANGED:'+name
 if 'content' in spec:data=base64.b64decode(spec['content'])
 else:
  lines=normalized.decode().splitlines(True)
  for i,j,replacement in reversed(spec['edits']):lines[i:j]=replacement
  data=''.join(lines).encode()
 assert sha(data)==spec['after'],'PAYLOAD_INVALID:'+name
 after[name]=data
old_compose=compose.read_bytes();config=json.loads(old_compose);api_path=stage/'files.mjs';destination='/opt/village/'+api_name
volumes=config['services']['api'].setdefault('volumes',[])
assert all((v.get('target') if isinstance(v,dict) else v.split(':')[1])!=destination for v in volumes),'API_MOUNT_CHANGED'
volumes.append({'type':'bind','source':str(api_path),'target':destination,'read_only':True})
backup=stage/'backup';backup.mkdir(mode=0o700,exist_ok=True)
for name,b in before.items():put(backup/name,b)
(backup/'compose.json').write_bytes(old_compose);(backup/'compose.json').chmod(0o600)
put(api_path,after[api_name]);candidate=stage/'compose.pending.json';candidate.write_text(json.dumps(config));candidate.chmod(0o600)
run(['sudo','-n','docker','compose','-f',str(candidate),'config','--quiet'])
recreate=['sudo','-n','docker','compose','-f',str(compose),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','api']
try:
 assert compose.read_bytes()==old_compose,'COMPOSE_CHANGED';os.replace(candidate,compose)
 run(recreate)
 run(['sudo','-n','docker','exec','village-autonomous-api','node','--check',destination])
 for name in sorted(after,key=lambda n:n=='index.html'):
  if name==api_name:continue
  assert (root/name).read_bytes()==before[name],'CONCURRENT_CHANGE:'+name
  put(root/name,after[name])
 for name,data in after.items():
  if name==api_name:continue
  with urllib.request.urlopen('https://8.148.248.237/'+name+'?release=20261105-processing-repair',timeout=25) as r:assert r.read().replace(b'\r\n',b'\n')==data,'HTTPS_MISMATCH:'+name
 for attempt in range(15):
  status=subprocess.check_output(['sudo','-n','docker','inspect','-f','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}','village-autonomous-api']).decode().strip()
  if status=='healthy':break
  time.sleep(2)
 assert status=='healthy','API_UNHEALTHY:'+status
 (stage/'receipt.json').write_text(json.dumps({'status':'live','files':{n:sha(v) for n,v in after.items()}}))
 print('GENERATION_REPAIR_PRODUCTION_OK',len(after),'API_HEALTHY')
except Exception:
 for name,b in before.items():
  if name!=api_name:put(root/name,b)
 compose.write_bytes(old_compose);compose.chmod(0o600);run(recreate)
 print('ROLLED_BACK');raise
