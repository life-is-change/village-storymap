"""The observed Blender HTTP 403 must not recur inside an image build."""
import hashlib
import importlib
import io
from pathlib import Path
import sys
import urllib.error
import http.client

import pytest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'linux/scripts'))


def runtime(monkeypatch):
    m=importlib.import_module('component_rollout')
    archive=b'synthetic-pinned-blender-archive'
    monkeypatch.setattr(m,'BLENDER_ARCHIVE_SHA256',hashlib.sha256(archive).hexdigest())
    monkeypatch.setattr(m,'BLENDER_ARCHIVE_SIZE',len(archive))
    return m,archive


def test_host_download_403_uses_mirror_checks_bytes_then_reuses_cache(tmp_path,monkeypatch):
    m,data=runtime(monkeypatch);calls=[]
    def open_request(request,timeout):
        calls.append(request.full_url)
        assert timeout==30 and request.headers.get('User-agent')
        if len(calls)==1:raise urllib.error.HTTPError(request.full_url,403,'Forbidden',{},None)
        return io.BytesIO(data)
    monkeypatch.setattr(m.urllib.request,'urlopen',open_request)
    archive=m.cached_blender_archive(tmp_path)
    assert archive.read_bytes()==data and archive.is_relative_to(tmp_path)
    assert len(calls)==2
    assert m.cached_blender_archive(tmp_path)==archive
    assert len(calls)==2,'A verified local artifact must not download again'


def test_corrupt_cached_archive_is_retained_and_never_used(tmp_path,monkeypatch):
    m,data=runtime(monkeypatch);folder=tmp_path/'downloads';folder.mkdir(mode=0o700)
    archive=folder/m.BLENDER_ARCHIVE_NAME;archive.write_bytes(b'corrupt');archive.chmod(0o600)
    monkeypatch.setattr(m.urllib.request,'urlopen',lambda *a,**k:pytest.fail('Do not silently replace a corrupt existing artifact'))
    with pytest.raises(ValueError,match='BLENDER_ARCHIVE_CHECKSUM_MISMATCH'):
        m.cached_blender_archive(tmp_path)
    assert archive.read_bytes()==b'corrupt'


def test_interrupted_host_transfer_can_fall_back_without_partial_cache(tmp_path,monkeypatch):
    m,data=runtime(monkeypatch);calls=[]
    def download(*args,**kwargs):
        calls.append(1)
        if len(calls)==1:
            class Interrupted(io.BytesIO):
                def read(self,*args):raise http.client.IncompleteRead(b'partial')
            return Interrupted()
        return io.BytesIO(data)
    monkeypatch.setattr(m.urllib.request,'urlopen',download)
    assert m.cached_blender_archive(tmp_path).read_bytes()==data
    assert not list((tmp_path/'downloads').glob('*.part'))


@pytest.mark.parametrize('received',[b'HTML access denied',b'x'*100])
def test_bad_or_oversized_download_is_not_promoted_to_cache(tmp_path,monkeypatch,received):
    m,data=runtime(monkeypatch)
    monkeypatch.setattr(m.urllib.request,'urlopen',lambda *a,**k:io.BytesIO(received))
    with pytest.raises(ValueError,match='BLENDER_DOWNLOAD_UNAVAILABLE'):
        m.cached_blender_archive(tmp_path)
    assert not (tmp_path/'downloads'/m.BLENDER_ARCHIVE_NAME).exists()
    assert not list((tmp_path/'downloads').glob('*.part'))


def test_private_worker_context_uses_verified_r6_code_and_local_archive(tmp_path,monkeypatch):
    m,data=runtime(monkeypatch);source=tmp_path/'source';state=tmp_path/'state';state.mkdir(mode=0o700)
    files={
        'server/src/village_processing/example.py':b'VALID_SERVER=True\n',
        'rural_house_generator/backend/example.py':b'VALID_BUILDING=True\n',
        'linux/Dockerfile.component-worker':(ROOT/'linux/Dockerfile.component-worker').read_bytes(),
        'unrelated-private.env':b'must-never-enter-context',
    }
    for name,contents in files.items():
        p=source/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(contents)
    downloads=state/'downloads';downloads.mkdir(mode=0o700)
    (downloads/m.BLENDER_ARCHIVE_NAME).write_bytes(data);(downloads/m.BLENDER_ARCHIVE_NAME).chmod(0o600)
    monkeypatch.setattr(m.urllib.request,'urlopen',lambda *a,**k:pytest.fail('Cached build must work without network'))
    context,dockerfile=m.prepare_worker_build(state,source)
    assert context.is_relative_to(state)
    assert (context/m.BLENDER_ARCHIVE_NAME).read_bytes()==data
    assert (context/'server/src/village_processing/example.py').read_bytes()==files['server/src/village_processing/example.py']
    text=dockerfile.read_text()
    assert 'ADD '+m.BLENDER_ARCHIVE_NAME+' /opt/blender-runtime/' in text
    assert 'urlretrieve' not in text and 'BLENDER_URL' not in text
    assert 'RUN python3 -m pip install --no-cache-dir --no-deps Pillow==11.1.0' in text
    assert not (context/'unrelated-private.env').exists()
    assert all((source/name).read_bytes()==contents for name,contents in files.items())
    assert m.prepare_worker_build(state,source)==(context,dockerfile)
    (context/'unrelated-private.env').write_text('do-not-send')
    with pytest.raises(ValueError,match='UNEXPECTED_WORKER_BUILD_FILE'):
        m.prepare_worker_build(state,source)
    (context/'unrelated-private.env').unlink()
    (context/'server/src/village_processing/example.py').write_bytes(b'tampered')
    with pytest.raises(ValueError,match='PREPARED_SOURCE_CHANGED'):
        m.prepare_worker_build(state,source)


def test_real_docker_add_expands_local_xz_without_network(tmp_path):
    import os,subprocess,tarfile
    if sys.platform!='linux' or os.environ.get('GITHUB_ACTIONS')!='true':
        pytest.skip('Real Docker contract is restricted to disposable Linux CI')
    context=tmp_path/'context';context.mkdir()
    name='blender-test.tar.xz';data=b'synthetic-runtime'
    with tarfile.open(context/name,'w:xz') as t:
        info=tarfile.TarInfo('blender-test/blender');info.size=len(data);info.mode=0o755;t.addfile(info,io.BytesIO(data))
    (context/'Dockerfile').write_text('FROM scratch\nADD '+name+' /opt/blender-runtime/\n')
    prefix=['sudo','-n','docker','--context','default']
    result=subprocess.run([*prefix,'build','--network=none','--pull=false','-q',str(context)],check=True,capture_output=True,text=True)
    image=result.stdout.strip();container=None
    try:
        container=subprocess.check_output([*prefix,'create',image,'/never-started'],text=True).strip()
        raw=subprocess.check_output([*prefix,'cp',container+':/opt/blender-runtime/blender-test/blender','-'])
        with tarfile.open(fileobj=io.BytesIO(raw)) as t:
            member=t.getmembers()[0]
            assert member.mode&0o111==0o111
            assert t.extractfile(member).read()==data
    finally:
        if container:subprocess.run([*prefix,'rm',container],check=True,capture_output=True)
        subprocess.run([*prefix,'image','rm',image],check=True,capture_output=True)
