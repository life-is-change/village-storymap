#!/usr/bin/env python3
"""Prepare all source object bytes from a fresh verified archive, without source writes."""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import warnings
import business_storage_copy as storage
import autonomous_bundle as bundle

ROOT=Path(__file__).resolve().parents[2]


def initialize_inputs(root,doc,auth_report):
    root=storage.no_links(root);doc=storage.validate_inventory(doc)
    if root.exists():
        storage.private_path(root,directory=True)
        if storage.read_private_json(root/'inventory.json')!=doc or storage.read_private_json(root/'auth-compatibility.json')!=auth_report:
            raise ValueError('INPUT_SNAPSHOT_IDENTITY_CHANGED')
        return root
    storage.new_run_directory(root,[ROOT,Path.home()/'village-deploy',Path.home()/'village-db-backups'])
    # NTFS needs an ACL, not just chmod, before any business metadata is saved.
    if os.name=='nt':bundle.load_script('backup-managed-db').private_directory(root)
    storage.write_private_json(root/'inventory.json',doc)
    storage.write_private_json(root/'auth-compatibility.json',auth_report)
    return root


def build_index(root):
    root=storage.private_path(root,directory=True);lock=storage.acquire_transfer_lock(root)
    try:
        doc=storage.validate_inventory(storage.read_private_json(root/'inventory.json'));scope=storage.all_inventory_buckets(doc)
        doc,objects,manifest=storage.load_transfer(root,selected_buckets=scope)
        if not (root/'copy-manifest.json').is_file() or any(r['status']!='copied' for r in manifest['records'].values()):
            raise ValueError('ALL_STORAGE_BYTES_REQUIRED')
        return {'version':1,'source_archive_sha256':doc['source_archive_sha256'],'objects':[
            {**obj,'size':manifest['records'][obj['id']]['received_bytes'],'sha256':manifest['records'][obj['id']]['sha256']} for obj in objects]}
    finally:lock.unlink()


def inspect_inputs(backup,*,pg_bin=None,image_id=None):
    restore=bundle.load_script('restore-db-copy');auth=bundle.load_script('prepare-local-auth')
    manifest=restore.verify_backup(backup);fresh=bundle.validate_fresh_snapshot(manifest)
    def command(schema,tables):
        if image_id:
            if os.name!='posix':raise ValueError('OFFLINE_DOCKER_REQUIRES_LINUX_OPERATOR')
            if image_id not in restore.IMAGE_IDS:raise ValueError('VERIFIED_PG17_IMAGE_REQUIRED')
            from autonomous_operator import Docker,clean_environment
            # Verify the engine endpoint using the same private source folder
            # for error logs. The command below cannot contact any network.
            docker=Docker(backup)
            obj=json.loads(docker.run('image','inspect',image_id))[0]
            if obj.get('Id')!=image_id or obj.get('Os')!='linux' or obj.get('Architecture')!='amd64':raise ValueError('OFFLINE_DECODER_PLATFORM_DIFFERS')
            return bundle.offline_restore_command(backup,image_id=image_id,schema=schema,tables=tables,uid=os.geteuid(),gid=os.getegid())
        if pg_bin is None:raise ValueError('PG17_OFFLINE_CLIENT_REQUIRED')
        executable=Path(pg_bin)/('pg_restore.exe' if os.name=='nt' else 'pg_restore')
        version=subprocess.run([str(executable),'--version'],capture_output=True,check=True,text=True,timeout=10).stdout
        if ' 17.' not in version:raise ValueError('PG17_OFFLINE_CLIENT_REQUIRED')
        return [str(executable),'--data-only','--no-owner','--no-privileges','--schema='+schema,
                *('--table='+t for t in tables),'--file=-',str(Path(backup)/'database.dump')]
    env={k:v for k,v in os.environ.items() if not k.startswith(('PG','DOCKER_','COMPOSE_'))}
    report=bundle.decode_stream(command('auth',auth.TABLES),auth.summarize_auth_copy,env=env)
    doc=bundle.decode_stream(command('storage',('buckets','objects')),
        lambda lines:bundle.inventory_from_copy(lines,archive_sha256=manifest['files']['database.dump']['sha256'],generated_at=manifest['completed_at_utc']),env=env)
    return manifest,fresh,report,doc


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-dir',required=True,type=Path)
    tools=parser.add_mutually_exclusive_group(required=True);tools.add_argument('--pg-bin',type=Path);tools.add_argument('--decoder-image-id')
    parser.add_argument('--output',type=Path)
    parser.add_argument('--copy',action='store_true');args=parser.parse_args()
    try:
        os.umask(0o077)
        manifest,fresh,auth,doc=inspect_inputs(args.backup_dir,pg_bin=args.pg_bin,image_id=args.decoder_image_id)
        if not args.copy:
            print(json.dumps({**fresh,'auth':auth,**storage.inventory_summary(doc,selected_buckets=storage.all_inventory_buckets(doc))}))
            print('AUTONOMOUS_SNAPSHOT_CHECKED_NOT_COPIED');return 0
        root=args.output or Path.home()/'village-autonomous-inputs'/doc['source_archive_sha256'][:24]
        initialize_inputs(root,doc,auth)
        with warnings.catch_warnings():
            warnings.simplefilter('error',getpass.GetPassWarning)
            credential=getpass.getpass('Supabase SERVER Secret key (hidden; NOT database password): ')
        result=storage.copy_inventory(root/'inventory.json',root,credential,
            selected_buckets=storage.all_inventory_buckets(doc),check_source_inventory=True)
        credential=None
        if any(result[status] for status in ('pending','failed','missing','source_changed')):raise ValueError('ALL_STORAGE_BYTES_REQUIRED')
        index=build_index(root);storage.write_private_json(root/'storage-index.json',index)
        storage.write_private_json(root/'full-copy-proof.json',{'version':1,'status':'all_source_storage_verified_not_cut_over',
            'source_archive_sha256':doc['source_archive_sha256'],'inventory_sha256':storage.inventory_digest(doc),
            'objects':len(index['objects']),'verified_bytes':result['verified_bytes'],'source_checked_at':storage.now()})
        print(json.dumps({k:result[k] for k in ('copied','excluded_objects','verified_bytes')}))
        print('AUTONOMOUS_ALL_STORAGE_PRIVATE_COPY_VERIFIED_NOT_CUT_OVER');return 0
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError,getpass.GetPassWarning,EOFError):
        print('STOP: AUTONOMOUS_INPUTS_FAILED. Retain private inputs and partial files; do not paste rows or secrets.');return 1


if __name__=='__main__':raise SystemExit(main())
