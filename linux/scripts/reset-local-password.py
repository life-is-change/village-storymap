#!/usr/bin/env python3
"""Hidden-input, administrator-reauthenticated private local password recovery."""
import argparse
import getpass
import json
import os
from pathlib import Path
import warnings
import contextlib
from uuid import uuid4
import business_storage_copy as storage
from autonomous_operator import Docker,API,verified_runtime,operation_lock
from autonomous_private_ops import recovery_command,uuid


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--reconcile',metavar='PREVIOUS_REQUEST_UUID');args=parser.parse_args()
    stack=contextlib.ExitStack()
    try:
        os.umask(0o077);state=Path.home()/'village-autonomous';stack.enter_context(operation_lock(state))
        docker=Docker(state);meta,network=verified_runtime(docker,state)
        request=args.reconcile or str(uuid4())
        if not uuid(request):raise ValueError('INVALID_RECOVERY_REQUEST')
        for name in ('api-password','auth-jwt'):storage.private_path(state/'secrets'/name)
        print('Recovery request: '+request,flush=True)
        with warnings.catch_warnings():
            warnings.simplefilter('error',getpass.GetPassWarning)
            admin=input('Website ADMIN student ID: ').strip();password=getpass.getpass('Website ADMIN login password (hidden): ')
            target=input('NON-ADMIN target student ID: ').strip();new=getpass.getpass('Target NEW login password (hidden): ')
            if getpass.getpass('Repeat NEW login password (hidden): ')!=new:raise ValueError('PASSWORD_CONFIRMATION_DIFFERS')
        payload={'adminStudentId':admin,'adminPassword':password,'targetStudentId':target,'newPassword':new,'requestId':request,'reconcile':bool(args.reconcile)}
        command=recovery_command(meta,state,network,image=docker.own_container(API,meta['releaseId'])['Image'],uid=os.geteuid(),gid=os.getegid())
        result=json.loads(docker.run(*command,input=json.dumps(payload)))
        payload.clear();password=new=None
        if result!={'status':'local_password_reset_completed','accounts':1}:raise ValueError('RECOVERY_NOT_COMPLETED')
        print('LOCAL_PASSWORD_RECOVERY_COMPLETED_SESSIONS_REVOKED');return 0
    except (OSError,ValueError,RuntimeError,EOFError,getpass.GetPassWarning):
        print('STOP: PRIVATE_LOCAL_RECOVERY_FAILED. Keep the request UUID for reconciliation; do not paste secrets or retry with a new UUID after an unknown result.');return 1
    finally:stack.close()


if __name__=='__main__':raise SystemExit(main())
