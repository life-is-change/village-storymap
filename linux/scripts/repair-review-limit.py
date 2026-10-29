#!/usr/bin/env python3
"""Expand only the initial whole-village review contract, preserving live API overlays."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
STATE=Path('/home/admin/village-autonomous/files/review-init-limit-20261029-v1')
TARGET='/opt/village/business-api/unified/contracts.mjs'
OLD="['initializeReviews',{...context,datasetId:uuid,items:list(json),...replay}"
NEW="['initializeReviews',{...context,datasetId:uuid,items:list(json,20000,1),...replay}"
def run(*args):return subprocess.check_output(['docker',*args],text=True)
def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');a=p.parse_args()
    row=json.loads(run('inspect','village-autonomous-api'))[0]
    mounts=[m for m in row['Mounts'] if m['Destination']==TARGET]
    assert len(mounts)==1 and not mounts[0]['RW'],'EXPECTED_CONTRACT_OVERLAY_REQUIRED'
    path=Path(mounts[0]['Source']);assert path.resolve().is_relative_to(Path('/home/admin/village-autonomous/files')) and not path.is_symlink()
    original=path.read_bytes();text=original.decode()
    if NEW in text and OLD not in text:
        print(json.dumps({'status':'review_limit_already_present'}));return
    assert text.count(OLD)==1 and NEW not in text,'UNKNOWN_API_CONTRACT_BASELINE'
    if not a.apply:print(json.dumps({'status':'review_limit_preflight_passed'}));return
    os.umask(0o077);STATE.mkdir(parents=True,exist_ok=True)
    backup=STATE/'original-contracts.mjs'
    if backup.exists():assert backup.read_bytes()==original,'BACKUP_CHANGED'
    else:backup.write_bytes(original);backup.chmod(0o600)
    updated=text.replace(OLD,NEW,1).encode()
    assert path.read_bytes()==original,'API_CONTRACT_CHANGED'
    try:
        # A single-file bind retains its inode; preserve it while replacing contents.
        with path.open('r+b') as stream:stream.write(updated);stream.truncate();stream.flush();os.fsync(stream.fileno())
        run('exec','village-autonomous-api','node','--check',TARGET)
        run('restart','--time','20','village-autonomous-api')
        for attempt in range(30):
            result=subprocess.run(['docker','exec','village-autonomous-api','node','-e',"fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],capture_output=True)
            if result.returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('API_HEALTH_CHECK_FAILED')
        after=json.loads(run('inspect','village-autonomous-api'))[0]
        assert after['Id']==row['Id'] and after['Image']==row['Image'],'API_IDENTITY_CHANGED'
        (STATE/'receipt.json').write_text(json.dumps({'status':'complete','container':row['Id'],'before':hashlib.sha256(original).hexdigest(),'after':hashlib.sha256(updated).hexdigest()}))
        print(json.dumps({'status':'review_limit_updated','edit_batch_limit_unchanged':True}))
    except Exception:
        if path.read_bytes()==updated:
            with path.open('r+b') as stream:stream.write(original);stream.truncate();stream.flush();os.fsync(stream.fileno())
            run('restart','--time','20','village-autonomous-api')
        raise
if __name__=='__main__':main()
