#!/usr/bin/env python3
"""Quiesce the exact autonomous writers and archive database plus private files."""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time
import threading
import business_storage_copy as storage
from autonomous_operator import Docker,API,AUTH,PG,ADMIN,DATABASE,clean_environment,operation_lock


@contextlib.contextmanager
def quiesce(docker,meta):
    before={name:docker.own_container(name,meta['releaseId']) for name in (API,AUTH)}
    for name,obj in before.items():
        allowed=meta['accepted_image_ids'] if name==API else [meta['auth_image_id']]
        if obj['Image'] not in allowed:raise ValueError('QUIESCE_IMAGE_DIFFERS')
    stopped=[]
    try:
        for name,obj in before.items():
            if obj['State']['Running']:
                stopped.append(name)
                docker.run('stop','--time','30',obj['Id'])
        yield
    finally:
        # Check the entire set before starting any writer. A replacement is not
        # the process this command stopped, even if its public name is reused.
        for name in stopped:
            obj=docker.own_container(name,meta['releaseId'])
            if (obj['Id'],obj['Image'])!=(before[name]['Id'],before[name]['Image']):raise ValueError('QUIESCED_CONTAINER_CHANGED')
        for name in stopped:docker.run('start',before[name]['Id'])


def required_paths(meta):
    return ['secrets','files','scene-files','storage/blobs','control','releases/'+meta['releaseId'],
            'tls','certbot-production/config','compose.json','release.json','storage-index.json','nginx.conf']


def backup_layout(state,meta):
    state=storage.private_path(state,directory=True);files={};links={}
    for relative in required_paths(meta):
        root=state/relative
        if not root.exists() or root.is_symlink():raise ValueError('BACKUP_REQUIRED_PATH_MISSING')
        paths=[root,*root.rglob('*')] if root.is_dir() else [root]
        for path in paths:
            name=path.relative_to(state).as_posix()
            if path.is_symlink():
                target=path.resolve(strict=True)
                if name=='tls/current':
                    if target.parent!=state/'tls/versions' or not target.is_dir():raise ValueError('BACKUP_TLS_LINK_INVALID')
                elif name.startswith('certbot-production/config/live/8.148.248.237/'):
                    if target.parent!=state/'certbot-production/config/archive/8.148.248.237' or not target.is_file():raise ValueError('BACKUP_CERTBOT_LINK_INVALID')
                else:raise ValueError('BACKUP_LINK_REFUSED')
                links[name]=os.readlink(path)
                continue
            st=path.stat()
            if os.name=='posix' and (st.st_uid!=os.geteuid() or st.st_mode&0o022):raise ValueError('BACKUP_OPERATOR_PATH_REQUIRED')
            if path.is_file():
                if st.st_nlink!=1:raise ValueError('BACKUP_HARDLINK_REFUSED')
                files[name]=path
            elif not path.is_dir():raise ValueError('BACKUP_SPECIAL_FILE_REFUSED')
            if len(files)+len(links)>300000:raise ValueError('BACKUP_FILE_LIMIT')
    return files,links


def backup_files(state,meta):return backup_layout(state,meta)[0]


def stream_command(command,path,*,maximum,reserve=4*1024**3,timeout=600):
    path=storage.no_links(path);storage.private_path(path.parent,directory=True)
    if path.exists():raise ValueError('BACKUP_OUTPUT_ALREADY_EXISTS')
    log=path.with_name(path.name+'.error.log');deadline=time.monotonic()+timeout
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output,os.fdopen(os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as errors:
        process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=errors,env=clean_environment())
        timed_out=threading.Event()
        def expire():
            if process.poll() is None:
                timed_out.set()
                try:process.kill()
                except OSError:pass
        timer=threading.Timer(timeout,expire);timer.daemon=True;timer.start()
        count=0;digest=hashlib.sha256()
        try:
            while block:=process.stdout.read(1024**2):
                count+=len(block)
                if count>maximum:raise ValueError('BACKUP_STREAM_SIZE_LIMIT')
                if time.monotonic()>deadline:raise ValueError('BACKUP_STREAM_TIMEOUT')
                if shutil.disk_usage(path.parent).free<reserve+len(block):raise ValueError('BACKUP_DISK_RESERVE_REQUIRED')
                output.write(block);digest.update(block)
            code=process.wait(timeout=max(1,deadline-time.monotonic()))
            if timed_out.is_set() or time.monotonic()>deadline:raise ValueError('BACKUP_STREAM_TIMEOUT')
            if code:raise ValueError('BACKUP_ARCHIVE_PROCESS_FAILED')
            output.flush();os.fsync(output.fileno())
        finally:
            timer.cancel()
            if process.poll() is None:process.kill()
            process.wait();process.stdout.close()
    return {'bytes':count,'sha256':digest.hexdigest()}


def copy_private(source,target):
    target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    digest=hashlib.sha256();count=0
    with Path(source).open('rb') as before,os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as after:
        while block:=before.read(1024**2):
            if shutil.disk_usage(target.parent).free<4*1024**3+len(block):raise ValueError('BACKUP_DISK_RESERVE_REQUIRED')
            after.write(block);digest.update(block);count+=len(block)
        after.flush();os.fsync(after.fileno())
    if storage.digest_file(target)!=(digest.hexdigest(),count):raise ValueError('BACKUP_COPY_DIGEST_FAILED')
    return {'bytes':count,'sha256':digest.hexdigest()}


def backup(state,output_root):
    state=storage.private_path(state,directory=True);meta=storage.read_private_json(state/'release.json');docker=Docker(state)
    if meta.get('schemaVersion')!=2 or meta.get('kind')!='autonomous':raise ValueError('AUTONOMOUS_BACKUP_ONLY')
    pg=docker.own_container(PG,meta['releaseId'])
    if pg.get('Image')!=meta['postgres_image_id'] or not pg.get('State',{}).get('Running'):raise ValueError('BACKUP_PG_IDENTITY_REQUIRED')
    output_root=storage.no_links(output_root)
    for forbidden in [state,storage.source_checkout(),Path.home()/'village-deploy']:
        if output_root==forbidden or output_root in forbidden.parents or forbidden in output_root.parents:raise ValueError('BACKUP_PATH_OVERLAP')
    output_root.mkdir(parents=True,exist_ok=True,mode=0o700);storage.private_path(output_root,directory=True)
    destination=output_root/(dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-')+secrets.token_hex(6));destination.mkdir(mode=0o700)
    from autonomous_bundle import load_script
    prepare_tls=load_script('prepare-ip-tls')
    with prepare_tls.tls_lock(state),quiesce(docker,meta):
        files,links=backup_layout(state,meta)
        size=int(docker.sql('SELECT pg_database_size(current_database());').strip())
        required=sum(path.stat().st_size for path in files.values())+max(512*1024**2,size*2)
        if shutil.disk_usage(destination).free<4*1024**3+required:raise ValueError('BACKUP_DISK_RESERVE_REQUIRED')
        rows={}
        rows['database.dump']=stream_command([*docker.prefix,'exec',PG,'pg_dump','--format=custom','--no-password','-h','/var/run/postgresql','-U',ADMIN,'-d',DATABASE],
            destination/'database.dump',maximum=max(512*1024**2,size*2))
        rows['roles.sql']=stream_command([*docker.prefix,'exec',PG,'pg_dumpall','--roles-only','--no-role-passwords','--no-password',
            '-h','/var/run/postgresql','-U',ADMIN],destination/'roles.sql',maximum=8*1024**2)
        for name,source in files.items():rows['state/'+name]=copy_private(source,destination/'state'/name)
        # Decode the full custom archive offline as a structural corruption
        # check. An actual fresh-target restore is a separate acceptance gate.
        stream_command([*docker.prefix,'run','--rm','--pull=never','--network','none','--read-only','--user',f'{os.geteuid()}:{os.getegid()}',
            '--cap-drop','ALL','--memory','256m','--mount',f'type=bind,source={destination},target=/backup,readonly','--entrypoint','pg_restore',
            meta['postgres_image_id'],'--file=/dev/null','/backup/database.dump'],destination/'offline-check.txt',maximum=1024**2)
        after_files,after_links=backup_layout(state,meta)
        if set(files)!=set(after_files) or links!=after_links:raise ValueError('BACKUP_FILE_SET_CHANGED')
        for name,source in files.items():
            if storage.digest_file(source)!=(rows['state/'+name]['sha256'],rows['state/'+name]['bytes']):raise ValueError('BACKUP_SOURCE_FILE_CHANGED')
        manifest={'version':1,'status':'autonomous_snapshot_verified_not_test_restored','releaseId':meta['releaseId'],'created_at':storage.now(),
            'database':DATABASE,'postgres_image_id':pg['Image'],'files':rows,'controlled_symlinks':links,
            'limits':['No overwrite restore or source synchronization was executed.','Keep the private key and data backup outside public web and Git.']}
        storage.write_private_json(destination/'backup.json',manifest)
    return destination


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-root',type=Path,default=Path.home()/'village-autonomous-backups');args=parser.parse_args()
    try:
        os.umask(0o077);state=Path.home()/'village-autonomous'
        with operation_lock(state):destination=backup(state,args.output_root)
        print('AUTONOMOUS_OWN_BACKUP_VERIFIED_NOT_TEST_RESTORED');print('Backup directory: '+str(destination));return 0
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        print('STOP: AUTONOMOUS_BACKUP_FAILED. Keep partial private backup and logs; verify original writer status.');return 1


if __name__=='__main__':raise SystemExit(main())
