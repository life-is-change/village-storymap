"""Build a guarded, reversible patch against the inspected public deployment."""
import base64,difflib,hashlib,json,pathlib,subprocess,zlib
root=pathlib.Path(__file__).resolve().parent.parent
stage=root/'tmp/generation-repair-release'
sha=lambda b:hashlib.sha256(b).hexdigest()
payload={}
for old in stage.rglob('*'):
 if not old.is_file() or old.suffix not in ('.html','.js','.css'):continue
 name=old.relative_to(stage).as_posix(); before=old.read_bytes().replace(b'\r\n',b'\n'); after=(root/name).read_bytes().replace(b'\r\n',b'\n')
 if before==after:continue
 a=before.decode().splitlines(True); b=after.decode().splitlines(True)
 payload[name]={'before':sha(before),'after':sha(after),'edits':[[i,j,b[x:y]] for op,i,j,x,y in difflib.SequenceMatcher(None,a,b,autojunk=False).get_opcodes() if op!='equal']}
name='business-api/unified/files.mjs';before=subprocess.check_output(['git','show','HEAD:'+name],cwd=root);after=(root/name).read_bytes().replace(b'\r\n',b'\n')
payload[name]={'before':sha(before),'after':sha(after),'content':base64.b64encode(after).decode()}
packed=base64.b64encode(zlib.compress(json.dumps(payload,ensure_ascii=False).encode())).decode()
template=(root/'tools/generation-repair-deploy.py').read_text(encoding='utf-8')
script=template.replace('PAYLOAD_PLACEHOLDER',packed)
(stage/'deploy.py').write_text(script,encoding='utf-8')
(stage/'command.txt').write_text("python3 -c \"import base64,zlib;exec(zlib.decompress(base64.b64decode('"+base64.b64encode(zlib.compress(script.encode())).decode()+"')))\"",encoding='utf-8')
print('REPAIR_PACKAGE',len(payload),'files; command bytes', (stage/'command.txt').stat().st_size)
