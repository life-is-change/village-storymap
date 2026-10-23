#!/usr/bin/env python3
"""Repair local GPU lock ordering and legacy browser space-lock calls."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import time
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_extract import tree_digest
from autonomous_operator import Docker,WEB,API,AUTH,PG,operation_lock,verified_runtime

browser=load_script('repair-autonomous-browser')
geo=load_script('repair-autonomous-geo-results')
from task_lock_order import patch_sql
PATCH='task-locks-20261023-v1'
GEO_APP='17233abb7e29f7ce3fc5479bdb517171638026975f95cacd65a6647b7a165383'


def digest(value):return hashlib.sha256(value).hexdigest()


def verify_previous(state,meta,data,hashes,path):
    geo.verify_previous(state,meta,data,hashes,state/'files'/browser.PATCH/'web')
    expected=state/'files'/geo.PATCH/'web'
    if path!=expected:raise ValueError('VERIFIED_GEO_OVERLAY_REQUIRED')
    root=storage.private_path(expected.parent,directory=True)
    receipt=storage.read_private_json(root/'receipt.json')
    allowed=[{'app.js':GEO_APP},{'app.js':digest(data['app.js'])}]
    if (receipt.get('releaseId')!=meta['releaseId'] or receipt.get('files') not in allowed
            or receipt.get('source_web')!=str(state/'files'/browser.PATCH/'web')
            or receipt.get('sql_sha256')!=hashes[geo.PATCH]
            or receipt.get('phase')!='served_verified_browser_login_pending'
            or tree_digest(expected)!=storage.read_private_json(root/'overlay-proof.json').get('tree_sha256')
            or storage.digest_file(expected/'app.js')[0]!=receipt['files']['app.js']):
        raise ValueError('PREVIOUS_GEO_PATCH_CHANGED')
    return expected


def repair(state,source,*,apply=False,docker=None,check_http=browser.check_served):
    state=storage.private_path(state,directory=True)
    with operation_lock(state):
        docker=docker or Docker(state);meta,_=verified_runtime(docker,state)
        switch=storage.read_private_json(state/'public-switch.json')
        if switch.get('status')!='public_https_core_not_gpu_accepted' or switch.get('releaseId')!=meta['releaseId']:
            raise ValueError('PUBLIC_LOCAL_RUNTIME_REQUIRED')
        release=state/'releases'/meta['releaseId']
        for directory,key in [('web','static_sha256'),('schema','schema_sha256'),('control','control_sha256')]:
            if tree_digest(release/directory)!=meta[key]:raise ValueError('ORIGINAL_RELEASE_CHANGED')
        if tree_digest(state/'control')!=meta['control_sha256']:raise ValueError('FROZEN_CONTROLLER_CHANGED')
        web=docker.own_container(WEB,meta['releaseId'])
        if web.get('Image')!=meta['nginx_image_id'] or not web.get('State',{}).get('Running'):raise ValueError('WEB_IDENTITY_REQUIRED')
        if not any(v.get('HostPort')=='443' for v in (web.get('HostConfig',{}).get('PortBindings') or {}).get('8443/tcp',[])):raise ValueError('PUBLIC_TLS_REQUIRED')
        data=browser.inputs(source)
        app=data['app.js']
        service_path=storage.no_links(source/'features/data/data-service.js')
        if not service_path.is_file() or service_path.stat().st_nlink!=1 or service_path.stat().st_size>1024**2:raise ValueError('SPACE_LOCK_ADAPTER_REQUIRED')
        service=service_path.read_bytes().replace(b'\r\n',b'\n')
        if service.count(b"if (deps.services?.mode === 'aliyun')")!=2:raise ValueError('SPACE_LOCK_ADAPTER_REQUIRED')
        updates={'app.js':app,'features/data/data-service.js':service}
        if b'script.remove();' not in app or b'village3DLoadPromise = null;\n    throw error;' not in app:raise ValueError('RETRYABLE_3D_LOADER_REQUIRED')
        old=browser.photo_sql((release/'schema/catalog.sql').read_text(),(release/'schema/survey.sql').read_text())
        photos=old.removesuffix('COMMIT;\n')+browser.file_sql((release/'schema/files.sql').read_text())+'COMMIT;\n'
        v3=photos.removesuffix('COMMIT;\n')+browser.h001_sql(source,apply=True)+'\nCOMMIT;\n'
        queue=(release/'schema/local-tasks.sql').read_text();files=(release/'schema/local-task-files.sql').read_text()
        original=verify_previous(state,meta,data,{browser.PATCH:digest(v3.encode()),geo.PATCH:digest(geo.patch_sql(queue,files).encode())},state/'files'/geo.PATCH/'web')
        sql=patch_sql(queue,files)
        root=state/'files'/PATCH;receipt_path=root/'receipt.json'
        identity={'releaseId':meta['releaseId'],'files':{name:digest(value) for name,value in updates.items()},'sql_sha256':digest(sql.encode()),'source_web':str(original)}
        receipt=storage.read_private_json(receipt_path) if receipt_path.exists() else {}
        if receipt and (any(receipt.get(k)!=v for k,v in identity.items()) or receipt.get('phase') not in ('backed_up','sql_repaired','served_verified_browser_login_pending')):
            raise ValueError('TASK_LOCK_PATCH_RECEIPT_CHANGED')
        document=storage.read_private_json(state/'compose.json')
        updated=browser.overlay_compose(document,root,original_source=original)
        target=next(v['source'] for v in document['services']['web']['volumes'] if v.get('target')=='/srv/village-web')
        allowed={target}
        if target==str(root/'web') and receipt.get('phase')=='sql_repaired':allowed.add(str(original))
        if target==str(root/'web') and not receipt:raise ValueError('TASK_LOCK_PATCH_RECEIPT_REQUIRED')
        mounts=[v for v in web.get('Mounts',[]) if v.get('Destination')=='/srv/village-web']
        if len(mounts)!=1 or mounts[0].get('RW') is not False or mounts[0].get('Source') not in allowed:raise ValueError('RUNNING_WEB_MOUNT_CHANGED')
        docker.sql(patch_sql(queue,files,apply=False).replace('BEGIN;','BEGIN READ ONLY;',1))
        if not apply:return {'status':'task_locks_and_space_switch_preflight_passed_no_changes'}
        root.mkdir(mode=0o700,parents=True,exist_ok=True);storage.private_path(root,directory=True)
        if not receipt:
            snapshot=load_script('backup-autonomous').backup(state,Path.home()/'village-autonomous-backups')
            receipt={**identity,'phase':'backed_up','backup':str(snapshot),'backup_sha256':storage.digest_file(snapshot/'backup.json')[0]}
            storage.write_private_json(receipt_path,receipt)
        elif storage.digest_file(Path(receipt['backup'])/'backup.json')[0]!=receipt['backup_sha256']:raise ValueError('PATCH_BACKUP_CHANGED')
        if receipt['phase']=='backed_up':browser.immutable_write(root/'original-compose.json',(json.dumps(document,sort_keys=True)+'\n').encode())
        overlay=root/'web'
        if not (root/'overlay-proof.json').exists():
            total=sum(p.stat().st_size for p in original.rglob('*') if p.is_file())+len(app)
            if shutil.disk_usage(root).free<4*1024**3+total:raise ValueError('TASK_LOCK_PATCH_DISK_RESERVE_REQUIRED')
            if overlay.exists():raise ValueError('PARTIAL_WEB_OVERLAY_RETAINED')
            shutil.copytree(original,overlay,copy_function=shutil.copyfile)
            for p in [overlay,*overlay.rglob('*')]:p.chmod(0o700 if p.is_dir() else 0o600)
            for name,value in updates.items():
                target_file=overlay/name;target_file.write_bytes(value);target_file.chmod(0o600)
            storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':tree_digest(overlay)})
        if tree_digest(overlay)!=storage.read_private_json(root/'overlay-proof.json')['tree_sha256']:raise ValueError('WEB_OVERLAY_CHANGED')
        before={name:docker.own_container(name,meta['releaseId'])['Id'] for name in (API,AUTH,PG)}
        docker.sql(sql);receipt['phase']='sql_repaired';storage.write_private_json(receipt_path,receipt)
        storage.write_private_json(state/'compose.json',updated)
        docker.run('compose','-f',state/'compose.json','up','-d','--no-deps','--no-build','--pull','never','web')
        docker.run('exec',WEB,'/usr/sbin/nginx','-t')
        for name in dict.fromkeys([*data,*updates]):
            expected=updates[name] if name in updates else storage.no_links(original/name).read_bytes()
            for attempt in range(15):
                try:check_http(name,expected,443);break
                except (OSError,ValueError,http.client.HTTPException):
                    if attempt==14:raise
                    time.sleep(1)
        if before!={name:docker.own_container(name,meta['releaseId'])['Id'] for name in (API,AUTH,PG)}:raise ValueError('OTHER_SERVICES_CHANGED')
        if tree_digest(release/'web')!=meta['static_sha256'] or tree_digest(state/'control')!=meta['control_sha256']:raise ValueError('FROZEN_RELEASE_CHANGED')
        receipt['phase']='served_verified_browser_login_pending';storage.write_private_json(receipt_path,receipt)
        return {'status':'task_locks_and_space_switch_repaired_real_task_check_required','workers_replaced':False,'other_services_retained':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    try:
        if os.name!='posix' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        print(json.dumps(repair(Path.home()/'village-autonomous',storage.source_checkout(),apply=args.apply)));return 0
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,http.client.HTTPException) as error:
        code=str(error) if re.fullmatch('[A-Z_]{1,100}',str(error)) else type(error).__name__
        print('STOP: TASK_LOCK_REPAIR_FAILED category='+code+'. Retain backup, current data and private logs; do not reset or rerun the initial installer.');return 1


if __name__=='__main__':raise SystemExit(main())
