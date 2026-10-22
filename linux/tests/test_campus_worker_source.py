import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))
from campus_worker_source import allowed,verify


def test_code_bundle_requires_exact_manifest_and_rejects_extra_or_changed_code(tmp_path):
    p=tmp_path/'linux/scripts/a.py';p.parent.mkdir(parents=True);p.write_bytes(b'pass\n')
    record={'version':1,'kind':'campus-worker-code','commit':'a'*40,'files':{'linux/scripts/a.py':hashlib.sha256(p.read_bytes()).hexdigest()}}
    (tmp_path/'worker-source.json').write_text(json.dumps(record))
    assert verify(tmp_path)=='a'*40
    p.write_bytes(b'changed')
    with pytest.raises(ValueError,match='DIGEST_CHANGED'):verify(tmp_path)
    p.write_bytes(b'pass\n');(tmp_path/'unexpected.py').write_bytes(b'pass')
    with pytest.raises(ValueError,match='FILE_SET_CHANGED'):verify(tmp_path)


def test_export_contains_committed_code_only_with_portable_safe_tar_members(tmp_path,monkeypatch):
    spec=importlib.util.spec_from_file_location('campus_bundle',S/'prepare-campus-worker-bundle.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    paths=['linux/scripts/install-autonomous-workers.py','linux/scripts/campus_worker_source.py','linux/Dockerfile.worker-local-overlay','server/src/village_processing/local_task_http.py','linux/gpu.env','models/key.pth']
    def git(args,**kwargs):
        if args[1]=='rev-parse':return 'a'*40+'\n'
        if args[1]=='ls-files':return ('\0'.join(paths)+'\0').encode()
        if args[1]=='show':return b'# committed source\n'
        raise AssertionError(args)
    monkeypatch.setattr(m.subprocess,'check_output',git)
    out=tmp_path/'public-code.tar.gz';report=m.prepare(tmp_path,out)
    assert report['archive_sha256']==hashlib.sha256(out.read_bytes()).hexdigest()
    with tarfile.open(out) as archive:
        members=archive.getmembers()
        assert all(v.isfile() or v.isdir() for v in members)
        assert all('\\' not in v.name and '..' not in Path(v.name).parts for v in members)
        manifest=next(v for v in members if v.name.endswith('/worker-source.json'))
        record=json.load(archive.extractfile(manifest))
        assert set(record['files'])==set(paths[:4])
    for name in ('linux/gpu.env','../bad.py','/linux/scripts/a.py','linux/scripts/../../bad.py'):
        assert not allowed(name)
