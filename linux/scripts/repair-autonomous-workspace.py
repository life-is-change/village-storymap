#!/usr/bin/env python3
"""Repair authorized workspace selection, geometry drafts and personal context."""
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
locks=load_script('repair-autonomous-task-locks')
geo=locks.geo
entry=load_script('repair-autonomous-account-entry')
from workspace_context import patch_sql
PATCH='workspace-edit-20261023-v1'
BASELINE=json.loads((Path(__file__).resolve().parents[1]/'workspace-repair-baseline.json').read_text(encoding='utf8'))['files']


def digest(value):return hashlib.sha256(value).hexdigest()


def inputs(source):
    result={}
    for name in ('app.js','features/map-editing/geometry-editor.js'):
        path=storage.no_links(source/name)
        if not path.is_file() or path.stat().st_nlink!=1 or path.stat().st_size>2*1024**2:raise ValueError('WORKSPACE_SOURCE_REQUIRED')
        result[name]=path.read_bytes().replace(b'\r\n',b'\n')
    return result


def previous_data(state,source):
    data=browser.inputs(source)
    root=state/'files'/locks.PATCH/'web'
    for name in BASELINE:
        # 3D/API were replaced only by the account-entry patch.
        directory=state/'files'/entry.PATCH/'web' if name in ('app-3d.js','features/data/unified-api-client.js') else root
        value=storage.no_links(directory/name).read_bytes()
        if digest(value)!=BASELINE[name]:raise ValueError('WORKSPACE_BASELINE_CHANGED')
        if name in data or name=='features/data/data-service.js':data[name]=value
    return data


def verify_previous(state,meta,data,hashes,path):
    previous=entry.verify_previous(state,meta,data,hashes,state/'files'/locks.PATCH/'web')
    expected=state/'files'/entry.PATCH/'web'
    if path!=expected:raise ValueError('VERIFIED_ACCOUNT_OVERLAY_REQUIRED')
    root=storage.private_path(expected.parent,directory=True)
    receipt=storage.read_private_json(root/'receipt.json')
    files={name:BASELINE[name] for name in ('app-3d.js','features/data/unified-api-client.js')}
    if (receipt.get('releaseId')!=meta['releaseId'] or receipt.get('files')!=files
            or receipt.get('source_web')!=str(previous)
            or receipt.get('phase')!='served_verified_browser_login_pending'
            or tree_digest(expected)!=storage.read_private_json(root/'overlay-proof.json').get('tree_sha256')
            or any(storage.digest_file(storage.no_links(expected/name))[0]!=value for name,value in BASELINE.items())):
        raise ValueError('PREVIOUS_ACCOUNT_PATCH_CHANGED')
    saved=storage.read_private_json(root/'original-compose.json')
    if storage.digest_file(Path(receipt['backup'])/'backup.json')[0]!=receipt['backup_sha256']:
        raise ValueError('PREVIOUS_ACCOUNT_BACKUP_CHANGED')
    return expected, browser.overlay_compose(saved,root,original_source=previous)



def inspect_web(docker,meta,allowed,*,resume=False):
    names=docker.run('container','ls','--all','--filter','name=^/'+WEB+'$','--format','{{.Names}}').splitlines()
    if not names:
        if resume:return None
        raise ValueError('WEB_IDENTITY_REQUIRED')
    if names!=[WEB]:raise ValueError('WEB_IDENTITY_REQUIRED')
    web=docker.own_container(WEB,meta['releaseId'])
    if web.get('Image')!=meta['nginx_image_id'] or not resume and not web.get('State',{}).get('Running'):
        raise ValueError('WEB_IDENTITY_REQUIRED')
    if not any(v.get('HostPort')=='443' for v in (web.get('HostConfig',{}).get('PortBindings') or {}).get('8443/tcp',[])):
        raise ValueError('PUBLIC_TLS_REQUIRED')
    mounts=[v for v in web.get('Mounts',[]) if v.get('Destination')=='/srv/village-web']
    if len(mounts)!=1 or mounts[0].get('RW') is not False or mounts[0].get('Source') not in allowed:
        raise ValueError('RUNNING_WEB_MOUNT_CHANGED')
    return web


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
        data=previous_data(state,source)
        updates=inputs(source)
        old=browser.photo_sql((release/'schema/catalog.sql').read_text(),(release/'schema/survey.sql').read_text())
        photos=old.removesuffix('COMMIT;\n')+browser.file_sql((release/'schema/files.sql').read_text())+'COMMIT;\n'
        v3=photos.removesuffix('COMMIT;\n')+browser.h001_sql(source,apply=True)+'\nCOMMIT;\n'
        queue=(release/'schema/local-tasks.sql').read_text();files=(release/'schema/local-task-files.sql').read_text()
        original,original_document=verify_previous(state,meta,data,{browser.PATCH:digest(v3.encode()),geo.PATCH:digest(geo.patch_sql(queue,files).encode()),locks.PATCH:digest(locks.patch_sql(queue,files).encode())},state/'files'/entry.PATCH/'web')
        legacy=storage.no_links(source/'linux/sql/autonomous-personal-context-compat.sql').read_text(encoding='utf8')
        fixed=storage.no_links(source/'linux/sql/workspace-personal-context.sql').read_text(encoding='utf8')
        sql=patch_sql(legacy,fixed)
        root=state/'files'/PATCH;receipt_path=root/'receipt.json'
        identity={'releaseId':meta['releaseId'],'files':{name:digest(value) for name,value in updates.items()},'source_web':str(original),'sql_sha256':digest(sql.encode())}
        receipt=storage.read_private_json(receipt_path) if receipt_path.exists() else {}
        if receipt and (any(receipt.get(k)!=v for k,v in identity.items()) or receipt.get('phase') not in ('backed_up','web_prepared','served_verified_browser_login_pending')):
            raise ValueError('WORKSPACE_EDIT_PATCH_RECEIPT_CHANGED')
        document=storage.read_private_json(state/'compose.json')
        expected_document=browser.overlay_compose(original_document,root,original_source=original)
        if document not in (original_document,expected_document):raise ValueError('WORKSPACE_COMPOSE_CHANGED')
        updated=expected_document
        target=next(v['source'] for v in document['services']['web']['volumes'] if v.get('target')=='/srv/village-web')
        allowed={target}
        if target==str(root/'web') and receipt.get('phase')=='web_prepared':allowed.add(str(original))
        if target==str(root/'web') and not receipt:raise ValueError('WORKSPACE_EDIT_PATCH_RECEIPT_REQUIRED')
        resume=receipt.get('phase')=='web_prepared' and target==str(root/'web')
        if receipt.get('phase') in ('web_prepared','served_verified_browser_login_pending'):
            saved=storage.read_private_json(root/'original-compose.json')
            expected=browser.overlay_compose(saved,root,original_source=original)
            if document!=expected and not (receipt['phase']=='web_prepared' and document==saved):raise ValueError('WORKSPACE_EDIT_COMPOSE_CHANGED')
            if tree_digest(root/'web')!=storage.read_private_json(root/'overlay-proof.json').get('tree_sha256'):raise ValueError('WEB_OVERLAY_CHANGED')
            if storage.digest_file(Path(receipt['backup'])/'backup.json')[0]!=receipt['backup_sha256']:raise ValueError('PATCH_BACKUP_CHANGED')
        inspect_web(docker,meta,allowed,resume=resume)
        docker.sql(patch_sql(legacy,fixed,apply=False).replace('BEGIN;','BEGIN READ ONLY;',1))
        if not apply:return {'status':'workspace_edit_consistency_preflight_passed_no_changes'}
        root.mkdir(mode=0o700,parents=True,exist_ok=True);storage.private_path(root,directory=True)
        if not receipt:
            snapshot=load_script('backup-autonomous').backup(state,Path.home()/'village-autonomous-backups')
            receipt={**identity,'phase':'backed_up','backup':str(snapshot),'backup_sha256':storage.digest_file(snapshot/'backup.json')[0]}
            storage.write_private_json(receipt_path,receipt)
        elif storage.digest_file(Path(receipt['backup'])/'backup.json')[0]!=receipt['backup_sha256']:raise ValueError('PATCH_BACKUP_CHANGED')
        if receipt['phase']=='backed_up':browser.immutable_write(root/'original-compose.json',(json.dumps(document,sort_keys=True)+'\n').encode())
        overlay=root/'web'
        if not (root/'overlay-proof.json').exists():
            total=sum(p.stat().st_size for p in original.rglob('*') if p.is_file())+sum(map(len,updates.values()))
            if shutil.disk_usage(root).free<4*1024**3+total:raise ValueError('WORKSPACE_EDIT_PATCH_DISK_RESERVE_REQUIRED')
            if overlay.exists():raise ValueError('PARTIAL_WEB_OVERLAY_RETAINED')
            shutil.copytree(original,overlay,copy_function=shutil.copyfile)
            for p in [overlay,*overlay.rglob('*')]:p.chmod(0o700 if p.is_dir() else 0o600)
            for name,value in updates.items():
                target_file=overlay/name;target_file.write_bytes(value);target_file.chmod(0o600)
            storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':tree_digest(overlay)})
        if tree_digest(overlay)!=storage.read_private_json(root/'overlay-proof.json')['tree_sha256']:raise ValueError('WEB_OVERLAY_CHANGED')
        before={name:docker.own_container(name,meta['releaseId'])['Id'] for name in (API,AUTH,PG)}
        docker.sql(sql)
        receipt['phase']='web_prepared';storage.write_private_json(receipt_path,receipt)
        storage.write_private_json(state/'compose.json',updated)
        docker.run('compose','-f',state/'compose.json','up','-d','--no-deps','--no-build','--pull','never','web')
        inspect_web(docker,meta,{str(root/'web')})
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
        return {'status':'workspace_edit_consistency_repaired_browser_check_required','workers_replaced':False,'other_services_retained':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    try:
        if os.name!='posix' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        print(json.dumps(repair(Path.home()/'village-autonomous',storage.source_checkout(),apply=args.apply)));return 0
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,http.client.HTTPException) as error:
        code=str(error) if re.fullmatch('[A-Z_]{1,100}',str(error)) else type(error).__name__
        print('STOP: WORKSPACE_EDIT_REPAIR_FAILED category='+code+'. Retain backup, current data and private logs; do not reset or rerun the initial installer.');return 1


if __name__=='__main__':raise SystemExit(main())
