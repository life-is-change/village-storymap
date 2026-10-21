#!/usr/bin/env python3
"""Private owner reconciliation and expired-upload chunk maintenance."""
import argparse
import json
import os
import contextlib
from pathlib import Path
import business_storage_copy as storage
from autonomous_operator import Docker,verified_runtime,operation_lock
from autonomous_private_ops import cloud_reconcile_sql,EXPIRED_CHUNKS_SQL,remove_expired_chunks
from autonomous_bundle import load_script


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='operation',required=True)
    reconcile=sub.add_parser('reconcile-provider');reconcile.add_argument('--request-id',required=True);reconcile.add_argument('--provider-id',required=True)
    sub.add_parser('expired-chunks');args=parser.parse_args()
    stack=contextlib.ExitStack()
    try:
        os.umask(0o077);state=Path.home()/'village-autonomous';stack.enter_context(operation_lock(state))
        docker=Docker(state);meta,network=verified_runtime(docker,state)
        if args.operation=='reconcile-provider':
            result=json.loads(docker.sql(cloud_reconcile_sql(args.request_id,args.provider_id,meta['instanceId'])))
            if result!={'ok':True}:raise ValueError('PROVIDER_RECONCILIATION_REFUSED')
            print('LOCAL_PROVIDER_ID_RECONCILED_NO_NEW_SUBMISSION');return 0
        backup=load_script('backup-autonomous')
        with backup.quiesce(docker,meta):
            uploads=json.loads(docker.sql(EXPIRED_CHUNKS_SQL))
            result=remove_expired_chunks(state/'files/task-chunks',uploads,instance=meta['instanceId'])
        print(json.dumps(result));print('EXPIRED_UPLOAD_CHUNKS_REMOVED_REFERENCED_BLOBS_RETAINED');return 0
    except (OSError,ValueError,RuntimeError):
        print('STOP: PRIVATE_MAINTENANCE_FAILED. Keep data and private logs; verify writer status.');return 1
    finally:stack.close()


if __name__=='__main__':raise SystemExit(main())
