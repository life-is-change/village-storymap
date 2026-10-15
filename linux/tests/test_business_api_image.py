import importlib.util
from pathlib import Path
import pytest
S=Path(__file__).resolve().parents[1]/'scripts/build-business-api-image.py'
def module():
    assert S.is_file(), 'Offline image builder missing'
    spec=importlib.util.spec_from_file_location('api_image',S);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def test_code_digest_detects_runtime_changes_but_not_test_files(tmp_path):
    m=module();root=tmp_path/'business-api';(root/'src').mkdir(parents=True);(root/'test').mkdir()
    for f in ('package.json','package-lock.json'): (root/f).write_text('{}')
    (root/'src/main.mjs').write_text('runtime');(root/'test/unit.mjs').write_text('test')
    before=m.code_digest(root);(root/'test/unit.mjs').write_text('changed test');assert m.code_digest(root)==before
    (root/'src/main.mjs').write_text('changed runtime');assert m.code_digest(root)!=before
def test_builder_rejects_unverified_base_and_source_links(tmp_path):
    m=module();bad=tmp_path/'base.tar';bad.write_bytes(b'not an image')
    with pytest.raises(ValueError):m.validate_base(bad,{'config':{'digest':'sha256:untrusted'},'layers':[]})
    with pytest.raises(ValueError):m.validate_base(bad)
