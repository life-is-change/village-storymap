#!/usr/bin/env python3
"""Repair Geo output step mapping and retryable 3D script loads in the public runtime."""
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
PATCH='geo-browser-20261023-v1'
LEGACY_APP='21ea3f5b3766e4f3dbeff820cf77a978ee13a7afdee8e6d66cf4530ae891ac9a'
REPLACEMENTS=(
    ('local_gpu_outputs_ready','api_private.local_gpu_runs',
     "WHEN 'water' THEN ARRAY['waterways','water_areas']",
     "WHEN 'roads_water' THEN ARRAY['roads','waterways','water_areas']"),
    ('local_worker_file','uuid,text,text,text,uuid,uuid,jsonb',
     "WHEN k IN('waterways','water_areas') THEN 'water'",
     "WHEN k IN('roads','waterways','water_areas') THEN 'roads_water'"),
)


def digest(value):return hashlib.sha256(value).hexdigest()


def patch_sql(queue,files,*,apply=True):
    parts=['BEGIN;',"SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s';",
        "DO $guard$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'LOCAL_DATABASE_REQUIRED';END IF;END$guard$;"]
    quote=lambda text:"'"+text.replace("'","''")+"'"
    for (name,signature,old,new),source in zip(REPLACEMENTS,(queue,files)):
        body=browser.function_body(source,name)
        if body.count(old)+body.count(new)!=1:raise ValueError('KNOWN_GEO_STEP_MAPPING_REQUIRED')
        before=body.replace(new,old);after=body.replace(old,new)
        change="IF actual=original THEN EXECUTE replace(definition,original,patched);END IF;" if apply else ''
        parts.append("DO $repair$DECLARE original text:="+quote(before)+";patched text:="+quote(after)+";actual text;definition text;BEGIN\n"
            +"SELECT prosrc,pg_get_functiondef(oid) INTO actual,definition FROM pg_proc WHERE oid='api_private."+name+'('+signature+")'::regprocedure;\n"
            +"IF actual IS NULL OR actual NOT IN(original,patched) THEN RAISE EXCEPTION 'GEO_RESULT_FUNCTION_CHANGED';END IF;\n"+change+'\nEND$repair$;')
    return '\n'.join(parts)+'\nCOMMIT;\n'


def verify_previous(state,meta,data,hashes,path):
    # This patch builds on the already-attested v3 browser fixes. A different
    # mount/receipt is a diagnostic stop, never permission to replace its files.
    expected=state/'files'/browser.PATCH/'web'
    if path!=expected:raise ValueError('VERIFIED_BROWSER_V3_REQUIRED')
    root=storage.private_path(expected.parent,directory=True)
    receipt=storage.read_private_json(root/'receipt.json')
    manifest={name:digest(value) for name,value in data.items()}
    legacy={**manifest,'app.js':LEGACY_APP}
    if (receipt.get('releaseId')!=meta['releaseId'] or receipt.get('files') not in (manifest,legacy)
            or receipt.get('sql_sha256')!=hashes[browser.PATCH]
            or receipt.get('phase')!='served_verified_browser_login_pending'
            or tree_digest(expected)!=storage.read_private_json(root/'overlay-proof.json').get('tree_sha256')):
        raise ValueError('PREVIOUS_BROWSER_PATCH_CHANGED')
    for name,value in receipt['files'].items():
        if storage.digest_file(storage.no_links(expected/name))[0]!=value:raise ValueError('PREVIOUS_BROWSER_PATCH_CHANGED')
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
        if b'script.remove();' not in app or b'village3DLoadPromise = null;\n    throw error;' not in app:raise ValueError('RETRYABLE_3D_LOADER_REQUIRED')
        old=browser.photo_sql((release/'schema/catalog.sql').read_text(),(release/'schema/survey.sql').read_text())
        photos=old.removesuffix('COMMIT;\n')+browser.file_sql((release/'schema/files.sql').read_text())+'COMMIT;\n'
        v3=photos.removesuffix('COMMIT;\n')+browser.h001_sql(source,apply=True)+'\nCOMMIT;\n'
        original=verify_previous(state,meta,data,{browser.PATCH:digest(v3.encode())},state/'files'/browser.PATCH/'web')
        queue=(release/'schema/local-tasks.sql').read_text();files=(release/'schema/local-task-files.sql').read_text()
        sql=patch_sql(queue,files)
        root=state/'files'/PATCH;receipt_path=root/'receipt.json'
        identity={'releaseId':meta['releaseId'],'files':{'app.js':digest(app)},'sql_sha256':digest(sql.encode()),'source_web':str(original)}
        receipt=storage.read_private_json(receipt_path) if receipt_path.exists() else {}
        if receipt and (any(receipt.get(k)!=v for k,v in identity.items()) or receipt.get('phase') not in ('backed_up','sql_repaired','served_verified_browser_login_pending')):
            raise ValueError('GEO_PATCH_RECEIPT_CHANGED')
        document=storage.read_private_json(state/'compose.json')
        updated=browser.overlay_compose(document,root,original_source=original)
        target=next(v['source'] for v in document['services']['web']['volumes'] if v.get('target')=='/srv/village-web')
        allowed={target}
        if target==str(root/'web') and receipt.get('phase')=='sql_repaired':allowed.add(str(original))
        if target==str(root/'web') and not receipt:raise ValueError('GEO_PATCH_RECEIPT_REQUIRED')
        mounts=[v for v in web.get('Mounts',[]) if v.get('Destination')=='/srv/village-web']
        if len(mounts)!=1 or mounts[0].get('RW') is not False or mounts[0].get('Source') not in allowed:raise ValueError('RUNNING_WEB_MOUNT_CHANGED')
        docker.sql(patch_sql(queue,files,apply=False).replace('BEGIN;','BEGIN READ ONLY;',1))
        if not apply:return {'status':'geo_results_and_3d_retry_preflight_passed_no_changes'}
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
            if shutil.disk_usage(root).free<4*1024**3+total:raise ValueError('GEO_PATCH_DISK_RESERVE_REQUIRED')
            if overlay.exists():raise ValueError('PARTIAL_WEB_OVERLAY_RETAINED')
            shutil.copytree(original,overlay,copy_function=shutil.copyfile)
            for p in [overlay,*overlay.rglob('*')]:p.chmod(0o700 if p.is_dir() else 0o600)
            (overlay/'app.js').write_bytes(app)
            storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':tree_digest(overlay)})
        if tree_digest(overlay)!=storage.read_private_json(root/'overlay-proof.json')['tree_sha256']:raise ValueError('WEB_OVERLAY_CHANGED')
        before={name:docker.own_container(name,meta['releaseId'])['Id'] for name in (API,AUTH,PG)}
        docker.sql(sql);receipt['phase']='sql_repaired';storage.write_private_json(receipt_path,receipt)
        storage.write_private_json(state/'compose.json',updated)
        docker.run('compose','-f',state/'compose.json','up','-d','--no-deps','--no-build','--pull','never','web')
        docker.run('exec',WEB,'/usr/sbin/nginx','-t')
        for name in data:
            expected=app if name=='app.js' else storage.no_links(original/name).read_bytes()
            for attempt in range(15):
                try:check_http(name,expected,443);break
                except (OSError,ValueError,http.client.HTTPException):
                    if attempt==14:raise
                    time.sleep(1)
        if before!={name:docker.own_container(name,meta['releaseId'])['Id'] for name in (API,AUTH,PG)}:raise ValueError('OTHER_SERVICES_CHANGED')
        if tree_digest(release/'web')!=meta['static_sha256'] or tree_digest(state/'control')!=meta['control_sha256']:raise ValueError('FROZEN_RELEASE_CHANGED')
        receipt['phase']='served_verified_browser_login_pending';storage.write_private_json(receipt_path,receipt)
        return {'status':'geo_results_and_3d_retry_repaired_real_task_check_required','workers_replaced':False,'other_services_retained':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    try:
        if os.name!='posix' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        print(json.dumps(repair(Path.home()/'village-autonomous',storage.source_checkout(),apply=args.apply)));return 0
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,http.client.HTTPException) as error:
        code=str(error) if re.fullmatch('[A-Z_]{1,100}',str(error)) else type(error).__name__
        print('STOP: GEO_RESULTS_REPAIR_FAILED category='+code+'. Retain backup, current data and private logs; do not reset or rerun the initial installer.');return 1


if __name__=='__main__':raise SystemExit(main())
