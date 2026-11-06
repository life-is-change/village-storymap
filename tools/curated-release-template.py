#!/usr/bin/env python3
"""Fixed-payload frontend release; baseline check, backup, automatic rollback."""
import argparse,base64,concurrent.futures,hashlib,json,os,subprocess,urllib.request,zlib
from pathlib import Path

MANIFEST = None  # BUILD_PAYLOAD
STATE=Path.home()/'curated-scene-assets-20261105'
def digest(data): return hashlib.sha256(data).hexdigest()
def atomic(path,data,mode=0o644):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.curated-pending')
    with temp.open('xb') as f: f.write(data);f.flush();os.fsync(f.fileno())
    temp.chmod(mode);os.replace(temp,path)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    web=json.loads(subprocess.check_output(['sudo','-n','docker','inspect','village-autonomous-web']))[0]
    mounts=[m for m in web['Mounts'] if m['Destination']=='/srv/village-web']
    assert len(mounts)==1 and mounts[0]['RW'] is False,'UNEXPECTED_MOUNT'
    root=Path(mounts[0]['Source']).resolve()
    assert root.is_relative_to(Path('/home/admin/village-autonomous/files')),'UNEXPECTED_ROOT'
    before={};after={}
    for name,spec in MANIFEST.items():
        p=root/name;assert p.resolve().is_relative_to(root) and not p.is_symlink(),'INVALID_PATH'
        before[name]=p.read_bytes() if p.exists() else None
        current=digest(before[name]) if before[name] is not None else None
        assert current in (spec['before'],spec['after']),'LIVE_CHANGED:'+name
        after[name]=base64.b64decode(spec['data']);assert digest(after[name])==spec['after'],'BAD_PAYLOAD'
    if not args.apply:
        print(json.dumps({'status':'preflight_passed','files':len(after),'root':str(root)}));return
    os.umask(0o077);STATE.mkdir(exist_ok=True)
    receipt=STATE/'receipt.json'
    if receipt.exists():
        assert all((root/n).read_bytes()==data for n,data in after.items()),'DEPLOYED_CHANGED'
        print('ALREADY_DEPLOYED');return
    changed=[]
    try:
        for name,data in before.items():
            backup=STATE/'backup'/name
            if data is not None:
                if backup.exists(): assert backup.read_bytes()==data,'BACKUP_CHANGED'
                else: atomic(backup,data,0o600)
        atomic(STATE/'before.json',json.dumps({n:{'existed':b is not None,'sha256':digest(b) if b is not None else None} for n,b in before.items()}).encode(),0o600)
        for name in sorted(after,key=lambda n:(n=='index.html',n)):
            p=root/name;assert (p.read_bytes() if p.exists() else None)==before[name],'CONCURRENT_CHANGE:'+name
            if before[name]!=after[name]:atomic(p,after[name]);changed.append(name)
        def verify(item):
            name,data=item
            assert (root/name).read_bytes()==data,'FILE_MISMATCH:'+name
            with urllib.request.urlopen('https://8.148.248.237/'+name+'?release=20261105-curated',timeout=30) as response:
                assert response.read()==data,'HTTPS_MISMATCH:'+name
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(verify,after.items()))
        atomic(receipt,json.dumps({'status':'complete','files':{n:digest(b) for n,b in after.items()},'web_root':str(root),'service_restarts':0}).encode(),0o600)
        print(json.dumps({'status':'deployed','files':len(after),'changed':len(changed),'https_verified':len(after),'backup':str(STATE),'service_restarts':0}))
    except Exception:
        for name in reversed(changed):
            p=root/name
            if p.read_bytes()==after[name]:
                if before[name] is None:p.unlink()
                else:atomic(p,before[name])
        raise
if __name__=='__main__':main()
