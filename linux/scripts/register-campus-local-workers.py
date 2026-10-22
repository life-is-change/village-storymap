#!/usr/bin/env python3
"""Register two public campus digests without receiving private Worker keys."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import business_storage_copy as storage
from autonomous_operator import Docker,verified_runtime,operation_lock
from autonomous_private_ops import uuid


def decode(value):
    if not isinstance(value,str) or not re.fullmatch('[A-Za-z0-9_-]{1,2048}',value):raise ValueError('PUBLIC_WORKER_REGISTRATION_REQUIRED')
    doc=json.loads(base64.b64decode(value+'='*((-len(value))%4),altchars=b'-_',validate=True))
    if (not isinstance(doc,dict) or set(doc)!= {'version','instanceId','workers'} or type(doc['version']) is not int or doc['version']!=1 or doc['instanceId']!='aliyun-village'
            or not isinstance(doc['workers'],list) or len(doc['workers'])!=2):raise ValueError('PUBLIC_WORKER_REGISTRATION_REQUIRED')
    for r in doc['workers']:
        if (not isinstance(r,dict) or set(r)!={'id','digest','kind'} or not uuid(r['id'])
                or r['kind'] not in ('geo','facade') or not isinstance(r['digest'],str)
                or not re.fullmatch('[a-f0-9]{64}',r['digest'])):raise ValueError('PUBLIC_WORKER_REGISTRATION_REQUIRED')
    if {r['kind'] for r in doc['workers']}!={'geo','facade'} or len({r['id'] for r in doc['workers']})!=2:raise ValueError('DISTINCT_WORKER_IDENTITIES_REQUIRED')
    doc['workers'].sort(key=lambda r:r['kind']);return doc


def registration_sql(doc):
    # Validate again even when called by a test/operator rather than the CLI.
    doc=decode(base64.urlsafe_b64encode(json.dumps(doc).encode()).decode().rstrip('='))
    parts=['BEGIN;',"SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s';",
        "DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'LOCAL_TARGET_REQUIRED';END IF;END$$;"]
    for r in doc['workers']:
        identifier,digest,kind=r['id'],r['digest'],r['kind'];name='campus-local-'+kind
        parts.append("""DO $$BEGIN
 IF EXISTS(SELECT 1 FROM api_private.local_gpu_workers WHERE instance_id='aliyun-village' AND name='"""+name+"""'
  AND (id<>'"""+identifier+"""'::uuid OR kind<>'"""+kind+"""' OR token_digest<>'"""+digest+"""' OR revoked_at IS NOT NULL)) THEN RAISE EXCEPTION 'LOCAL_CAMPUS_IDENTITY_ALREADY_DIFFERS';END IF;
 INSERT INTO api_private.local_gpu_workers(id,instance_id,name,kind,token_digest)
 VALUES('"""+identifier+"""','aliyun-village','"""+name+"""','"""+kind+"""','"""+digest+"""') ON CONFLICT(instance_id,name) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM api_private.local_gpu_workers WHERE id='"""+identifier+"""' AND instance_id='aliyun-village' AND name='"""+name+"""' AND kind='"""+kind+"""' AND token_digest='"""+digest+"""' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'LOCAL_CAMPUS_REGISTRATION_NOT_PROVEN';END IF;
END$$;""")
    return '\n'.join(parts)+"\nSELECT '{\"registered\":2}'::json;\nCOMMIT;\n"


def register(state,doc,*,docker=None):
    state=storage.private_path(state,directory=True)
    with operation_lock(state):
        docker=docker or Docker(state);meta,_=verified_runtime(docker,state)
        switch=storage.read_private_json(state/'public-switch.json')
        if switch.get('status')!='public_https_core_not_gpu_accepted' or switch.get('releaseId')!=meta['releaseId']:raise ValueError('PUBLIC_LOCAL_PLATFORM_REQUIRED')
        proof=state/'campus-local-registration.json';record={'releaseId':meta['releaseId'],'registration':doc}
        if proof.exists() and storage.read_private_json(proof)!=record:raise ValueError('LOCAL_CAMPUS_REGISTRATION_ALREADY_DIFFERS')
        if json.loads(docker.sql(registration_sql(doc)))!={'registered':2}:raise ValueError('LOCAL_CAMPUS_REGISTRATION_NOT_PROVEN')
        storage.write_private_json(proof,record)
        return {'status':'campus_public_digests_registered_private_keys_not_transferred','workers':2}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--registration-base64',required=True);args=parser.parse_args()
    try:
        os.umask(0o077)
        print(json.dumps(register(Path.home()/'village-autonomous',decode(args.registration_base64))));return 0
    except (OSError,ValueError,RuntimeError,TypeError,KeyError):
        print('STOP: CAMPUS_PUBLIC_REGISTRATION_FAILED. Retain private logs and existing Worker identities; do not paste keys.');return 1


if __name__=='__main__':raise SystemExit(main())
