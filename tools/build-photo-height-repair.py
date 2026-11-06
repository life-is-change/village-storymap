"""Package the four reviewed Worker files without credentials or environment data."""
import base64,hashlib,json,pathlib,subprocess,zlib,difflib
root=pathlib.Path(__file__).resolve().parent.parent
names=['adapter.py','app/domain.py','app/facade.py','vision/facade.py']
payload={}
for name in names:
 path='rural_house_generator/backend/component_building/'+name
 old=subprocess.check_output(['git','show','HEAD:'+path],cwd=root).replace(b'\r\n',b'\n')
 new=(root/path).read_bytes().replace(b'\r\n',b'\n')
 a=old.decode().splitlines(True);b=new.decode().splitlines(True);edits=[]
 for op,i,j,x,y in difflib.SequenceMatcher(None,a,b,autojunk=False).get_opcodes():
  if op=='equal':continue
  # Restrict the adapter update to scale handling. Its live footprint policy
  # predates main and must remain untouched.
  before=''.join(a[i:j]);after=''.join(b[x:y])
  if not before:
   assert i>0
   before=a[i-1];after=before+after
  edits.append([before,after])
 payload[name]={'edits':edits}
script=(root/'tools/photo-height-worker-repair.py').read_text(encoding='utf-8').replace('PAYLOAD_PLACEHOLDER',base64.b64encode(zlib.compress(json.dumps(payload).encode())).decode())
stage=root/'tmp/photo-height-repair';stage.mkdir(exist_ok=True)
(stage/'repair.py').write_text(script,encoding='utf-8')
print('PHOTO_HEIGHT_PACKAGE',len(payload),'files',len(script),'bytes',hashlib.sha256(script.encode()).hexdigest())
