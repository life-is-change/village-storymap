import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'prepare-autonomous-handoff.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('handoff_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_private_handoff_streams_checked_files_and_never_overwrites(tmp_path):
    m=module();source=tmp_path/'source';source.write_bytes(b'fixture archive'*1000);source.chmod(0o600)
    archive=tmp_path/'private.tar';m.pack_files({'backup/database.dump':source},archive)
    target=tmp_path/'received';m.unpack(archive,target)
    assert (target/'backup/database.dump').read_bytes()==source.read_bytes()
    with pytest.raises(ValueError):m.unpack(archive,target)
    with pytest.raises(ValueError):m.pack_files({'backup/database.dump':source},archive)


@pytest.mark.parametrize('name',['../outside','/absolute','backup/../../outside','backup/a\\b','backup/CON','control/evil.py'])
def test_handoff_refuses_unsafe_or_unexpected_members_before_writing(tmp_path,name):
    m=module();archive=tmp_path/'bad.tar'
    manifest={'version':1,'kind':'autonomous-private-inputs','files':{name:{'bytes':1,'sha256':hashlib.sha256(b'x').hexdigest()}}}
    with tarfile.open(archive,'w') as tar:
        data=json.dumps(manifest).encode();h=tarfile.TarInfo('handoff.json');h.size=len(data);tar.addfile(h,io.BytesIO(data))
        h=tarfile.TarInfo(name);h.size=1;tar.addfile(h,io.BytesIO(b'x'))
    archive.chmod(0o600)
    with pytest.raises(ValueError,match='HANDOFF_MEMBER_REFUSED'):m.unpack(archive,tmp_path/'received')
    assert not (tmp_path/'outside').exists()


def test_handoff_rejects_corrupt_payload_and_keeps_private_partial(tmp_path):
    m=module();archive=tmp_path/'bad.tar';name='backup/database.dump'
    manifest={'version':1,'kind':'autonomous-private-inputs','files':{name:{'bytes':1,'sha256':'a'*64}}}
    with tarfile.open(archive,'w') as tar:
        data=json.dumps(manifest).encode();h=tarfile.TarInfo('handoff.json');h.size=len(data);tar.addfile(h,io.BytesIO(data))
        h=tarfile.TarInfo(name);h.size=1;tar.addfile(h,io.BytesIO(b'x'))
    archive.chmod(0o600)
    with pytest.raises(ValueError,match='HANDOFF_FILE_CHECKSUM_DIFFERS'):m.unpack(archive,tmp_path/'received')
    assert (tmp_path/'received').exists()


def test_refresh_keeps_verified_private_inputs_and_old_received_immutable(tmp_path,monkeypatch):
    import os,contextlib,autonomous_operator
    if os.name=='nt':monkeypatch.setattr(autonomous_operator,'operation_lock',lambda state:contextlib.nullcontext())
    m=module();source=tmp_path/'original';source.mkdir(mode=0o700)
    values={'backup/database.dump':b'private fixture','release/autonomous-release.json':b'{}'}
    for name,data in values.items():
        p=source/name;p.parent.mkdir(mode=0o700,exist_ok=True);p.write_bytes(data);p.chmod(0o600)
    rows={name:{'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)} for name,data in values.items()}
    (source/'handoff.json').write_text(json.dumps({'version':1,'kind':'autonomous-private-inputs','files':rows}));(source/'handoff.json').chmod(0o600)
    meta={'kind':'autonomous','schemaVersion':2,'instanceId':'aliyun-village','code_sha256':'a','schema_sha256':'b','source_defaults':{},'auth_image_id':'auth','nginx_image_id':'nginx','postgres_image_id':'postgres','archive_filename':'new.tar.gz'}
    (source/'release/autonomous-release.json').write_text(json.dumps(meta));rows['release/autonomous-release.json']={'sha256':m.storage.digest_file(source/'release/autonomous-release.json')[0],'bytes':(source/'release/autonomous-release.json').stat().st_size}
    (source/'handoff.json').write_text(json.dumps({'version':1,'kind':'autonomous-private-inputs','files':rows}))
    metadata=tmp_path/'metadata.json';metadata.write_text(json.dumps(meta));metadata.chmod(0o600)
    image=tmp_path/'new.tar.gz';image.write_bytes(b'new verified fixture image');image.chmod(0o600)
    state=tmp_path/'state';state.mkdir(mode=0o700)
    def collect(backup,storage,image_dir,metadata_arg,**kwargs):
        assert backup==source/'backup' and storage==source/'storage'
        assert kwargs['image_overrides']=={'new.tar.gz':image}
        return {'backup/database.dump':source/'backup/database.dump','release/autonomous-release.json':metadata,'images/new.tar.gz':image}
    monkeypatch.setattr(m,'collect',collect)
    target=tmp_path/'received-new';m.refresh_release(source,image,target,metadata,state=state)
    assert (target/'backup/database.dump').read_bytes()==values['backup/database.dump']
    assert (source/'backup/database.dump').read_bytes()==values['backup/database.dump']
    assert (target/'images/new.tar.gz').read_bytes()==image.read_bytes()
    assert not (source/'images/new.tar.gz').exists()
    with pytest.raises(ValueError):m.refresh_release(source,image,target,metadata,state=state)
    meta['schema_sha256']='changed';metadata.write_text(json.dumps(meta))
    with pytest.raises(ValueError,match='BOOTSTRAP_RELEASE_COMPATIBILITY_REQUIRED'):m.refresh_release(source,image,tmp_path/'different-schema',metadata,state=state)
    (state/'release.json').write_text('{}')
    with pytest.raises(ValueError,match='PREDEPLOY_RELEASE_REFRESH_ONLY'):m.refresh_release(source,image,tmp_path/'other',metadata,state=state)


def test_refresh_refuses_changed_private_input_before_repack(tmp_path,monkeypatch):
    import os,contextlib,autonomous_operator
    if os.name=='nt':monkeypatch.setattr(autonomous_operator,'operation_lock',lambda state:contextlib.nullcontext())
    m=module();root=tmp_path/'old';root.mkdir(mode=0o700)
    (root/'handoff.json').write_text(json.dumps({'version':1,'kind':'autonomous-private-inputs','files':{'backup/database.dump':{'sha256':'a'*64,'bytes':1}}}));(root/'handoff.json').chmod(0o600)
    (root/'backup').mkdir(mode=0o700);(root/'backup/database.dump').write_bytes(b'bad');(root/'backup/database.dump').chmod(0o600)
    state=tmp_path/'state';state.mkdir(mode=0o700)
    with pytest.raises(ValueError,match='RECEIVED_HANDOFF_FILE_CHANGED'):m.refresh_release(root,tmp_path/'image',tmp_path/'new',tmp_path/'meta',state=state)
