#!/usr/bin/env python3
"""Repair browser entry, legacy photo timestamps and public lesson delivery."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import http.client
import socket
import ssl
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_extract import tree_digest
from autonomous_operator import Docker, WEB, API, AUTH, PG, operation_lock, verified_runtime

PATCH='browser-20261022-v1'
TIMESTAMP="coalesce((to_jsonb(x)->>'uploaded_at')::timestamptz,(to_jsonb(x)->>'created_at')::timestamptz)"
PROFILE='id,student_id,display_name,role,gender,class_name,grade,disabled_at'


def updated_body(body):
    return body.replace('x.created_at',TIMESTAMP).replace(PROFILE,PROFILE.replace('disabled_at',"(to_jsonb(profiles)->>'created_at') AS created_at,disabled_at"))


def function_body(sql,name):
    match=re.search(r'CREATE (?:OR REPLACE )?FUNCTION api_private\.'+name+r'\(.*?AS \$\$(.*?)\$\$;',sql,re.S|re.I)
    if not match:raise ValueError('FIXED_PHOTO_FUNCTION_REQUIRED')
    return match[1]


def photo_sql(catalog,survey):
    parts=['BEGIN;',"DO $guard$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'LOCAL_DATABASE_REQUIRED';END IF;END$guard$;"]
    for name,source in [('catalog_read',catalog),('survey_read',survey)]:
        before=function_body(source,name);after=updated_body(before)
        # String literals are SQL-quoted; no function source is printed.
        quote=lambda value:"'"+value.replace("'","''")+"'"
        parts.append("DO $repair$DECLARE original text:="+quote(before)+";patched text:="+quote(after)+";actual text;definition text;BEGIN\n"
            +"SELECT prosrc,pg_get_functiondef(oid) INTO actual,definition FROM pg_proc WHERE oid='api_private."+name+"(text,jsonb)'::regprocedure;\n"
            +"IF actual=original THEN EXECUTE replace(definition,original,patched);ELSIF actual<>patched THEN RAISE EXCEPTION 'PHOTO_FUNCTION_CHANGED';END IF;\nEND$repair$;")
    return '\n'.join(parts)+'\nCOMMIT;\n'


def overlay_compose(document,root,*,original_source):
    result=copy.deepcopy(document);volumes=result['services']['web']['volumes']
    selected=[v for v in volumes if isinstance(v,dict) and v.get('target')=='/srv/village-web']
    if len(selected)!=1 or selected[0].get('read_only') is not True or selected[0].get('source') not in (str(original_source),str(root/'web')):
        raise ValueError('ORIGINAL_OR_VERIFIED_WEB_MOUNT_REQUIRED')
    selected[0]['source']=str(root/'web')
    return result


def immutable_write(path,data):
    storage.no_links(path)
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if path.exists():
        if storage.private_path(path).read_bytes()!=data:raise ValueError('BROWSER_PATCH_INPUT_CHANGED')
        return
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as stream:
        stream.write(data);stream.flush();os.fsync(stream.fileno())


def inputs(source):
    source=storage.no_links(source)
    paths=['features/villages/village-client.js',*[f'assets/lessons/lesson{i:02}.pdf' for i in range(1,8)]]
    result={}
    for name in paths:
        path=storage.no_links(source/name)
        st=path.stat()
        if not path.is_file() or st.st_nlink!=1 or st.st_size>50*1024**2:raise ValueError('BROWSER_PATCH_FILE_REQUIRED')
        data=path.read_bytes()
        if name.endswith('.pdf'):
            if not data.startswith(b'%PDF-'):raise ValueError('LESSON_PDF_REQUIRED')
        else:
            data=data.replace(b'\r\n',b'\n')
            if b"call('catalog.listSpaces',{teachingProjectId:input.teachingProjectId,villageId:input.villageId})" not in data:
                raise ValueError('FIXED_ENTRY_ADAPTER_REQUIRED')
        result[name]=data
    return result


def check_served(path,expected,port):
    context=ssl.create_default_context()
    connection=socket.create_connection(('127.0.0.1',port),timeout=20)
    secure=context.wrap_socket(connection,server_hostname='8.148.248.237')
    try:
        secure.sendall(('GET /'+path+' HTTP/1.1\r\nHost: 8.148.248.237\r\nConnection: close\r\n\r\n').encode())
        response=http.client.HTTPResponse(secure);response.begin();h=hashlib.sha256();count=0
        if response.status!=200:raise ValueError('BROWSER_PATCH_HTTP_FAILED')
        while block:=response.read(1024**2):
            count+=len(block);h.update(block)
            if count>len(expected):raise ValueError('BROWSER_PATCH_HTTP_SIZE_FAILED')
        if count!=len(expected) or h.digest()!=hashlib.sha256(expected).digest():raise ValueError('BROWSER_PATCH_HTTP_DIGEST_FAILED')
    finally:secure.close()


def repair(state,source,*,apply=False,docker=None,check_http=check_served):
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
        ports=web.get('HostConfig',{}).get('PortBindings') or {}
        if not any(v.get('HostPort')=='443' for v in ports.get('8443/tcp',[])):raise ValueError('PUBLIC_TLS_REQUIRED')
        root=state/'files'/PATCH
        document=storage.read_private_json(state/'compose.json')
        updated=overlay_compose(document,root,original_source=release/'web')
        expected_mount=next(v['source'] for v in document['services']['web']['volumes'] if v.get('target')=='/srv/village-web')
        data=inputs(source)
        sql=photo_sql((release/'schema/catalog.sql').read_text(),(release/'schema/survey.sql').read_text())
        frozen_sql_hash=hashlib.sha256(sql.encode()).hexdigest()
        manifest={name:hashlib.sha256(value).hexdigest() for name,value in data.items()}
        identity={'releaseId':meta['releaseId'],'files':manifest,'sql_sha256':frozen_sql_hash}
        receipt_path=root/'receipt.json'
        receipt=storage.read_private_json(receipt_path) if receipt_path.exists() else {}
        if receipt and any(receipt.get(k)!=v for k,v in identity.items()):raise ValueError('BROWSER_PATCH_RECEIPT_CHANGED')
        allowed_mounts={expected_mount}
        if expected_mount==str(root/'web') and receipt.get('phase')=='sql_repaired':allowed_mounts.add(str(release/'web'))
        mounts=[v for v in web.get('Mounts',[]) if v.get('Destination')=='/srv/village-web']
        if len(mounts)!=1 or mounts[0].get('RW') is not False or mounts[0].get('Source') not in allowed_mounts:raise ValueError('RUNNING_WEB_MOUNT_CHANGED')
        if not apply:return {'status':'browser_repair_preflight_passed_no_changes','lessons':7}
        root.mkdir(parents=True,mode=0o700,exist_ok=True);storage.private_path(root,directory=True)
        if not receipt:
            # Before any schema or serving change, take a verified own snapshot.
            snapshot=load_script('backup-autonomous').backup(state,Path.home()/'village-autonomous-backups')
            receipt={**identity,'phase':'backed_up','backup':str(snapshot),'backup_sha256':storage.digest_file(snapshot/'backup.json')[0]}
            storage.write_private_json(receipt_path,receipt)
        elif storage.digest_file(Path(receipt['backup'])/'backup.json')[0]!=receipt['backup_sha256']:
            raise ValueError('PATCH_BACKUP_CHANGED')
        immutable_write(root/'original-compose.json',(json.dumps(document,sort_keys=True)+'\n').encode()) if receipt['phase']=='backed_up' else None
        overlay=root/'web'
        if not (root/'overlay-proof.json').exists():
            total=sum(p.stat().st_size for p in (release/'web').rglob('*') if p.is_file())+sum(map(len,data.values()))
            if shutil.disk_usage(root).free<4*1024**3+total:raise ValueError('BROWSER_PATCH_DISK_RESERVE_REQUIRED')
            if overlay.exists():raise ValueError('PARTIAL_WEB_OVERLAY_RETAINED')
            shutil.copytree(release/'web',overlay,copy_function=shutil.copyfile)
            for p in [overlay,*overlay.rglob('*')]:p.chmod(0o700 if p.is_dir() else 0o600)
            for name,value in data.items():
                target=overlay/name;target.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
                target.write_bytes(value);target.chmod(0o600)
            storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':tree_digest(overlay)})
        if tree_digest(overlay)!=storage.read_private_json(root/'overlay-proof.json')['tree_sha256']:raise ValueError('WEB_OVERLAY_CHANGED')
        before_ids={name:docker.own_container(name,meta['releaseId'])['Id'] for name in (API,AUTH,PG)}
        docker.sql(sql)
        receipt['phase']='sql_repaired';storage.write_private_json(receipt_path,receipt)
        storage.write_private_json(state/'compose.json',updated)
        docker.run('compose','-f',state/'compose.json','up','-d','--no-deps','--no-build','--pull','never','web')
        docker.run('exec',WEB,'/usr/sbin/nginx','-t')
        for name,value in data.items():
            for attempt in range(15):
                try:check_http(name,value,443);break
                except (OSError,ValueError,http.client.HTTPException):
                    if attempt==14:raise
                    time.sleep(1)
        if before_ids!={name:docker.own_container(name,meta['releaseId'])['Id'] for name in (API,AUTH,PG)}:raise ValueError('OTHER_SERVICES_CHANGED')
        if tree_digest(release/'web')!=meta['static_sha256'] or tree_digest(state/'control')!=meta['control_sha256']:raise ValueError('FROZEN_RELEASE_CHANGED')
        receipt['phase']='served_verified_browser_login_pending';storage.write_private_json(receipt_path,receipt)
        return {'status':'browser_entry_photos_lessons_repaired_real_browser_check_required','lessons':7,'other_services_retained':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    try:
        if os.name!='posix' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        print(json.dumps(repair(Path.home()/'village-autonomous',storage.source_checkout(),apply=args.apply)));return 0
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,http.client.HTTPException) as error:
        value=str(error);code=value if re.fullmatch('[A-Z_]{1,100}',value) else type(error).__name__
        print('STOP: BROWSER_REPAIR_FAILED category='+code+'. Keep backup, patch receipt and current data; do not rerun the initial installer.');return 1


if __name__=='__main__':raise SystemExit(main())
