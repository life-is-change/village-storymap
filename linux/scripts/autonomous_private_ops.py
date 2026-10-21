"""Fixed private operations; no public recovery route and no provider resubmission."""
import os
from pathlib import Path
import re
from uuid import UUID
import business_storage_copy as storage


def uuid(value):
    try:return isinstance(value,str) and str(UUID(value))==value
    except (ValueError,TypeError,AttributeError):return False


def recovery_command(meta,state,network,*,image,uid,gid):
    if meta.get('kind')!='autonomous' or meta.get('schemaVersion')!=2 or image not in meta.get('accepted_image_ids',[]) or network!='village-autonomous_dbnet' or uid<=0 or gid<0:
        raise ValueError('VERIFIED_RECOVERY_RUNTIME_REQUIRED')
    state=Path(state)
    if not state.is_absolute():raise ValueError('ABSOLUTE_RECOVERY_STATE_REQUIRED')
    command=['run','--rm','-i','--pull=never','--network',network,'--user',f'{uid}:{gid}','--read-only','--cap-drop','ALL',
        '--security-opt','no-new-privileges:true','--memory','192m','--memory-swap','192m','--pids-limit','32','--tmpfs','/tmp:size=16m,mode=1777']
    for name in ('api-password','auth-jwt'):
        command+=['--mount',f'type=bind,source={state}/secrets/{name},target=/run/secrets/{name},readonly']
    return [*command,'--entrypoint','',image,'node','auth/recovery-cli.mjs']


def cloud_reconcile_sql(request_id,provider_id,instance):
    if not uuid(request_id) or not re.fullmatch('[a-zA-Z0-9_-]{1,200}',provider_id or '') or instance!='aliyun-village':raise ValueError('INVALID_RECONCILIATION_ID')
    return """BEGIN;
SELECT api_private.local_cloud_call((SELECT r.owner_id FROM api_private.local_gpu_runs r
 JOIN api_private.task_requests t ON t.id=r.id WHERE t.request_id='"""+request_id+"""'::uuid
 AND r.instance_id='aliyun-village' AND r.kind='cloud-facade'),
 '"""+request_id+"""'::uuid,'aliyun-village','reconcile',jsonb_build_object('jobId','"""+provider_id+"""'));
COMMIT;
"""


EXPIRED_CHUNKS_SQL="""BEGIN;
WITH expired AS (
 UPDATE api_private.local_gpu_uploads u SET state='aborted'
 FROM api_private.local_gpu_runs r WHERE r.id=u.run_id AND u.state='pending' AND u.updated_at<now()-interval '24 hours'
 AND (r.lease_token IS DISTINCT FROM u.lease_token OR r.lease_until IS NULL OR r.lease_until<=now()
 OR r.status NOT IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating'))
 RETURNING u.id
), eligible AS (
 SELECT id FROM expired UNION SELECT id FROM api_private.local_gpu_uploads
 WHERE state IN('ready','aborted') AND updated_at<now()-interval '24 hours'
)
SELECT coalesce(json_agg(id),'[]'::json) FROM (SELECT id FROM eligible ORDER BY id LIMIT 20001) capped;
COMMIT;
"""


def remove_expired_chunks(root,uploads,*,instance):
    root=storage.private_path(root,directory=True)
    if instance!='aliyun-village' or storage.private_path(root/'instance').read_text()!=instance or not isinstance(uploads,list) or len(uploads)>20000 or len(set(uploads))!=len(uploads) or any(not uuid(v) for v in uploads):
        raise ValueError('VALIDATED_CHUNK_RECEIPTS_REQUIRED')
    total=0;removed=0
    for upload in uploads:
        directory=storage.no_links(root/upload)
        if directory.parent!=root:raise ValueError('CHUNK_PATH_OUTSIDE_ROOT')
        if not directory.exists():continue
        storage.private_path(directory,directory=True)
        paths=list(directory.iterdir())
        # Validate the whole directory before deleting any file. No recursive
        # deletion, no glob-built shell commands and no ordinary/blob deletion.
        for path in paths:
            if not re.fullmatch(r'(?:[0-9]|[1-5][0-9]|6[0-3])(?:\.chunk|\.[a-f0-9-]{36}\.pending)',path.name):raise ValueError('UNKNOWN_CHUNK_FILE')
            storage.private_path(path)
        for path in paths:total+=path.stat().st_size;path.unlink()
        directory.rmdir();removed+=1
    return {'uploads':removed,'bytes':total}
