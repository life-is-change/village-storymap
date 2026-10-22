#!/usr/bin/env python3
"""Quarantine only bytecode extras after proving every frozen source byte."""
import hashlib
import os
from pathlib import Path
import re
import secrets
import sys
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_extract import tree_digest
from autonomous_operator import operation_lock


def digest(path):
    st = path.stat()
    if not path.is_file() or st.st_nlink != 1 or (os.name == 'posix' and st.st_uid != os.geteuid()):
        raise ValueError('OWNED_REGULAR_CONTROL_FILE_REQUIRED')
    return storage.digest_file(path)


def repair(state):
    state = storage.private_path(state, directory=True)
    with operation_lock(state):
        if (state / 'public-switch.json').exists():
            raise ValueError('PRE_SWITCH_CACHE_REPAIR_ONLY')
        meta = storage.read_private_json(state / 'release.json')
        expected = load_script('deploy-autonomous').read_meta()
        keys = ('releaseId','control_sha256','archive_sha256','code_sha256','schema_sha256','static_sha256')
        if (meta.get('kind') != 'autonomous' or meta.get('schemaVersion') != 2
                or any(meta.get(k) != expected.get(k) for k in keys)
                or Path(meta['releaseId']).name != meta['releaseId']):
            raise ValueError('PUBLISHED_RELEASE_IDENTITY_REQUIRED')
        control = storage.private_path(state / 'control', directory=True)
        pristine = storage.no_links(state / 'releases' / meta['releaseId'] / 'control')
        if tree_digest(pristine) != meta['control_sha256']:
            raise ValueError('PRISTINE_RELEASE_CHANGED')
        originals = {}
        for path in pristine.iterdir():
            path = storage.no_links(path)
            originals[path.name] = digest(path)
        if not 1 <= len(originals) <= 128:
            raise ValueError('FLAT_FROZEN_CONTROL_REQUIRED')
        cache = control / '__pycache__'
        found = set()
        for path in control.iterdir():
            path = storage.no_links(path)
            if path == cache:
                if not path.is_dir():
                    raise ValueError('CACHE_DIRECTORY_REQUIRED')
                continue
            if path.name not in originals or digest(path) != originals[path.name]:
                raise ValueError('FROZEN_SOURCE_CHANGED')
            found.add(path.name)
        if found != set(originals):
            raise ValueError('FROZEN_SOURCE_MISSING')
        cached = {}
        if cache.exists():
            if os.name == 'posix' and cache.stat().st_uid != os.geteuid():
                raise ValueError('OWNED_CACHE_REQUIRED')
            for path in cache.iterdir():
                path = storage.no_links(path)
                match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_-]*)\.cpython-\d{2,3}(?:\.opt-[12])?\.pyc', path.name)
                if not match or match[1]+'.py' not in originals or path.stat().st_size > 4*1024**2:
                    raise ValueError('UNKNOWN_CONTROL_EXTRA')
                cached[path.name] = digest(path)
            if len(cached) > 128:
                raise ValueError('BOUNDED_CACHE_REQUIRED')
            quarantine = storage.no_links(state / 'control-bytecode-quarantine')
            quarantine.mkdir(mode=0o700, exist_ok=True)
            storage.private_path(quarantine, directory=True)
            target = quarantine / secrets.token_hex(12)
            target.mkdir(mode=0o700)
            destination = (target / '__pycache__').resolve()
            # Verify absolute move targets before moving the directory. Cached
            # code is never imported, decoded or treated as trusted evidence.
            if cache.resolve().parent != control or state not in destination.parents or destination.exists():
                raise ValueError('PRIVATE_QUARANTINE_TARGET_REQUIRED')
            control.chmod(0o700)
            cache.rename(destination)
            control.chmod(0o500)
            if any(digest(destination/name) != receipt for name, receipt in cached.items()):
                raise ValueError('QUARANTINED_CACHE_CHANGED')
            storage.write_private_json(target / 'receipt.json', {
                'releaseId':meta['releaseId'], 'control_sha256':meta['control_sha256'],
                'files':{n:{'sha256':v[0],'bytes':v[1]} for n,v in cached.items()}})
        else:
            control.chmod(0o500)
        if tree_digest(control) != meta['control_sha256'] or tree_digest(pristine) != meta['control_sha256']:
            raise ValueError('FROZEN_SOURCE_NOT_RESTORED')
        return len(cached)


def main():
    try:
        if sys.platform != 'linux' or os.geteuid() == 0:
            raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        count = repair(Path.home() / 'village-autonomous')
        print('FROZEN_CONTROL_SOURCE_VERIFIED_CACHE_QUARANTINED count='+str(count))
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as error:
        reason = str(error) if re.fullmatch('[A-Z0-9_]{1,100}',str(error)) else type(error).__name__
        print('STOP: FROZEN_CONTROL_CACHE_REPAIR_FAILED category='+reason+'. Retain source, caches and private logs; do not reset data.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
