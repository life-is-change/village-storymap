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
    assert 'apt-get install' in text and 'libsm6' in text and 'libice6' in text
    assert text.index('ADD '+m.BLENDER_ARCHIVE_NAME)<text.index('apt-get install')<text.index('COPY --chown')
    assert 'COPY --chown=10001:10001 rural_house_generator /opt/village-components/rural_house_generator' in text
    assert (context/'rural_house_generator/__init__.py').is_file()
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


def test_both_runtime_images_copy_readable_owned_regular_package():
    m=importlib.import_module('component_rollout')
    for service in ('worker','ml'):
        original=(ROOT/('linux/Dockerfile.component-'+service)).read_text()
        fixed=m.runtime_copy_dockerfile(original)
        assert 'COPY --chown=10001:10001 rural_house_generator /opt/village-components/rural_house_generator' in fixed
        assert 'COPY rural_house_generator/backend ' not in fixed
        if service=='worker':assert 'COPY --chown=10001:10001 server/src/village_processing ' in fixed


def test_import_smoke_checks_new_module_location_not_only_symbol():
    m=importlib.import_module('component_rollout')
    for service in ('facade-worker','facade-ml'):
        code=m.component_import_smoke(service)
        assert '/opt/village-components/' in code and '__file__' in code
        assert 'build_spec' in code if service=='facade-worker' else 'FacadeMLRuntime' in code


def test_missing_shared_libraries_are_reported_before_starting_blender(tmp_path,capsys):
    m=importlib.import_module('component_rollout');calls=[]
    class Docker:
        state=tmp_path
        def run(self,*args,**kwargs):
            calls.append(args)
            return '\tlibSM.so.6 => not found\n\tlibICE.so.6 => not found\n'
    with pytest.raises(ValueError,match='BLENDER_SYSTEM_LIBRARIES_MISSING'):
        m.verify_blender_runtime(Docker(),'sha256:fixture','10001:10001')
    assert len(calls)==1 and 'ldd' in calls[0]
    out=capsys.readouterr().out
    assert 'libSM.so.6' in out and 'libICE.so.6' in out


def test_docker_failure_identifies_stage_and_log_without_dumping_private_values(tmp_path,capsys):
    m=importlib.import_module('component_rollout')
    class Docker:
        state=tmp_path
        def run(self,*args,**kwargs):
            (tmp_path/'operator-000000000000000000000000.log').write_text('SYNTHETIC_PRIVATE_DO_NOT_PRINT')
            raise RuntimeError('DOCKER_OPERATION_FAILED')
    with pytest.raises(RuntimeError,match='DOCKER_OPERATION_FAILED'):
        m.docker_step(Docker(),'blender_runtime_smoke','run')
    out=capsys.readouterr().out
    assert 'blender_runtime_smoke' in out and 'operator-000000000000000000000000.log' in out
    assert 'SYNTHETIC_PRIVATE_DO_NOT_PRINT' not in out


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


def test_real_private_context_imports_as_uid_10001_and_does_not_load_inherited_package(tmp_path,monkeypatch):
    import os,subprocess,tarfile,secrets
    if sys.platform!='linux' or os.environ.get('GITHUB_ACTIONS')!='true':
        pytest.skip('Actual non-root Docker import fixture is restricted to disposable Linux CI')
    m=importlib.import_module('component_rollout');source=tmp_path/'source';state=tmp_path/'state';state.mkdir(mode=0o700)
    worker=(ROOT/'linux/Dockerfile.component-worker').read_text()
    worker='\n'.join(line for line in worker.splitlines() if not line.startswith('RUN python3 -m pip install'))+'\n'
    files={
        'linux/Dockerfile.component-worker':worker,
        'linux/Dockerfile.component-ml':(ROOT/'linux/Dockerfile.component-ml').read_text(),
        'server/src/village_processing/__init__.py':"ORIGIN='overlay'\n",
        'rural_house_generator/backend/__init__.py':'',
        'rural_house_generator/backend/component_building/__init__.py':'',
        'rural_house_generator/backend/component_building/adapter.py':"def build_spec():return 'overlay'\n",
        'rural_house_generator/backend/ml_worker.py':'class FacadeMLRuntime: pass\n',
    }
    for name,text in files.items():
        p=source/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
    data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w:xz') as t:
        info=tarfile.TarInfo('blender-3.6.23-linux-x64/blender');body=b'synthetic-runtime';info.size=len(body);info.mode=0o755;t.addfile(info,io.BytesIO(body))
    blob=data.getvalue();monkeypatch.setattr(m,'BLENDER_ARCHIVE_SIZE',len(blob));monkeypatch.setattr(m,'BLENDER_ARCHIVE_SHA256',hashlib.sha256(blob).hexdigest())
    downloads=state/'downloads';downloads.mkdir(mode=0o700);archive=downloads/m.BLENDER_ARCHIVE_NAME;archive.write_bytes(blob);archive.chmod(0o600)
    context,dockerfile=m.prepare_worker_build(state,source)
    # This fixture tests imports only; the full official Blender test below
    # executes the production dependency install and exporter/render smoke.
    import_file=state/'import-fixture.Dockerfile'
    import_file.write_text(dockerfile.read_text().replace(m.BLENDER_SYSTEM_LIBRARIES_RUN+'\n',''))
    dockerfile=import_file
    for p in context.rglob('*'):
        if p.is_dir():p.chmod(0o700)  # Same private umask as the production operator.
    prefix=['sudo','-n','docker','--context','default'];images=[];tag='village-component-import-fixture:'+secrets.token_hex(8)
    base_dir=tmp_path/'legacy';base_dir.mkdir()
    (base_dir/'Dockerfile').write_text('FROM python:3.10.18-slim-bookworm\n'
        'RUN mkdir -p /legacy/rural_house_generator/backend/component_building && touch /legacy/rural_house_generator/__init__.py /legacy/rural_house_generator/backend/__init__.py /legacy/rural_house_generator/backend/component_building/__init__.py\n'
        'ENV PYTHONPATH=/legacy PYTHONDONTWRITEBYTECODE=1\nUSER 10001:10001\n')
    def build(file,folder,*extra):
        result=subprocess.run([*prefix,'build','--pull=false','--network=none','-q',*extra,'-f',str(file),str(folder)],capture_output=True,text=True,timeout=180)
        assert result.returncode==0,result.stderr[-5000:]
        image=result.stdout.strip();images.append(image);return image
    def run(image,service):
        code='import os;assert os.geteuid()==10001;'+m.component_import_smoke(service)
        return subprocess.run([*prefix,'run','--rm','--read-only','--network=none','--user','10001:10001','--entrypoint','python',image,'-c',code],capture_output=True,text=True,timeout=30)
    try:
        build(base_dir/'Dockerfile',base_dir,'-t',tag,'--label','village.component.import-fixture='+tag)
        fixed=dockerfile.read_text()
        # Permission denial and inherited-package precedence independently break
        # import; together they reproduce the observed missing adapter exactly.
        broken_versions=[fixed.replace('COPY --chown=10001:10001 ','COPY '),
            fixed.replace('COPY --chown=10001:10001 rural_house_generator /opt/village-components/rural_house_generator',
                          'COPY --chown=10001:10001 rural_house_generator/backend /opt/village-components/rural_house_generator/backend')]
        broken_versions.append(broken_versions[1].replace('COPY --chown=10001:10001 ','COPY '))
        for i,text in enumerate(broken_versions):
            file=state/('broken-'+str(i)+'.Dockerfile');file.write_text(text)
            image=build(file,context,'--build-arg','BASE_IMAGE='+tag)
            result=run(image,'facade-worker')
            assert result.returncode!=0 and any(kind in result.stderr for kind in ('ModuleNotFoundError','PermissionError')),result.stderr
            if i:assert 'ModuleNotFoundError' in result.stderr and 'adapter' in result.stderr,result.stderr
        for service in ('facade-worker','facade-ml'):
            file=dockerfile if service=='facade-worker' else state/'ML.Dockerfile'
            if service=='facade-ml':file.write_text(m.runtime_copy_dockerfile(files['linux/Dockerfile.component-ml']))
            image=build(file,context,'--build-arg','BASE_IMAGE='+tag)
            result=run(image,service)
            assert result.returncode==0,result.stderr
        assert all((source/name).read_text()==text for name,text in files.items())
    finally:
        for image in reversed(images):subprocess.run([*prefix,'image','rm',image],check=True,capture_output=True)


def test_real_official_blender_dependencies_export_and_render_as_nonroot(tmp_path):
    import os,subprocess,secrets
    if sys.platform!='linux' or os.environ.get('GITHUB_ACTIONS')!='true':
        pytest.skip('Full pinned Linux Blender runtime is restricted to disposable CI')
    m=importlib.import_module('component_rollout');state=tmp_path/'state';state.mkdir(mode=0o700)
    archive=m.cached_blender_archive(state)
    context=tmp_path/'context';context.mkdir(mode=0o700)
    # Same verified local ADD and dependency instruction used by the operator.
    import shutil
    shutil.copyfile(archive,context/m.BLENDER_ARCHIVE_NAME)
    common=('FROM ubuntu:22.04\nADD '+m.BLENDER_ARCHIVE_NAME+' /opt/blender-runtime/\n')
    suffix='ENV HOME=/tmp/village-home XDG_CACHE_HOME=/tmp/village-cache\nUSER 10001:10001\n'
    (context/'broken.Dockerfile').write_text(common+suffix)
    (context/'fixed.Dockerfile').write_text(common+m.BLENDER_SYSTEM_LIBRARIES_RUN+'\n'+suffix)
    prefix=['sudo','-n','docker','--context','default'];images=[];label=secrets.token_hex(10)
    class Docker:
        def __init__(self):self.state=state
        def run(self,*args,timeout=300):
            p=subprocess.run([*prefix,*map(str,args)],capture_output=True,text=True,timeout=timeout)
            assert p.returncode==0,(p.stdout+p.stderr)[-12000:]
            return p.stdout
    docker=Docker()
    try:
        def build(name):
            image=docker.run('build','--pull=false','-q','--label','village.component.blender-fixture='+label,
                             '-f',context/(name+'.Dockerfile'),context,timeout=300).strip()
            images.append(image);return image
        broken=build('broken')
        result=subprocess.run([*prefix,'run','--rm','--network=none','--read-only','--user','10001:10001',
                               '--entrypoint',m.BLENDER,broken,'--version'],capture_output=True,text=True,timeout=30)
        assert result.returncode==127 and 'shared libraries' in result.stderr,result.stderr
        fixed=build('fixed')
        report=m.verify_blender_runtime(docker,fixed,'10001:10001')
        assert report['version']==[3,6,23] and report['view_transform']=='Filmic'
        assert report['glb_bytes']>100 and report['png_bytes']>100
        assert report['render_engine']=='CYCLES'
    finally:
        for image in reversed(images):subprocess.run([*prefix,'image','rm',image],check=True,capture_output=True)
