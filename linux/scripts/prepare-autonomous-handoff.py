#!/usr/bin/env python3
"""Pack fresh private inputs and pinned images; unpack without running a database."""
import argparse
import hashlib
import io
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import warnings
import tempfile
import business_storage_copy as storage
from autonomous_bundle import load_script,validate_fresh_snapshot

LIMIT=12*1024**3
BACKUP=('database.dump','roles.sql','inventory.json','manifest.json','contents.txt')
STORAGE=('inventory.json','auth-compatibility.json','copy-manifest.json','storage-index.json','full-copy-proof.json')


def allowed(name):
    return isinstance(name,str) and (name in {'backup/'+v for v in BACKUP}|{'storage/'+v for v in STORAGE}|{'release/autonomous-release.json'}
        or re.fullmatch(r'storage/blobs/[a-f0-9]{64}',name) is not None
        or re.fullmatch(r'images/[a-z0-9][a-z0-9.-]{0,150}\.tar(?:\.gz)?',name) is not None)


def private_directory(root):
    root=storage.no_links(root)
    if root.exists():raise ValueError('HANDOFF_DESTINATION_ALREADY_EXISTS')
    root.mkdir(parents=True,mode=0o700)
    if os.name=='nt':load_script('backup-managed-db').private_directory(root)
    return storage.private_path(root,directory=True)


def pack_files(files,archive):
    archive=storage.no_links(archive)
    if not archive.parent.exists():private_directory(archive.parent)
    storage.private_path(archive.parent,directory=True)
    if os.name=='nt':load_script('backup-managed-db').private_directory(archive.parent)
    if archive.exists():raise ValueError('HANDOFF_ARCHIVE_ALREADY_EXISTS')
    if not files or len(files)>300000 or any(not allowed(name) for name in files):raise ValueError('HANDOFF_MEMBER_REFUSED')
    records={}
    for name,path in sorted(files.items()):
        path=storage.private_path(path)
        if path.stat().st_nlink!=1:raise ValueError('HANDOFF_LINK_REFUSED')
        digest,size=storage.digest_file(path);records[name]={'bytes':size,'sha256':digest}
    total=sum(v['bytes'] for v in records.values())
    if total>LIMIT or shutil.disk_usage(archive.parent).free<4*1024**3+total:raise ValueError('HANDOFF_DISK_RESERVE_REQUIRED')
    manifest={'version':1,'kind':'autonomous-private-inputs','files':records}
    with os.fdopen(os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output,tarfile.open(fileobj=output,mode='w|') as tar:
        data=json.dumps(manifest,sort_keys=True).encode();header=tarfile.TarInfo('handoff.json');header.mode=0o600;header.size=len(data);tar.addfile(header,io.BytesIO(data))
        for name,record in records.items():
            header=tarfile.TarInfo(name);header.mode=0o600;header.size=record['bytes']
            with Path(files[name]).open('rb') as source:tar.addfile(header,source)
            if storage.digest_file(files[name])!=(record['sha256'],record['bytes']):raise ValueError('HANDOFF_SOURCE_CHANGED')
    return storage.digest_file(archive)


def unpack(archive,target):
    archive=storage.private_path(archive);target=storage.no_links(target)
    if target.exists():raise ValueError('HANDOFF_DESTINATION_ALREADY_EXISTS')
    with tarfile.open(archive,'r|*') as tar:
        header=tar.next()
        if not header or header.name!='handoff.json' or not header.isfile() or header.size>64*1024**2:raise ValueError('HANDOFF_MANIFEST_REQUIRED')
        manifest=json.loads(tar.extractfile(header).read());records=manifest.get('files')
        if manifest.get('version')!=1 or manifest.get('kind')!='autonomous-private-inputs' or not isinstance(records,dict) or not 1<=len(records)<=300000:raise ValueError('HANDOFF_MANIFEST_REQUIRED')
        for name,row in records.items():
            if not allowed(name) or not isinstance(row,dict) or type(row.get('bytes')) is not int or not 0<=row['bytes']<=LIMIT or not re.fullmatch('[a-f0-9]{64}',row.get('sha256','')):raise ValueError('HANDOFF_MEMBER_REFUSED')
        total=sum(row['bytes'] for row in records.values())
        if total>LIMIT or shutil.disk_usage(target.parent).free<4*1024**3+total:raise ValueError('HANDOFF_DISK_RESERVE_REQUIRED')
        private_directory(target);seen=set()
        while member:=tar.next():
            if member.name not in records or member.name in seen or not member.isfile() or member.size!=records[member.name]['bytes']:raise ValueError('HANDOFF_MEMBER_REFUSED')
            seen.add(member.name);path=target/member.name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            digest=hashlib.sha256();count=0
            with tar.extractfile(member) as source,os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:
                while block:=source.read(1024**2):
                    if shutil.disk_usage(target).free<4*1024**3+len(block):raise ValueError('HANDOFF_DISK_RESERVE_REQUIRED')
                    output.write(block);digest.update(block);count+=len(block)
                output.flush();os.fsync(output.fileno())
            if (digest.hexdigest(),count)!=(records[member.name]['sha256'],records[member.name]['bytes']):raise ValueError('HANDOFF_FILE_CHECKSUM_DIFFERS')
        if seen!=set(records):raise ValueError('HANDOFF_INCOMPLETE')
    storage.write_private_json(target/'handoff.json',manifest)
    return target


def collect(backup,source_files,image_dir,metadata,*,image_overrides=None):
    rd=load_script('restore-db-copy');manifest=rd.verify_backup(backup);validate_fresh_snapshot(manifest)
    deploy=load_script('deploy-autonomous');deploy.storage_input(source_files,manifest['files']['database.dump']['sha256'])
    auth=storage.read_private_json(Path(source_files)/'auth-compatibility.json')
    if auth.get('status')!='compatible_password_accounts_not_login_verified' or auth.get('unsupported_features')!=0:raise ValueError('AUTH_COMPATIBILITY_REQUIRED')
    meta=json.loads(Path(metadata).read_text());files={'backup/'+name:Path(backup)/name for name in BACKUP}
    files.update({'storage/'+name:Path(source_files)/name for name in STORAGE})
    for path in (Path(source_files)/'blobs').iterdir():
        if path.is_file() and re.fullmatch('[a-f0-9]{64}',path.name):files['storage/blobs/'+path.name]=path
        else:raise ValueError('HANDOFF_UNEXPECTED_STORAGE_FILE')
    runtime=[meta,*[json.loads((Path(__file__).resolve().parents[1]/(name+'-runtime.json')).read_text()) for name in ('auth','nginx','certbot')]]
    for row in runtime:
        path=(image_overrides or {}).get(row['archive_filename'],Path(image_dir)/row['archive_filename'])
        if storage.digest_file(storage.private_path(path))!=(row['archive_sha256'],row['archive_bytes']):raise ValueError('HANDOFF_IMAGE_ARCHIVE_DIFFERS')
        files['images/'+path.name]=path
    files['release/autonomous-release.json']=Path(metadata)
    return files


def load_images(root):
    from autonomous_operator import Docker,resolve_image
    deploy=load_script('deploy-autonomous');root=storage.private_path(root,directory=True);meta=storage.read_private_json(root/'release/autonomous-release.json');docker=Docker(root)
    runtimes=[meta,*[json.loads((Path(__file__).resolve().parents[1]/(name+'-runtime.json')).read_text()) for name in ('auth','nginx','certbot')]]
    for row in runtimes:
        path=root/'images'/row['archive_filename']
        if storage.digest_file(storage.private_path(path))!=(row['archive_sha256'],row['archive_bytes']):raise ValueError('HANDOFF_IMAGE_ARCHIVE_DIFFERS')
        docker.run('load','-i',path,timeout=600)
    deploy.assert_images(docker,meta)
    return meta



def refresh_release(root,image,output,metadata,*,state=None):
    """Reuse an unchanged private snapshot before first deployment only."""
    state=Path(state) if state is not None else Path.home()/'village-autonomous'
    from autonomous_operator import operation_lock
    if not state.exists():private_directory(state)
    with operation_lock(state):
        if any((state/name).exists() for name in ('release.json','inputs.json','initial-baseline.json','autonomous-checkpoints.json','public-switch.json')):
            raise ValueError('PREDEPLOY_RELEASE_REFRESH_ONLY')
        root=storage.private_path(root,directory=True);output=storage.no_links(output)
        if output.exists() or root in output.parents:raise ValueError('HANDOFF_DESTINATION_ALREADY_EXISTS')
        manifest=storage.read_private_json(root/'handoff.json');rows=manifest.get('files')
        if manifest.get('version')!=1 or manifest.get('kind')!='autonomous-private-inputs' or not isinstance(rows,dict) or not 1<=len(rows)<=300000:raise ValueError('HANDOFF_MANIFEST_REQUIRED')
        for name,row in rows.items():
            if not allowed(name) or not isinstance(row,dict) or storage.digest_file(storage.private_path(root/name))!=(row.get('sha256'),row.get('bytes')):
                raise ValueError('RECEIVED_HANDOFF_FILE_CHANGED')
        old=storage.read_private_json(root/'release/autonomous-release.json');new=json.loads(Path(metadata).read_text())
        for key in ('kind','schemaVersion','instanceId','code_sha256','schema_sha256','source_defaults','auth_image_id','nginx_image_id','postgres_image_id'):
            if key not in old or old[key]!=new.get(key):raise ValueError('BOOTSTRAP_RELEASE_COMPATIBILITY_REQUIRED')
        image=storage.private_path(image)
        if image.name!=new.get('archive_filename'):raise ValueError('HANDOFF_IMAGE_ARCHIVE_DIFFERS')
        files=collect(root/'backup',root/'storage',root/'images',metadata,image_overrides={image.name:image})
        # Preserve the old received tree and private snapshot, including on any
        # failure. No hardlinks (private readers reject shared inodes).
        work=Path(tempfile.mkdtemp(prefix='received-refresh-',dir=state))
        private_meta=work/'autonomous-release.json';storage.write_private_json(private_meta,new)
        files['release/autonomous-release.json']=private_meta
        archive=work/'verified-private.tar';pack_files(files,archive);unpack(archive,output)
    return output


def prepare(output,pg_bin,image_dir,metadata):
    # Two different hidden secrets; neither is persisted in the upload bundle.
    backup_tool=load_script('backup-managed-db');inputs=load_script('prepare-autonomous-inputs')
    for name in ('psql','pg_dump','pg_dumpall','pg_restore'):
        if not os.access(backup_tool.pg_tool(pg_bin,name),os.X_OK):raise ValueError('PG17_CLIENTS_REQUIRED')
    output=storage.no_links(output)
    if output.exists():raise ValueError('HANDOFF_ARCHIVE_ALREADY_EXISTS')
    with warnings.catch_warnings():
        warnings.simplefilter('error',getpass.GetPassWarning)
        password=getpass.getpass('Supabase DATABASE password (hidden; NOT Secret key): ')
    backup=backup_tool.backup(Path.home()/'village-db-backups',pg_bin,password,storage.source_checkout(),Path.home());password=None
    manifest,fresh,auth,doc=inputs.inspect_inputs(backup,pg_bin=pg_bin)
    source_files=Path.home()/'village-autonomous-inputs'/doc['source_archive_sha256'][:24]
    inputs.initialize_inputs(source_files,doc,auth)
    with warnings.catch_warnings():
        warnings.simplefilter('error',getpass.GetPassWarning)
        key=getpass.getpass('Supabase SERVER Secret key (hidden; NOT database password): ')
    result=storage.copy_inventory(source_files/'inventory.json',source_files,key,
        selected_buckets=storage.all_inventory_buckets(doc),check_source_inventory=True);key=None
    if any(result[s] for s in ('pending','failed','missing','source_changed')):raise ValueError('ALL_STORAGE_BYTES_REQUIRED')
    index=inputs.build_index(source_files);storage.write_private_json(source_files/'storage-index.json',index)
    storage.write_private_json(source_files/'full-copy-proof.json',{'version':1,'status':'all_source_storage_verified_not_cut_over',
        'source_archive_sha256':doc['source_archive_sha256'],'inventory_sha256':storage.inventory_digest(doc),
        'objects':len(index['objects']),'verified_bytes':result['verified_bytes'],'source_checked_at':storage.now()})
    digest,size=pack_files(collect(backup,source_files,image_dir,metadata),output)
    return {'archive':str(output),'bytes':size,'sha256':digest,'all_objects':len(index['objects'])}


def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group(required=True);g.add_argument('--pack',action='store_true');g.add_argument('--prepare',action='store_true');g.add_argument('--unpack',type=Path);g.add_argument('--load-images',type=Path);g.add_argument('--refresh-release',type=Path)
    p.add_argument('--backup-dir',type=Path);p.add_argument('--storage-dir',type=Path);p.add_argument('--image-dir',type=Path,default=Path.home()/'village-image-transfer');p.add_argument('--output',type=Path,required=False)
    p.add_argument('--image-archive',type=Path)
    p.add_argument('--metadata',type=Path,default=Path(__file__).resolve().parents[1]/'autonomous-release.json');a=p.parse_args()
    try:
        os.umask(0o077)
        if a.prepare:
            if not a.output:raise ValueError('HANDOFF_OUTPUT_REQUIRED')
            pg_bin=Path.home()/'.codex/tools/village-pg17/pgsql/bin' if os.name=='nt' else Path('/usr/lib/postgresql/17/bin')
            print(json.dumps(prepare(a.output,pg_bin,a.image_dir,a.metadata)));print('AUTONOMOUS_FRESH_PRIVATE_HANDOFF_PACKED_NOT_DEPLOYED')
        elif a.pack:
            if not a.backup_dir or not a.storage_dir or not a.output:raise ValueError('HANDOFF_PATHS_REQUIRED')
            files=collect(a.backup_dir,a.storage_dir,a.image_dir,a.metadata);digest,size=pack_files(files,a.output)
            print(json.dumps({'archive':str(a.output),'bytes':size,'sha256':digest}));print('AUTONOMOUS_PRIVATE_HANDOFF_PACKED_NOT_DEPLOYED')
        elif a.refresh_release:
            if not a.output or not a.image_archive:raise ValueError('HANDOFF_PATHS_REQUIRED')
            refresh_release(a.refresh_release,a.image_archive,a.output,a.metadata);print('AUTONOMOUS_RECEIVED_RELEASE_REFRESHED_NOT_INSTALLED')
        elif a.unpack:
            if not a.output:raise ValueError('HANDOFF_OUTPUT_REQUIRED')
            unpack(a.unpack,a.output);print('AUTONOMOUS_PRIVATE_HANDOFF_UNPACKED_NOT_DEPLOYED')
        else:load_images(a.load_images);print('AUTONOMOUS_PINNED_IMAGES_LOADED_NOT_DEPLOYED')
        return 0
    except (OSError,ValueError,RuntimeError,tarfile.TarError,getpass.GetPassWarning,EOFError):
        print('STOP: AUTONOMOUS_HANDOFF_FAILED. Keep private partial files; do not overwrite, publish or paste their contents.');return 1


if __name__=='__main__':raise SystemExit(main())
