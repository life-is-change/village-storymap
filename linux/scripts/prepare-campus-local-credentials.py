#!/usr/bin/env python3
"""Keep private Worker keys on campus; export only public enrollment digests."""
import base64
import json
import os
from pathlib import Path
import sys
import tarfile
sys.dont_write_bytecode=True
from campus_worker_source import verify
import business_storage_copy as storage
from autonomous_bundle import load_script


def prepare(root):
    root=storage.private_path(root,directory=True)
    provision=load_script('provision-local-workers')
    records=[provision.credential(root,kind) for kind in ('geo','facade')]
    names=['aliyun-'+kind+ext for kind in ('geo','facade') for ext in ('.key','.json')]
    bundle=root/'worker-credentials.tar.gz'
    if not bundle.exists():
        with os.fdopen(os.open(bundle,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output,tarfile.open(fileobj=output,mode='w:gz') as tar:
            for name in names:tar.add(storage.private_path(root/name),arcname=name,recursive=False)
    else:
        with tarfile.open(storage.private_path(bundle),'r:gz') as tar:
            members=tar.getmembers()
            if len(members)!=4 or {m.name for m in members}!=set(names) or any(not m.isfile() or m.size>4096 for m in members):raise ValueError('LOCAL_WORKER_BUNDLE_CHANGED')
            for member in members:
                if tar.extractfile(member).read()!=storage.private_path(root/member.name).read_bytes():raise ValueError('LOCAL_WORKER_BUNDLE_CHANGED')
    public={'version':1,'instanceId':'aliyun-village','workers':[{k:r[k] for k in ('id','digest','kind')} for r in records]}
    return base64.urlsafe_b64encode(json.dumps(public,sort_keys=True,separators=(',',':')).encode()).decode().rstrip('=')


def main():
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('CAMPUS_NON_ROOT_REQUIRED')
        verify(Path(__file__).resolve().parents[2]);os.umask(0o077)
        root=Path.home()/'village-campus-local-keys';root.mkdir(mode=0o700,exist_ok=True)
        print('PUBLIC_WORKER_REGISTRATION='+prepare(root))
        print('PRIVATE_KEYS_RETAINED_ON_CAMPUS_NOT_REGISTERED')
        print('Private bundle: '+str(root/'worker-credentials.tar.gz'));return 0
    except (OSError,ValueError,RuntimeError,tarfile.TarError):
        print('STOP: CAMPUS_LOCAL_KEYS_FAILED. Retain private files; do not regenerate or paste keys.');return 1


if __name__=='__main__':raise SystemExit(main())
