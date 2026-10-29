#!/usr/bin/env python3
"""Apply only reviewed frontend fragments to the observed web mount, with rollback."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

FILES={'index.html','app.js','style.css','features/survey/survey-review-model.js','features/3d/reality-inset.js'}
STATE=Path('/home/admin/village-autonomous/files/object-details-reality-20261029-v1')

def digest(data):return hashlib.sha256(data).hexdigest()
def docker(*args):return subprocess.check_output(['docker',*args],text=True)
def atomic(path,data,mode=0o644):
    temp=path.with_name(path.name+'.shenjing-pending')
    with temp.open('xb') as stream:
        stream.write(data);stream.flush();os.fsync(stream.fileno())
    temp.chmod(mode);os.replace(temp,path)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    manifest=json.loads((Path(__file__).parents[1]/'shenjing-workspace-web-edits.json').read_text())
    assert set(manifest)==FILES,'UNEXPECTED_PATCH_SCOPE'
    web=json.loads(docker('inspect','village-autonomous-web'))[0]
    mounts=[m for m in web['Mounts'] if m['Destination']=='/srv/village-web']
    assert len(mounts)==1 and mounts[0]['RW'] is False,'EXPECTED_READ_ONLY_WEB_MOUNT'
    root=Path(mounts[0]['Source'])
    assert root.is_absolute() and root.resolve().is_relative_to(Path('/home/admin/village-autonomous/files')),'UNEXPECTED_WEB_ROOT'
    before={};after={}
    for name,edits in manifest.items():
        path=root/name
        assert path.resolve().is_relative_to(root.resolve()) and not path.is_symlink(),'INVALID_FILE'
        before[name]=path.read_bytes();text=before[name].decode().replace('\r\n','\n')
        for edit in edits:
            old,new=edit['before'],edit['after']
            if text.count(old)==1:text=text.replace(old,new,1)
            elif text.count(old)==0 and text.count(new)==1:continue
            else:raise ValueError('UNKNOWN_LIVE_BASELINE_'+name)
        after[name]=text.encode()
    if not args.apply:
        print(json.dumps({'status':'frontend_preflight_passed','files':sorted(FILES),'web_container':web['Id']}));return
    os.umask(0o077);STATE.mkdir(parents=True,exist_ok=True)
    receipt=STATE/'receipt.json'
    if receipt.exists():
        saved=json.loads(receipt.read_text())
        assert saved['after']=={n:digest((root/n).read_bytes()) for n in FILES},'DEPLOYED_FILES_CHANGED'
        print(json.dumps({'status':'frontend_already_verified'}));return
    changed=[]
    try:
        for name in sorted(FILES):
            backup=STATE/name;backup.parent.mkdir(parents=True,exist_ok=True)
            if backup.exists():assert backup.read_bytes()==before[name],'BACKUP_CHANGED'
            else:atomic(backup,before[name],0o600)
        for name in sorted(FILES):
            assert (root/name).read_bytes()==before[name],'LIVE_FILE_CHANGED'
            if before[name]!=after[name]:atomic(root/name,after[name]);changed.append(name)
        assert json.loads(docker('inspect','village-autonomous-web'))[0]['Id']==web['Id'],'WEB_REPLACED'
        for name in FILES:
            served=subprocess.check_output(['docker','exec','village-autonomous-web','cat','/srv/village-web/'+name])
            assert served==after[name],'MOUNT_NOT_UPDATED'
        atomic(receipt,json.dumps({'status':'complete','web_root':str(root),'web_container':web['Id'],
            'before':{n:digest(v) for n,v in before.items()},'after':{n:digest(v) for n,v in after.items()}},indent=2).encode(),0o600)
        print(json.dumps({'status':'frontend_deployed','files':len(FILES),'service_restarts':0}))
    except Exception:
        for name in changed:
            if (root/name).read_bytes()==after[name]:atomic(root/name,before[name])
        raise

if __name__=='__main__':main()
