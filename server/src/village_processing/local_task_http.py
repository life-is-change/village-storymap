"""Fixed-origin outbound task/file protocol; no Supabase client or fallback."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import stat
import time
from uuid import UUID, uuid5

import httpx

ORIGIN = 'https://8.148.248.237'
CHUNK = 8 * 1024 * 1024
KEY = re.compile(r'village_worker_([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})')
SHA = re.compile(r'[a-f0-9]{64}')


def uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        return False


def private_file(path):
    path = Path(path)
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('INVALID_PRIVATE_FILE')
    st = path.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or os.name == 'posix' and (st.st_uid != os.getuid() or st.st_mode & 0o077):
        raise ValueError('INVALID_PRIVATE_FILE')
    return path


def hash_file(path):
    digest = hashlib.sha256()
    size = 0
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(65536), b''):
            digest.update(part)
            size += len(part)
    return size, digest.hexdigest()


class LocalTaskHTTP:
    def __init__(self, *, key_file, kind, origin=ORIGIN, transport=None, sleep=time.sleep):
        if origin != ORIGIN or kind not in ('geo', 'facade'):
            raise ValueError('INVALID_LOCAL_GATEWAY')
        path = private_file(key_file)
        if path.stat().st_size > 256:
            raise ValueError('INVALID_WORKER_KEY')
        key = path.read_text('ascii').strip()
        match = KEY.fullmatch(key)
        if not match or not uuid(match[1]):
            raise ValueError('INVALID_WORKER_KEY')
        self.worker_id, self.kind = match[1], kind
        self.sleep = sleep
        # TLS verification and redirects are never operator-disableable. Ambient
        # proxies cannot receive the private Worker credential.
        self.client = httpx.Client(base_url=ORIGIN + '/api/worker/v1/', headers={'Authorization': 'Bearer ' + key},
                                   verify=True, follow_redirects=False, trust_env=False, transport=transport,
                                   timeout=httpx.Timeout(45, connect=10), limits=httpx.Limits(max_connections=4, max_keepalive_connections=2))

    def close(self):
        self.client.close()

    def _path(self, path):
        if not isinstance(path, str) or not re.fullmatch(r'(?:heartbeat|claim|sources|source-status|runs/[a-f0-9-]{36}/(?:renew|progress|fail|cancel|cancel-status|complete|publish-rectification|retry-failure|input|artifacts/(?:rectified_source|rectified_preview|building_mask)|uploads(?:/[a-f0-9-]{36}(?:/(?:commit|chunks/[0-9]{1,2}))?)?))', path):
            raise ValueError('INVALID_LOCAL_GATEWAY_PATH')
        return path

    @staticmethod
    def _result(response):
        if len(response.content) > 16384:
            raise RuntimeError('INVALID_GATEWAY_RESPONSE')
        if response.status_code != 200:
            try:
                code = response.json()['error']['code']
            except (ValueError, KeyError, TypeError):
                code = None
            allowed = {'LEASE_LOST', 'UNAUTHORIZED', 'FORBIDDEN', 'FILES_NOT_READY', 'UPLOAD_CONFLICT', 'UPLOAD_EXPIRED', 'FILE_BUSY', 'QUOTA_EXCEEDED', 'FILE_TOO_LARGE', 'INVALID_FILE', 'NOT_FOUND'}
            raise RuntimeError(code if code in allowed else 'ALIYUN_GATEWAY_REJECTED')
        try:
            value = response.json()['data']
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, KeyError, TypeError):
            raise RuntimeError('INVALID_GATEWAY_RESPONSE') from None

    def request(self, method, path, *, payload=None, headers=None, content=None):
        path = self._path(path)
        for attempt in range(3):
            try:
                # Bounded response read even for a malformed reverse proxy.
                with self.client.stream(method, path, json=payload, headers=headers, content=content) as response:
                    parts, size = [], 0
                    for part in response.iter_bytes():
                        size += len(part)
                        if size > 16384:
                            raise RuntimeError('INVALID_GATEWAY_RESPONSE')
                        parts.append(part)
                    result = httpx.Response(response.status_code, headers=response.headers, content=b''.join(parts))
                    return self._result(result)
            except httpx.TransportError:
                if attempt == 2:
                    raise httpx.TransportError('ALIYUN_NETWORK_UNAVAILABLE') from None
                self.sleep(0.5 * (attempt + 1))

    def call(self, action, payload=None):
        if action not in ('heartbeat', 'claim', 'sources', 'source-status'):
            raise ValueError('INVALID_LOCAL_GATEWAY_PATH')
        return self.request('GET' if action == 'sources' else 'POST', action, payload=payload)

    def run_call(self, run_id, lease, action, payload=None):
        if not uuid(run_id) or not uuid(lease) or action not in ('renew', 'progress', 'fail', 'cancel', 'cancel-status', 'complete', 'publish-rectification', 'retry-failure'):
            raise ValueError('INVALID_LOCAL_GATEWAY_PATH')
        return self.request('GET' if action == 'cancel-status' else 'POST', f'runs/{run_id}/{action}', payload=payload, headers={'X-Village-Lease': lease})

    def upload(self, run_id, lease, artifact_type, source, mime):
        if not uuid(run_id) or not uuid(lease):
            raise ValueError('INVALID_LOCAL_GATEWAY_PATH')
        source = Path(source)
        if source.is_symlink() or not source.is_file():
            raise ValueError('INVALID_RESULT_FILE')
        extension = {'application/geo+json': 'geojson', 'model/gltf-binary': 'glb', 'image/png': 'png', 'image/jpeg': 'jpg', 'application/json': 'json'}.get(mime)
        limits = {'geojson': 512 * 1024**2, 'glb': 50 * 1024**2, 'png': 10 * 1024**2, 'jpg': 10 * 1024**2, 'json': 2 * 1024**2}
        if extension is None or not 0 < source.stat().st_size <= limits[extension]:
            raise ValueError('INVALID_RESULT_FILE')
        size, digest = hash_file(source)
        request_id = str(uuid5(UUID(self.worker_id), f'{run_id}/{lease}/{artifact_type}/{digest}'))
        prefix, headers = f'runs/{run_id}/uploads', {'X-Village-Lease': lease}
        receipt = self.request('POST', prefix, payload={'requestId': request_id, 'artifactType': artifact_type, 'size': size, 'sha256': digest, 'mime': mime, 'extension': extension}, headers=headers)
        upload_id, offset = receipt.get('uploadId'), receipt.get('offset')
        if not uuid(upload_id) or not isinstance(offset, int) or isinstance(offset, bool) or offset < 0 or offset > size or offset != size and offset % CHUNK:
            raise RuntimeError('INVALID_GATEWAY_RESPONSE')
        if receipt.get('state') == 'ready':
            return receipt
        with source.open('rb') as stream:
            stream.seek(offset)
            index = offset // CHUNK
            while offset < size:
                part = stream.read(min(CHUNK, size-offset))
                if not part:
                    raise ValueError('RESULT_FILE_CHANGED')
                receipt = self.request('PUT', f'{prefix}/{upload_id}/chunks/{index}', content=part,
                                       headers={**headers, 'Content-Type': 'application/octet-stream', 'X-Village-Sha256': hashlib.sha256(part).hexdigest()})
                offset += len(part)
                if receipt.get('offset') != offset:
                    raise RuntimeError('INVALID_GATEWAY_RESPONSE')
                index += 1
        return self.request('POST', f'{prefix}/{upload_id}/commit', payload={}, headers=headers)

    def download(self, run_id, lease, name, destination, *, expected_sha=None, expected_size=None):
        if not uuid(run_id) or not uuid(lease) or name not in ('input', 'rectified_source', 'rectified_preview', 'building_mask'):
            raise ValueError('INVALID_LOCAL_GATEWAY_PATH')
        if expected_sha is not None and not SHA.fullmatch(expected_sha):
            raise ValueError('INVALID_FILE_IDENTITY')
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        for part in (destination, *destination.parents):
            if part.is_symlink():
                raise ValueError('INVALID_PRIVATE_FILE')
        pending = destination.with_name(destination.name + '.local-task-part')
        if pending.exists():
            private_file(pending)
            if expected_sha and expected_size is not None and 0 < expected_size <= 10*1024**2 and hash_file(pending) == (expected_size, expected_sha):
                os.replace(pending, destination)
                return destination
        path = f'runs/{run_id}/' + ('input' if name == 'input' else 'artifacts/' + name)
        for attempt in range(3):
            offset = pending.stat().st_size if pending.exists() and expected_sha else 0
            if offset > 10 * 1024**2:
                raise ValueError('INVALID_RESULT_FILE')
            headers = {'X-Village-Lease': lease, **({'Range': f'bytes={offset}-'} if offset else {})}
            try:
                with self.client.stream('GET', path, headers=headers) as response:
                    if response.status_code not in (200, 206):
                        raise RuntimeError('ALIYUN_FILE_REJECTED')
                    digest = response.headers.get('etag', '').strip('"')
                    if not SHA.fullmatch(digest) or expected_sha and digest != expected_sha:
                        raise ValueError('FILE_DIGEST_CHANGED')
                    expected_sha = digest
                    if response.status_code == 206:
                        match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('content-range', ''))
                        if not match or int(match[1]) != offset:
                            raise ValueError('INVALID_FILE_RANGE')
                        total = int(match[3])
                    else:
                        offset = 0
                        total = int(response.headers.get('content-length', '0'))
                    if not 0 < total <= 10 * 1024**2 or expected_size is not None and total != expected_size:
                        raise ValueError('INVALID_RESULT_FILE')
                    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | (os.O_APPEND if offset else os.O_TRUNC) | getattr(os, 'O_NOFOLLOW', 0), 0o600)
                    with os.fdopen(fd, 'wb') as stream:
                        count = offset
                        for part in response.iter_bytes(65536):
                            count += len(part)
                            if count > total:
                                raise ValueError('INVALID_RESULT_FILE')
                            stream.write(part)
                        stream.flush()
                        os.fsync(stream.fileno())
                    if count != total or hash_file(pending) != (total, digest):
                        raise ValueError('INVALID_FILE_DIGEST')
                    os.replace(pending, destination)
                    return destination
            except httpx.TransportError:
                if attempt == 2:
                    raise httpx.TransportError('ALIYUN_NETWORK_UNAVAILABLE') from None
                self.sleep(0.5 * (attempt + 1))
        raise RuntimeError('ALIYUN_FILE_REJECTED')
