#!/usr/bin/env python3
"""Guarded semester-group migration, preserving the live web and API overlays."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_operator import Docker,API,WEB,AUTH,PG,operation_lock,verified_runtime
from autonomous_extract import tree_digest
from semester_group_policy import patch_sql,replacements,helper_bodies,quote

PATCH='semester-groups-20261028-v1'
CONTRACT='/opt/village/business-api/unified/contracts.mjs'


def sha(data):return hashlib.sha256(data).hexdigest()


def apply_edits(data,edits):
    text=data.decode('utf8').replace('\r\n','\n')
    for edit in edits:
        before,after=edit['before'],edit['after']
        if not before or not after:raise ValueError('SEMESTER_EDIT_CONTEXT_REQUIRED')
        if text.count(before)==1:text=text.replace(before,after,1)
        elif text.count(before)==0 and text.count(after)==1:continue
        else:raise ValueError('SEMESTER_WEB_BASELINE_CHANGED')
    return text.encode('utf8')


def overlay_compose(document,root):
    updated=copy.deepcopy(document)
    web=updated['services']['web']['volumes']
    matches=[v for v in web if v.get('target')=='/srv/village-web']
    if len(matches)!=1 or not matches[0].get('read_only'):raise ValueError('SEMESTER_WEB_MOUNT_REQUIRED')
    matches[0]['source']=str(root/'web')
    api=updated['services']['api'].setdefault('volumes',[])
    existing=[v for v in api if v.get('target')==CONTRACT]
    if len(existing)>1:raise ValueError('SEMESTER_API_MOUNT_CHANGED')
    if existing:existing[0].update(source=str(root/'contracts.mjs'),read_only=True)
    else:api.append({'type':'bind','source':str(root/'contracts.mjs'),'target':CONTRACT,'read_only':True})
    return updated


def healthy(docker,name):
    for attempt in range(30):
        row=docker.inspect(name)
        if row['State'].get('Running') and row['State'].get('Health',{}).get('Status','healthy')=='healthy':return row
        time.sleep(1)
    raise ValueError('SEMESTER_SERVICE_NOT_HEALTHY')


def read_contract(docker):
    return docker.run('exec',API,'cat',CONTRACT).encode('utf8')


def atomic_content(path,data):
    storage.no_links(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        if path.read_bytes()!=data:raise ValueError('SEMESTER_PREPARED_BYTES_CHANGED')
        return
    part=path.with_name(path.name+'.semester-part');storage.no_links(part)
    if part.exists() and not data.startswith(part.read_bytes()):raise ValueError('SEMESTER_PARTIAL_BYTES_CHANGED')
    with part.open('wb') as stream:
        stream.write(data);stream.flush();os.fsync(stream.fileno())
    part.chmod(0o644);os.replace(part,path)


def prepare_files(original,root,updates,contract):
    expected={p.relative_to(original).as_posix():updates.get(p.relative_to(original).as_posix(),storage.no_links(p).read_bytes())
        for p in original.rglob('*') if p.is_file()}
    target=root/'web'
    staging=target if target.exists() else root/'web-preparing'
    staging.mkdir(parents=True,exist_ok=True)
    for p in staging.rglob('*'):
        storage.no_links(p)
        if p.is_file() and p.relative_to(staging).as_posix().removesuffix('.semester-part') not in expected:
            raise ValueError('SEMESTER_PARTIAL_TREE_CHANGED')
    for name,data in expected.items():atomic_content(staging/name,data)
    for directory in (staging,*[p for p in staging.rglob('*') if p.is_dir()]):directory.chmod(0o755)
    if staging!=target:os.replace(staging,target)
    atomic_content(root/'contracts.mjs',contract)
    return tree_digest(target),sha(contract)


def rendered_compose(docker,path,runtime):
    return json.loads(docker.run('compose','--project-name','village-autonomous',
        '--project-directory',runtime,'-f',path,'config','--format','json'))


def verify_resume_runtime(docker,state,root,receipt,meta,document):
    """A stopped/removed API is accepted only under this saved operation's exact plan."""
    for name in (AUTH,PG):
        row=docker.own_container(name,meta['releaseId'])
        if row['Id']!=receipt['preserved'][name] or not row['State'].get('Running'):
            raise ValueError('SEMESTER_OTHER_SERVICES_CHANGED')
    saved=storage.read_private_json(root/'original-compose.json')
    if sha(json.dumps(saved,sort_keys=True).encode())!=receipt['original_compose_sha256']:
        raise ValueError('SEMESTER_ORIGINAL_COMPOSE_CHANGED')
    if document not in (saved,overlay_compose(saved,root)):raise ValueError('SEMESTER_RESUME_COMPOSE_CHANGED')
    import component_rollout as components
    for name,service in ((API,'api'),(WEB,'web')):
        names=docker.run('container','ls','--all','--filter','name=^/'+name+'$','--format','{{.Names}}').splitlines()
        if not names:continue
        if names!=[name]:raise ValueError('SEMESTER_CONTAINER_IDENTITY_CHANGED')
        row=docker.own_container(name,meta['releaseId'])
        if row['Image']!=receipt['images'][name]:raise ValueError('SEMESTER_CONTAINER_IMAGE_CHANGED')
        image=json.loads(docker.run('image','inspect',row['Image']))[0]
        accepted=False
        for path in (root/'original-compose.json',state/'compose.json'):
            try:components.validate_rendered(row,rendered_compose(docker,path,state),service,image);accepted=True;break
            except ValueError:pass
        if not accepted:raise ValueError('SEMESTER_CONTAINER_CONFIG_CHANGED')
    return saved


def verify(docker,root,receipt,source):
    if receipt.get('phase')!='complete':raise ValueError('SEMESTER_ROLLOUT_INCOMPLETE')
    docker.sql(patch_sql(source,apply=False))
    bodies=[(signature,after) for signature,_,after in replacements(source)]+helper_bodies(source)
    checks=['(SELECT prosrc='+quote(after)+' FROM pg_proc WHERE oid='+quote(signature)+'::regprocedure)' for signature,after in bodies]
    if docker.sql('SELECT '+ ' AND '.join(checks)+';').strip()!='t':raise ValueError('SEMESTER_SQL_NOT_APPLIED')
    if tree_digest(root/'web')!=receipt['web_sha256'] or sha(read_contract(docker))!=receipt['contract_sha256']:
        raise ValueError('SEMESTER_DEPLOYED_BYTES_CHANGED')
    for name in (API,WEB):
        if healthy(docker,name)['Id']!=receipt['after'][name]:raise ValueError('SEMESTER_CONTAINER_CHANGED')
    for name in (AUTH,PG):
        if docker.inspect(name)['Id']!=receipt['preserved'][name]:raise ValueError('SEMESTER_OTHER_SERVICES_CHANGED')
    return {'status':'semester_groups_deployed_browser_acceptance_required','workers_replaced':False}


def repair(state,source,*,apply=False,docker=None):
    state=storage.private_path(state,directory=True);source=Path(source)
    with operation_lock(state):
        docker=docker or Docker(state)
        meta=storage.read_private_json(state/'release.json')
        if meta.get('schemaVersion')!=2 or meta.get('kind')!='autonomous':raise ValueError('LOCAL_RUNTIME_REQUIRED')
        edits=storage.no_links(source/'linux/semester-group-web-edits.json').read_bytes()
        manifest=json.loads(edits)
        sql=patch_sql(source)
        identity={'releaseId':meta['releaseId'],'edits_sha256':sha(edits),'sql_sha256':sha(sql.encode())}
        root=state/'files'/PATCH
        receipt=storage.read_private_json(root/'receipt.json') if (root/'receipt.json').exists() else None
        if receipt and any(receipt.get(k)!=v for k,v in identity.items()):raise ValueError('SEMESTER_RECEIPT_CHANGED')
        document=storage.read_private_json(state/'compose.json')
        if receipt:
            if sha(storage.no_links(Path(receipt['backup'])/'backup.json').read_bytes())!=receipt['backup_sha256']:
                raise ValueError('SEMESTER_BACKUP_CHANGED')
            original_document=verify_resume_runtime(docker,state,root,receipt,meta,document)
            if receipt.get('phase')=='complete':
                verified_runtime(docker,state)
                return verify(docker,root,receipt,source)
            if receipt.get('phase') not in ('backed_up','prepared','sql_applied'):raise ValueError('SEMESTER_RECEIPT_PHASE_CHANGED')
        else:
            verified_runtime(docker,state)
            original_document=document
            # Validate the rendered resource/network/mount configuration before touching it.
            import component_rollout as components
            rendered=components.render_cloud_compose(docker,state)
            for name,service in ((API,'api'),(WEB,'web')):
                row=docker.own_container(name,meta['releaseId'])
                image=json.loads(docker.run('image','inspect',row['Image']))[0]
                components.validate_rendered(row,rendered,service,image)
        web_mounts=[v for v in original_document['services']['web']['volumes'] if v.get('target')=='/srv/village-web']
        if len(web_mounts)!=1 or not web_mounts[0].get('read_only'):raise ValueError('SEMESTER_WEB_MOUNT_REQUIRED')
        original=storage.no_links(Path(web_mounts[0]['source']))
        if state/'files' not in original.parents:raise ValueError('SEMESTER_MANAGED_WEB_REQUIRED')
        # Do not overwrite newer independent fixes in live files: only known fragments change.
        updates={name:apply_edits(storage.no_links(original/name).read_bytes(),changes)
            for name,changes in manifest['web'].items()}
        contract=apply_edits(read_contract(docker),manifest['contracts']) if not receipt else receipt['planned_contract'].encode()
        if receipt and sha(contract)!=receipt['planned_contract_sha256']:raise ValueError('SEMESTER_PLANNED_CONTRACT_CHANGED')
        docker.sql(patch_sql(source,apply=False))
        if not apply:return {'status':'semester_groups_preflight_passed_no_service_or_data_changes','web_files':len(updates)}
        if not receipt:
            load_script('backup-autonomous').require_idle(docker)
            backup=load_script('backup-autonomous').backup(state,Path.home()/'village-autonomous-backups')
            root.mkdir(parents=True,mode=0o700,exist_ok=True)
            storage.write_private_json(root/'original-compose.json',original_document)
            # Preserve the exact old functions for investigation; schema rollback is never automatic.
            definitions=[docker.sql('SELECT pg_get_functiondef('+quote(signature)+'::regprocedure);') for signature,_,_ in replacements(source)]
            (root/'original-functions.sql').write_text('\n'.join(definitions),encoding='utf8');(root/'original-functions.sql').chmod(0o600)
            receipt={**identity,'phase':'backed_up','backup':str(backup),'backup_sha256':sha((backup/'backup.json').read_bytes()),
                'original_web':str(original),'original_web_sha256':tree_digest(original),
                'original_compose_sha256':sha(json.dumps(original_document,sort_keys=True).encode()),
                'planned_contract':contract.decode(),'planned_contract_sha256':sha(contract),
                'images':{n:docker.inspect(n)['Image'] for n in (API,WEB)},
                'preserved':{n:docker.inspect(n)['Id'] for n in (AUTH,PG)}}
            storage.write_private_json(root/'receipt.json',receipt)
        if tree_digest(original)!=receipt['original_web_sha256']:raise ValueError('SEMESTER_ORIGINAL_WEB_CHANGED')
        if receipt['phase']=='backed_up':
            if shutil.disk_usage(root).free < 2*1024**3+sum(p.stat().st_size for p in original.rglob('*') if p.is_file()):
                raise ValueError('SEMESTER_DISK_RESERVE_REQUIRED')
            web_hash,contract_hash=prepare_files(original,root,updates,contract)
            receipt.update(phase='prepared',web_sha256=web_hash,contract_sha256=contract_hash)
            storage.write_private_json(root/'receipt.json',receipt)
        if tree_digest(root/'web')!=receipt['web_sha256'] or sha((root/'contracts.mjs').read_bytes())!=receipt['contract_sha256']:
            raise ValueError('SEMESTER_PREPARED_BYTES_CHANGED')
        # Syntax-check in the existing image without installing packages.
        docker.run('run','--rm','-i','--pull','never','--network','none','--memory','128m','--pids-limit','64',
            '--read-only','--cap-drop','ALL','--entrypoint','node',receipt['images'][API],'--input-type=module','--check',input=contract.decode())
        docker.sql(sql)
        receipt['phase']='sql_applied';storage.write_private_json(root/'receipt.json',receipt)
        storage.write_private_json(state/'compose.json',overlay_compose(original_document,root))
        docker.run('compose','-f',state/'compose.json','up','-d','--no-deps','--no-build','--pull','never','api','web')
        after={n:healthy(docker,n)['Id'] for n in (API,WEB)}
        docker.run('exec',WEB,'/usr/sbin/nginx','-t')
        browser=load_script('repair-autonomous-browser')
        for name in updates:browser.check_served(name,(root/'web'/name).read_bytes(),443)
        receipt.update(phase='complete',after=after);storage.write_private_json(root/'receipt.json',receipt)
        return verify(docker,root,receipt,source)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    try:
        if os.name!='posix' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        print(json.dumps(repair(Path.home()/'village-autonomous',storage.source_checkout(),apply=args.apply)))
        return 0
    except (OSError,ValueError,RuntimeError,KeyError,TypeError) as error:
        code=str(error) if str(error).replace('_','').isalnum() and len(str(error))<100 else type(error).__name__
        print('STOP: SEMESTER_GROUP_ROLLOUT_FAILED category='+code+'. Retain backup, receipts and private logs; do not reset or rerun the initial installer.')
        return 1


if __name__=='__main__':raise SystemExit(main())
