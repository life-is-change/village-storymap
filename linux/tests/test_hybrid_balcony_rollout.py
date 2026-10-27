import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import pytest

ROOT=Path(__file__).resolve().parents[2]


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def test_bundle_has_current_geometry_and_real_floor_smoke(tmp_path):
    builder=load(ROOT/'linux/scripts/build_hybrid_balcony_bundle.py','hybrid_builder_test')
    path=builder.build(tmp_path)
    module=load(path,'hybrid_release_test')
    value=module.unpack()
    assert len(value['files'])==11
    assert any(p.endswith('modeling/generate_facade.py') for p in value['files'])
    assert value['smoke']['spec']['facade']['structure']['balcony_relations'][0]['clear_depth']==1.5
    assert 'balcony_floor_support_samples' in module.SMOKE
    assert "'--tail', '100'" not in __import__('base64').b64decode(value['startup_helper']).decode()
    text=path.read_text(encoding='utf8')
    assert "old_document=state/'quality-20261027-v1/facade-worker.json'" in text
    assert "folder=state/'hybrid-balcony-20261027-v1'" in text


def test_baseline_requires_completed_pinned_quality_receipt(tmp_path,monkeypatch):
    builder=load(ROOT/'linux/scripts/build_hybrid_balcony_bundle.py','hybrid_baseline_builder')
    module=load(builder.build(tmp_path/'release'),'hybrid_baseline_test')
    monkeypatch.setattr(module,'BASE',tmp_path)
    operators=tmp_path/'operators';operators.mkdir()
    (operators/'component-quality-worker-20261027.py').write_bytes((ROOT/'linux/releases/component-quality-worker-20261027.py').read_bytes())
    old={'phase':'complete','operator_sha256':module.BASELINE_SHA,'payload_sha256':module.BASELINE_PAYLOAD_SHA,
         'image':'verified-quality-image','new_container_id':'verified-quality-id'}
    parent={'quality_patch':{'operator_sha256':module.BASELINE_SHA,'payload_sha256':module.BASELINE_PAYLOAD_SHA},
            'images':{module.WORKER:old['image']},'after':{module.WORKER:old['new_container_id']}}
    values={'quality-20261027-v1/checkpoint.json':old,'receipt.json':parent}
    state=tmp_path/'state';state.mkdir()
    storage=SimpleNamespace(read_private_json=lambda p:copy.deepcopy(values[str(p.relative_to(state)).replace('\\','/')]))
    module.configure_quality_baseline(state,storage)
    assert module.BASE_IMAGE=='verified-quality-image'
    old['phase']='replacing'
    with pytest.raises(ValueError,match='COMPLETED_QUALITY_BASELINE_REQUIRED'):module.configure_quality_baseline(state,storage)
