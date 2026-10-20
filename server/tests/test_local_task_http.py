import hashlib
import importlib
import json
from pathlib import Path
from uuid import uuid4

import httpx
import pytest


def api():
    try:
        return importlib.import_module('village_processing.local_task_http')
    except ImportError:
        pytest.fail('local HTTPS task transport is missing')


def key(tmp_path):
    path = tmp_path / 'worker-key'
    wid = str(uuid4())
    path.write_text(f'village_worker_{wid}.' + 'A' * 43)
    path.chmod(0o600)
    return path, wid


def test_fixed_https_key_namespace_and_same_request_receipt_on_retry(tmp_path):
    path, wid = key(tmp_path)
    seen = []

    def handler(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadTimeout('synthetic lost response')
        return httpx.Response(200, json={'data': {'run': None}})

    transport = api().LocalTaskHTTP(key_file=path, kind='geo', transport=httpx.MockTransport(handler), sleep=lambda _: None)
    assert transport.worker_id == wid
    assert transport.call('claim', {'requestId': str(uuid4())}) == {'run': None}
    assert seen[0].content == seen[1].content
    assert str(seen[0].url) == 'https://8.148.248.237/api/worker/v1/claim'
    assert seen[0].headers['authorization'].startswith('Bearer village_worker_')
    for value in ('https://elsewhere.test', 'http://8.148.248.237', 'https://8.148.248.237/other'):
        with pytest.raises(ValueError, match='INVALID_LOCAL_GATEWAY'):
            api().LocalTaskHTTP(key_file=path, kind='geo', origin=value)
    with pytest.raises(ValueError):
        transport.call('../source', {})
    transport.close()


def test_tls_and_lease_errors_never_fall_back_to_source_or_expose_credentials(tmp_path):
    path, _ = key(tmp_path)
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(409, json={'error': {'code': 'LEASE_LOST', 'detail': 'private'}})

    transport = api().LocalTaskHTTP(key_file=path, kind='facade', transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match='LEASE_LOST') as caught:
        transport.run_call(str(uuid4()), str(uuid4()), 'renew', {})
    assert 'private' not in str(caught.value)
    assert len(calls) == 1
    transport.close()


def test_file_upload_resumes_at_receipted_offset_and_checks_local_hash(tmp_path):
    path, _ = key(tmp_path)
    content = b'x' * (8 * 1024 * 1024) + b'end'
    source = tmp_path / 'result.glb'
    source.write_bytes(content)
    upload_id, run_id, lease = str(uuid4()), str(uuid4()), str(uuid4())
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith('/uploads'):
            return httpx.Response(200, json={'data': {'uploadId': upload_id, 'offset': 8 * 1024 * 1024, 'state': 'pending'}})
        if request.method == 'PUT':
            assert request.url.path.endswith('/chunks/1')
            assert request.content == b'end'
            assert request.headers['x-village-sha256'] == hashlib.sha256(b'end').hexdigest()
            assert request.headers['x-village-lease'] == lease
            return httpx.Response(200, json={'data': {'offset': len(content)}})
        return httpx.Response(200, json={'data': {'state': 'ready', 'fileId': str(uuid4())}})

    transport = api().LocalTaskHTTP(key_file=path, kind='facade', transport=httpx.MockTransport(handler))
    transport.upload(run_id, lease, 'building_glb', source, 'model/gltf-binary')
    assert len(seen) == 3
    spec = json.loads(seen[0].content)
    assert spec['sha256'] == hashlib.sha256(content).hexdigest()
    assert spec['size'] == len(content)
    transport.close()


def test_tls_failure_and_redirect_are_fail_closed(tmp_path):
    path,_=key(tmp_path)
    seen=[]
    def broken(request):
        seen.append(request)
        raise httpx.ConnectError('certificate verify failed: private detail')
    transport=api().LocalTaskHTTP(key_file=path,kind='geo',transport=httpx.MockTransport(broken),sleep=lambda _:None)
    with pytest.raises(httpx.TransportError,match='ALIYUN_NETWORK_UNAVAILABLE') as caught:
        transport.call('heartbeat',{'protocol':'geo-aliyun-local-v1','state':'idle'})
    assert len(seen)==3 and 'private detail' not in str(caught.value)
    transport.close()
    seen.clear()
    def redirect(request):
        seen.append(request)
        return httpx.Response(302,headers={'Location':'https://source.invalid/'})
    transport=api().LocalTaskHTTP(key_file=path,kind='geo',transport=httpx.MockTransport(redirect))
    with pytest.raises(RuntimeError,match='ALIYUN_GATEWAY_REJECTED'):
        transport.call('claim',{'requestId':str(uuid4())})
    assert len(seen)==1
    transport.close()


def test_interrupted_photo_download_resumes_by_range_and_verifies_full_digest(tmp_path):
    path,_=key(tmp_path)
    content=b'x'*100000
    digest=hashlib.sha256(content).hexdigest()
    seen=[]
    class Interrupted(httpx.SyncByteStream):
        def __iter__(self):
            yield content[:65536]
            raise httpx.ReadError('interrupted fixture')
    def handler(request):
        seen.append(request)
        if len(seen)==1:
            return httpx.Response(200,headers={'Content-Length':str(len(content)),'ETag':'"'+digest+'"'},stream=Interrupted())
        assert request.headers['Range']=='bytes=65536-'
        return httpx.Response(206,headers={'Content-Range':f'bytes 65536-{len(content)-1}/{len(content)}','ETag':'"'+digest+'"'},content=content[65536:])
    transport=api().LocalTaskHTTP(key_file=path,kind='facade',transport=httpx.MockTransport(handler),sleep=lambda _:None)
    target=tmp_path/'photo.png'
    transport.download(str(uuid4()),str(uuid4()),'input',target,expected_sha=digest,expected_size=len(content))
    assert target.read_bytes()==content
    assert len(seen)==2
    transport.close()


def test_complete_private_partial_is_adopted_after_restart_without_an_invalid_range(tmp_path):
    path,_=key(tmp_path)
    content=b'complete bytes'
    target=tmp_path/'photo.png'
    pending=target.with_name(target.name+'.local-task-part')
    pending.write_bytes(content)
    pending.chmod(0o600)
    transport=api().LocalTaskHTTP(key_file=path,kind='facade',transport=httpx.MockTransport(lambda _:pytest.fail('already complete file was requested again')))
    transport.download(str(uuid4()),str(uuid4()),'input',target,expected_sha=hashlib.sha256(content).hexdigest(),expected_size=len(content))
    assert target.read_bytes()==content and not pending.exists()
    transport.close()
