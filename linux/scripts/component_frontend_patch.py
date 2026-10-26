#!/usr/bin/env python3
"""Update only the five generator web assets in the verified Aliyun deployment.

No image build, service restart, database change or GPU operation. The payload is
embedded by build_component_frontend_patch.py; partial copies can be resumed.
"""
import argparse
import base64
import copy
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import zlib

COMMIT = 'af39f0411ac638d360d10e2c4d57e5d8c56ed929'
PARENT_OPERATOR_SHA256 = '702096d70a39d9129bc496a8e14e6137536ac252d79e0863a8b315f70ad97fe3'
PATCH = 'generator-preview-layout-20261026-v1'
FILES = tuple('rural_house_generator/' + name for name in (
    'index.html', 'app.js', 'style.css', 'generation-mode.js', 'photo-workflow.js'))
# Release builder replaces these two literals in the delivered standalone script.
PAYLOAD = ''
PAYLOAD_SHA256 = ''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe(path):
    path = Path(path).absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('SYMLINK_REFUSED')
    if path.exists() and path.is_file() and path.stat().st_nlink != 1:
        raise ValueError('HARDLINK_REFUSED')
    return path


def read_json(path):
    return json.loads(safe(path).read_text())


def atomic(path, data, *, staging=None):
    safe(path)
    temporary = path.with_name(path.name + '.patch-part') if staging is None else safe(staging) / (sha(str(path).encode()) + '.patch-part')
    safe(temporary)
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def write_json(path, value):
    atomic(path, (json.dumps(value, sort_keys=True) + '\n').encode())


def tree_digest(root, overrides=None):
    digest = hashlib.sha256()
    for path in sorted(safe(root).rglob('*')):
        safe(path)
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError('SPECIAL_FILE_REFUSED')
        name = path.relative_to(root).as_posix()
        digest.update(name.encode() + b'\0')
        if overrides and name in overrides:
            digest.update(overrides[name])
        else:
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024**2), b''):
                    digest.update(block)
        digest.update(b'\0')
    return digest.hexdigest()


def payload():
    raw = zlib.decompress(base64.b64decode(PAYLOAD))
    if sha(raw) != PAYLOAD_SHA256:
        raise ValueError('PAYLOAD_DIGEST_FAILED')
    values = json.loads(raw)
    if set(values) != set(FILES):
        raise ValueError('FIVE_GENERATOR_FILES_REQUIRED')
    return {name: base64.b64decode(data) for name, data in values.items()}


def inspect_services(receipt, web):
    names = ('village-autonomous-api', 'village-autonomous-web')
    result = subprocess.run(['sudo', '-n', 'docker', '--context', 'default', 'inspect', *names],
                            capture_output=True, timeout=30, check=True)
    rows = json.loads(result.stdout)
    for name, row in zip(names, rows):
        if row['Id'] != receipt['after'][name] or not row['State']['Running']:
            raise ValueError('DEPLOYED_CONTAINER_CHANGED')
        if row['State'].get('Health', {}).get('Status', 'healthy') != 'healthy':
            raise ValueError('DEPLOYED_CONTAINER_NOT_HEALTHY')
    mounts = [m for m in rows[1]['Mounts'] if m['Destination'] == '/srv/village-web']
    if len(mounts) != 1 or mounts[0]['Source'] != str(web):
        raise ValueError('VERIFIED_WEB_MOUNT_REQUIRED')


def check_served(name, data):
    connection = socket.create_connection(('127.0.0.1', 443), timeout=20)
    secure = ssl.create_default_context().wrap_socket(connection, server_hostname='8.148.248.237')
    try:
        secure.sendall(('GET /' + name + ' HTTP/1.1\r\nHost: 8.148.248.237\r\n'
                        'Cache-Control: no-cache\r\nConnection: close\r\n\r\n').encode())
        response = http.client.HTTPResponse(secure)
        response.begin()
        actual = response.read(len(data) + 1)
        if response.status != 200 or actual != data:
            raise ValueError('SERVED_GENERATOR_FILE_DIFFERS')
    finally:
        secure.close()


def patch(state, values, *, apply=False, inspect=inspect_services, served=check_served):
    web = safe(state / 'web')
    parent_path = state / 'receipt.json'
    current = read_json(parent_path)
    if current.get('phase') != 'complete' or current.get('commit') != COMMIT or current.get('kind') != 'cloud':
        raise ValueError('COMPLETED_COMPONENT_CLOUD_REQUIRED')
    if current.get('operator_sha256') != PARENT_OPERATOR_SHA256 or sha(safe(state / 'operator.py').read_bytes()) != PARENT_OPERATOR_SHA256:
        raise ValueError('VERIFIED_PARENT_OPERATOR_REQUIRED')
    inspect(current, web)
    for name, digest in current['api_hashes'].items():
        if sha(safe(state / 'code' / name).read_bytes()) != digest:
            raise ValueError('DEPLOYED_API_CHANGED')
    directory = safe(state / PATCH)
    own_path = directory / 'receipt.json'
    record = read_json(own_path) if own_path.exists() else None
    hashes = {name: sha(data) for name, data in values.items()}
    if record:
        if record.get('patch') != PATCH or record.get('files') != hashes:
            raise ValueError('PATCH_RECEIPT_CHANGED')
        before = record['parent_before']
        old = {name: safe(directory / name).read_bytes() for name in FILES}
        if {name: sha(data) for name, data in old.items()} != record['before_files']:
            raise ValueError('PATCH_BACKUP_CHANGED')
        if tree_digest(web, old) != before['web_sha256']:
            raise ValueError('UNRELATED_WEB_CHANGED')
        for name in FILES:
            if sha(safe(web / name).read_bytes()) not in (sha(old[name]), hashes[name]):
                raise ValueError('GENERATOR_FILE_CHANGED')
        expected = copy.deepcopy(before)
        expected['web_sha256'] = tree_digest(web, values)
        if current not in (before, expected):
            raise ValueError('PARENT_RECEIPT_CHANGED')
    else:
        if tree_digest(web) != current['web_sha256']:
            raise ValueError('DEPLOYED_WEB_CHANGED')
        before = current
        old = {name: safe(web / name).read_bytes() for name in FILES}
    if not apply:
        return {'status': 'component_generator_frontend_preflight_passed', 'files': len(values), 'gpu_update': False}
    if not record:
        directory.mkdir(mode=0o700, exist_ok=True)
        for name, data in old.items():
            target = safe(directory / name)
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            atomic(target, data)
        record = {'patch': PATCH, 'phase': 'prepared', 'files': hashes,
                  'parent_before': before, 'before_files': {name: sha(data) for name, data in old.items()}}
        write_json(own_path, record)
    staging = safe(directory / 'staging')
    staging.mkdir(mode=0o700, exist_ok=True)
    for name, data in values.items():
        if sha(safe(web / name).read_bytes()) != hashes[name]:
            atomic(web / name, data, staging=staging)
    for name, data in values.items():
        served(name, data)
    inspect(current, web)
    after = copy.deepcopy(before)
    after['web_sha256'] = tree_digest(web)
    write_json(parent_path, after)
    record.update(phase='served_verified', web_sha256=after['web_sha256'])
    write_json(own_path, record)
    return {'status': 'component_generator_frontend_updated_real_photo_test_pending',
            'files': len(values), 'services_restarted': False, 'gpu_update': False,
            'backup': str(directory)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--check', action='store_true')
    action.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        if sys.platform != 'linux' or os.geteuid() == 0:
            raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        import fcntl
        os.umask(0o077)
        state = safe(Path.home() / 'village-autonomous/files/components-20261025-v1' / COMMIT[:12])
        lock = safe(Path.home() / 'village-autonomous/.operator-operation.lock')
        with os.fdopen(os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'w') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = patch(state, payload(), apply=args.apply)
        print(json.dumps(result))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        code = str(error) if str(error).isupper() and len(str(error)) < 100 else type(error).__name__
        print('STOP: GENERATOR_FRONTEND_PATCH ' + code + '. Preserve backup and receipt; no services were restarted.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
