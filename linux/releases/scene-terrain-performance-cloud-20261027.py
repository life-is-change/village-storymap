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
PATCH = 'scene-terrain-performance-20261027-v1'
FILES = ('3D_scenes_edit/preview_3d/scene-preview-adapter.js',)
EXPECTED_BEFORE = {'3D_scenes_edit/preview_3d/scene-preview-adapter.js': 'bd098f42f446e37121886b2ff9877e0a877222d8692efacfdd1fb52654d271a5'}
# Release builder replaces these two literals in the delivered standalone script.
PAYLOAD = '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'
PAYLOAD_SHA256 = 'f229faa25b739c3c2a35aa08f04fecb88106315bb5ace19b4cddca207b78bfe2'
REQUIRE_IDLE = False


def check_idle():
    sql="""BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
    SELECT (SELECT count(*) FROM api_private.local_gpu_runs WHERE kind='facade'
       AND status NOT IN('awaiting_crop','completed','failed','canceled'))
       +(SELECT count(*) FROM api_private.task_requests WHERE kind='facade'
       AND state IN('pending','queued') AND source_run_id IS NULL); COMMIT;"""
    result=subprocess.run(['sudo','-n','docker','--context','default','exec','-i','village-autonomous-postgres',
        'psql','-X','-q','-w','-A','-t','-h','/var/run/postgresql','-U','village_restore_admin',
        '-d','village_unified_candidate','-v','ON_ERROR_STOP=1'],input=sql.encode(),capture_output=True,timeout=20,check=True)
    if result.stdout.strip()!=b'0':raise ValueError('ACTIVE_FACADE_TASKS_MUST_FINISH')


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
        raise ValueError('ONE_SCENE_SCRIPT_REQUIRED')
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
    if {name: sha(data) for name, data in old.items()} != EXPECTED_BEFORE:
        raise ValueError('OBSERVED_SCENE_SCRIPT_REQUIRED')
    if not apply:
        return {'status': 'scene_terrain_frontend_preflight_passed', 'files': len(values), 'gpu_update': False}
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
    return {'status': 'scene_terrain_frontend_updated_reload_pending',
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
            if REQUIRE_IDLE:check_idle()
            result = patch(state, payload(), apply=args.apply)
            if REQUIRE_IDLE:result['active_facade_tasks']=0
        print(json.dumps(result))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        code = str(error) if str(error).isupper() and len(str(error)) < 100 else type(error).__name__
        print('STOP: SCENE_TERRAIN_PATCH ' + code + '. Preserve backup and receipt; no services were restarted.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
