import contextlib,hashlib,importlib.util,json,os,py_compile,sys
from pathlib import Path
from types import SimpleNamespace
import pytest
S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))

def module():
 p=S/'repair-autonomous-control-cache.py'
 assert p.is_file(), 'missing source-preserving bytecode quarantine'
 spec=importlib.util.spec_from_file_location('control_cache_repair',p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def fixture(tmp_path,monkeypatch):
 m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
 control=state/'control';control.mkdir(mode=0o700)
 original=state/'releases/autonomous-fixture/control';original.mkdir(parents=True)
 for root in (original,control):
  (root/'sample.py').write_text('VALUE=1\n');(root/'sample.py').chmod(0o600)
 digest=m.tree_digest(original)
 meta={'kind':'autonomous','schemaVersion':2,'releaseId':'autonomous-fixture','control_sha256':digest,
  'archive_sha256':'a'*64,'schema_sha256':'b'*64,'static_sha256':'c'*64,'code_sha256':'d'*64}
 m.storage.write_private_json(state/'release.json',meta)
 monkeypatch.setattr(m,'load_script',lambda name:SimpleNamespace(read_meta=lambda:meta))
 if os.name!='posix':monkeypatch.setattr(m,'operation_lock',lambda state:contextlib.nullcontext())
 py_compile.compile(str(control/'sample.py'),doraise=True)
 return m,state,control,original,meta

def test_quarantine_preserves_cache_bytes_and_exact_source_digest(tmp_path,monkeypatch):
 m,state,control,original,meta=fixture(tmp_path,monkeypatch)
 cached=next((control/'__pycache__').iterdir());raw=cached.read_bytes()
 assert m.tree_digest(control)!=meta['control_sha256']
 assert m.repair(state)==1
 assert m.tree_digest(control)==meta['control_sha256']==m.tree_digest(original)
 copies=list((state/'control-bytecode-quarantine').rglob('*.pyc'))
 assert len(copies)==1 and copies[0].read_bytes()==raw
 assert not (control/'__pycache__').exists()
 assert m.repair(state)==0
 if os.name=='posix':
  assert control.stat().st_mode&0o777==0o500
  control.chmod(0o700)

@pytest.mark.parametrize('change',['source','extra','unknown-cache','hardlink-cache'])
def test_source_changes_or_unknown_extras_stop_before_quarantine(tmp_path,monkeypatch,change):
 m,state,control,original,meta=fixture(tmp_path,monkeypatch)
 if change=='source':(control/'sample.py').write_text('VALUE=2\n')
 elif change=='extra':(control/'unexpected.py').write_text('VALUE=3\n')
 elif change=='unknown-cache':(control/'__pycache__/unknown.cpython-312.pyc').write_bytes(b'untrusted')
 else:os.link(next((control/'__pycache__').iterdir()),control/'__pycache__/sample.cpython-999.pyc')
 with pytest.raises(ValueError):m.repair(state)
 assert (control/'__pycache__').exists()
 assert not (state/'control-bytecode-quarantine').exists()

def test_child_environment_always_disables_bytecode_without_passing_pg_overrides(monkeypatch):
 from autonomous_operator import clean_environment
 monkeypatch.setenv('PYTHONDONTWRITEBYTECODE','0');monkeypatch.setenv('PGHOST','invalid')
 env=clean_environment()
 assert env['PYTHONDONTWRITEBYTECODE']=='1' and 'PGHOST' not in env
