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
    with pytest.raises(ValueError):m.unpack(archive,tmp_path/'received')
    assert not (tmp_path/'outside').exists()


def test_handoff_rejects_corrupt_payload_and_keeps_private_partial(tmp_path):
    m=module();archive=tmp_path/'bad.tar';name='backup/database.dump'
    manifest={'version':1,'kind':'autonomous-private-inputs','files':{name:{'bytes':1,'sha256':'a'*64}}}
    with tarfile.open(archive,'w') as tar:
        data=json.dumps(manifest).encode();h=tarfile.TarInfo('handoff.json');h.size=len(data);tar.addfile(h,io.BytesIO(data))
        h=tarfile.TarInfo(name);h.size=1;tar.addfile(h,io.BytesIO(b'x'))
    with pytest.raises(ValueError,match='HANDOFF_FILE_CHECKSUM_DIFFERS'):m.unpack(archive,tmp_path/'received')
    assert (tmp_path/'received').exists()
