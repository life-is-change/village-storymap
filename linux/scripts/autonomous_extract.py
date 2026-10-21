"""Stream an already checksum-verified release layer without docker cp ownership drift."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
import business_storage_copy as storage


def tree_digest(root):
    root=storage.no_links(root);digest=hashlib.sha256()
    for path in sorted(root.rglob('*')):
        storage.no_links(path)
        if not path.is_file():
            if not path.is_dir():raise ValueError('RELEASE_SPECIAL_FILE')
            continue
        if path.stat().st_nlink!=1:raise ValueError('RELEASE_HARDLINK')
        digest.update(path.relative_to(root).as_posix().encode()+b'\0')
        with path.open('rb') as source:
            for block in iter(lambda:source.read(1024**2),b''):digest.update(block)
        digest.update(b'\0')
    return digest.hexdigest()


def safe_name(value):
    if not isinstance(value,str) or value.startswith('/') or '\\' in value or any(x in ('','.','..') for x in value.split('/')):
        raise ValueError('RELEASE_ARCHIVE_PATH_REFUSED')
    return value


def extract_release(archive,target,*,reserve=4*1024**3):
    archive=storage.no_links(archive);target=storage.no_links(target)
    if target.exists():raise ValueError('RELEASE_OUTPUT_EXISTS')
    storage.private_path(target.parent,directory=True);target.mkdir(mode=0o700)
    prefixes={'opt/village-web/':'web','opt/village-schema/':'schema','opt/village-control/':'control'}
    for name in prefixes.values():(target/name).mkdir(mode=0o700)
    seen=set();count=0;total=0;written=set()
    with tarfile.open(archive,'r:*') as outer:
        manifest_member=outer.getmember('manifest.json')
        if not manifest_member.isfile() or manifest_member.size>65536:raise ValueError('RELEASE_IMAGE_MANIFEST_REFUSED')
        manifest=json.load(outer.extractfile(manifest_member))
        if not isinstance(manifest,list) or len(manifest)!=1:raise ValueError('SINGLE_RELEASE_IMAGE_REQUIRED')
        layers=manifest[0].get('Layers',[])
        if not 1<=len(layers)<=16:raise ValueError('RELEASE_LAYER_COUNT_REFUSED')
        layer=outer.extractfile(safe_name(layers[-1]))
        if layer is None:raise ValueError('RELEASE_LAYER_MISSING')
        with layer,gzip.GzipFile(fileobj=layer) as decompressed,tarfile.open(fileobj=decompressed,mode='r|') as inner:
            for item in inner:
                name=safe_name(item.name);count+=1;total+=item.size
                if name in seen or count>200000 or total>4*1024**3 or item.size<0 or not (item.isfile() or item.isdir()):raise ValueError('RELEASE_LAYER_CONTENT_REFUSED')
                seen.add(name)
                for prefix,directory in prefixes.items():
                    if not name.startswith(prefix):continue
                    relative=safe_name(name[len(prefix):]);path=target/directory/relative
                    storage.no_links(path)
                    if target not in path.parents:raise ValueError('RELEASE_PATH_OUTSIDE_TARGET')
                    if item.isdir():path.mkdir(parents=True,mode=0o700,exist_ok=True);break
                    path.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
                    if shutil.disk_usage(target).free<reserve+item.size:raise ValueError('RELEASE_DISK_RESERVE_REQUIRED')
                    with inner.extractfile(item) as source,os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:
                        copied=0
                        while block:=source.read(1024**2):output.write(block);copied+=len(block)
                        if copied!=item.size:raise ValueError('RELEASE_LAYER_TRUNCATED')
                        output.flush();os.fsync(output.fileno())
                    written.add(directory);break
    if written!=set(prefixes.values()):raise ValueError('RELEASE_LAYER_INCOMPLETE')
    return {name:tree_digest(target/name) for name in ('web','schema','control')}
