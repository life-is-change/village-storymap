#!/usr/bin/env python3
"""Create two private local Worker credentials; no campus or source configuration change."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import tarfile
from uuid import uuid4
import business_storage_copy as storage
from autonomous_private_ops import uuid
from autonomous_operator import Docker,verified_runtime,operation_lock


def new_credential(kind):
    if kind not in ('geo','facade'):raise ValueError('FIXED_WORKER_KIND_REQUIRED')
    identifier=str(uuid4());secret=secrets.token_urlsafe(32)
    return 'village_worker_'+identifier+'.'+secret,{'id':identifier,'digest':hashlib.sha256(secret.encode()).hexdigest(),
        'kind':kind,'name':'campus-'+kind,'instance':'aliyun-village'}


def credential(root,kind):
    root=storage.private_path(root,directory=True)
    if kind not in ('geo','facade'):raise ValueError('FIXED_WORKER_KIND_REQUIRED')
    key_path=root/('aliyun-'+kind+'.key');record_path=root/('aliyun-'+kind+'.json')
    if key_path.exists() or record_path.exists():
        if not key_path.is_file() or not record_path.is_file():raise ValueError('PARTIAL_WORKER_CREDENTIAL_RETAINED')
        key=storage.private_path(key_path).read_text().strip();record=storage.read_private_json(record_path)
        match=re.fullmatch(r'village_worker_([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})',key)
        if not match or not uuid(match[1]) or record!={'id':match[1],'digest':hashlib.sha256(match[2].encode()).hexdigest(),'kind':kind,'name':'campus-'+kind,'instance':'aliyun-village'}:
            raise ValueError('PRIVATE_WORKER_CREDENTIAL_CHANGED')
        return record
    key,record=new_credential(kind)
    with os.fdopen(os.open(key_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w',encoding='ascii') as stream:stream.write(key+'\n');stream.flush();os.fsync(stream.fileno())
    storage.write_private_json(record_path,record);return record


def register_sql(record):
    kind=record.get('kind')
    if kind not in ('geo','facade') or not uuid(record.get('id')) or not re.fullmatch('[a-f0-9]{64}',record.get('digest','')) or record.get('name')!='campus-'+kind or record.get('instance')!='aliyun-village':
        raise ValueError('VALIDATED_WORKER_RECORD_REQUIRED')
    identifier=record['id'];digest=record['digest'];name=record['name']
    return """BEGIN;
DO $$BEGIN
 IF current_database()<>'village_unified_candidate' THEN RAISE EXCEPTION 'AUTONOMOUS_TARGET_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM api_private.local_gpu_workers WHERE instance_id='aliyun-village' AND name='"""+name+"""'
 AND (id<>'"""+identifier+"""'::uuid OR kind<>'"""+kind+"""' OR token_digest<>'"""+digest+"""' OR revoked_at IS NOT NULL)) THEN RAISE EXCEPTION 'WORKER_CREDENTIAL_ALREADY_DIFFERS';END IF;
 INSERT INTO api_private.local_gpu_workers(id,instance_id,name,kind,token_digest)
 VALUES('"""+identifier+"""','aliyun-village','"""+name+"""','"""+kind+"""','"""+digest+"""') ON CONFLICT(instance_id,name) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM api_private.local_gpu_workers WHERE id='"""+identifier+"""' AND instance_id='aliyun-village' AND name='"""+name+"""' AND kind='"""+kind+"""' AND token_digest='"""+digest+"""' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'WORKER_REGISTRATION_NOT_PROVEN';END IF;
END$$;
SELECT '{"registered":true}'::json;
COMMIT;
"""


SEED_MAPPING_SQL="""BEGIN;
DO $$BEGIN
 IF current_database()<>'village_unified_candidate' THEN RAISE EXCEPTION 'AUTONOMOUS_TARGET_REQUIRED';END IF;
 IF to_regclass('public.geoprocessing_villages') IS NOT NULL THEN
  INSERT INTO api_private.task_worker_villages(local_village_id,worker_village_id)
  SELECT v.id,g.village_id FROM public.villages v JOIN public.geoprocessing_villages g ON g.village_id=v.id::text WHERE g.active
  ON CONFLICT(local_village_id) DO NOTHING;
 END IF;
END$$;
SELECT json_build_object('mapped_villages',(SELECT count(*) FROM api_private.task_worker_villages));
COMMIT;
"""


def mapping_sql(local_id,source_id):
    if not uuid(local_id) or not re.fullmatch('[a-zA-Z0-9_.:-]{1,200}',source_id or ''):raise ValueError('VALIDATED_SOURCE_MAPPING_REQUIRED')
    return """BEGIN;
DO $$BEGIN
 IF current_database()<>'village_unified_candidate' OR NOT EXISTS(SELECT 1 FROM public.villages WHERE id='"""+local_id+"""'::uuid AND status='published')
 OR NOT EXISTS(SELECT 1 FROM public.geoprocessing_villages WHERE village_id='"""+source_id+"""' AND active) THEN RAISE EXCEPTION 'PUBLISHED_SOURCE_MAPPING_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM api_private.task_worker_villages WHERE local_village_id='"""+local_id+"""'::uuid AND worker_village_id<>'"""+source_id+"""') THEN RAISE EXCEPTION 'SOURCE_MAPPING_ALREADY_DIFFERS';END IF;
 INSERT INTO api_private.task_worker_villages(local_village_id,worker_village_id) VALUES('"""+local_id+"""','"""+source_id+"""') ON CONFLICT(local_village_id) DO NOTHING;
END$$;
SELECT '{"mapped":true}'::json;
COMMIT;
"""


def provision(state,docker,meta):
    root=Path(state)/'worker-credentials';root.mkdir(mode=0o700,exist_ok=True)
    records=[]
    for kind in ('geo','facade'):
        record=credential(root,kind)
        if json.loads(docker.sql(register_sql(record)))!={'registered':True}:raise ValueError('WORKER_REGISTRATION_NOT_PROVEN')
        records.append(record)
    mapped=json.loads(docker.sql(SEED_MAPPING_SQL))
    bundle=Path(state)/'worker-credentials.tar.gz'
    names=['aliyun-'+kind+suffix for kind in ('geo','facade') for suffix in ('.key','.json')]
    if not bundle.exists():
        with os.fdopen(os.open(bundle,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output,tarfile.open(fileobj=output,mode='w:gz') as archive:
            for name in names:archive.add(storage.private_path(root/name),arcname=name,recursive=False)
    else:
        with tarfile.open(storage.private_path(bundle),'r:gz') as archive:
            items=archive.getmembers()
            if len(items)!=4 or {m.name for m in items}!=set(names) or any(not m.isfile() or m.size>4096 for m in items):raise ValueError('WORKER_BUNDLE_CHANGED')
            for member in items:
                if archive.extractfile(member).read()!=storage.private_path(root/member.name).read_bytes():raise ValueError('WORKER_BUNDLE_CHANGED')
    return {'credentials':2,'mapped_villages':mapped['mapped_villages'],'bundle_sha256':storage.digest_file(bundle)[0]}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--map-village',nargs=2,metavar=('LOCAL_VILLAGE_UUID','EXISTING_DATASET_ID'));args=parser.parse_args()
    try:
        os.umask(0o077);state=Path.home()/'village-autonomous'
        with operation_lock(state):
            from autonomous_bundle import load_script
            deploy=load_script('deploy-autonomous');docker=deploy.DeployDocker(state);meta,network=verified_runtime(docker,state)
            if args.map_village:
                if json.loads(docker.sql(mapping_sql(*args.map_village)))!={'mapped':True}:raise ValueError('SOURCE_MAPPING_NOT_PROVEN')
                print('LOCAL_DATASET_MAPPING_VERIFIED_NO_SOURCE_CHANGE');return 0
            report=provision(state,docker,meta)
        print(json.dumps(report));print('LOCAL_WORKER_CREDENTIALS_PRIVATE_NOT_CAMPUS_INSTALLED');print('Private bundle: '+str(state/'worker-credentials.tar.gz'));return 0
    except (OSError,ValueError,RuntimeError,tarfile.TarError):
        print('STOP: LOCAL_WORKER_PROVISION_FAILED. Keep private credentials and logs; do not regenerate or paste keys.');return 1


if __name__=='__main__':raise SystemExit(main())
