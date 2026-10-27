import importlib.util
from pathlib import Path
import subprocess
import pytest

ROOT=Path(__file__).resolve().parents[2]


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


@pytest.fixture
def deployment(tmp_path,monkeypatch):
    builder=load(ROOT/'linux/scripts/build_scene_terrain_patch.py','scene_terrain_builder')
    path=tmp_path/'release.py';builder.build(path);m=load(path,'scene_terrain_release')
    state=tmp_path/'state';(state/'web/3D_scenes_edit/preview_3d').mkdir(parents=True)
    (state/'code').mkdir();(state/'operator.py').write_bytes(b'parent')
    monkeypatch.setattr(m,'PARENT_OPERATOR_SHA256',m.sha(b'parent'))
    before=subprocess.check_output(['git','show','757bec9:'+builder.FILE],cwd=ROOT)
    assert m.sha(before)==builder.BEFORE_SHA
    (state/'web'/builder.FILE).write_bytes(before)
    (state/'web/keep.txt').write_bytes(b'keep');(state/'code/api.js').write_bytes(b'api')
    parent={'phase':'complete','kind':'cloud','commit':m.COMMIT,'operator_sha256':m.PARENT_OPERATOR_SHA256,
            'api_hashes':{'api.js':m.sha(b'api')},'web_sha256':m.tree_digest(state/'web'),'after':{'api':'id-api','web':'id-web'}}
    m.write_json(state/'receipt.json',parent)
    return m,state,parent,builder,before


def test_single_file_preflight_is_read_only_and_apply_resumes_without_changing_api(deployment):
    m,state,parent,builder,before=deployment
    values=m.payload();assert set(values)=={builder.FILE}
    assert values[builder.FILE]==(ROOT/builder.FILE).read_bytes().replace(b'\r\n',b'\n')
    invoke=lambda apply:m.patch(state,values,apply=apply,inspect=lambda *_:None,served=lambda *_:None)
    assert invoke(False)['status']=='scene_terrain_frontend_preflight_passed'
    assert not (state/m.PATCH).exists()
    invoke(True);invoke(True)
    assert (state/m.PATCH/builder.FILE).read_bytes()==before
    assert (state/'web/keep.txt').read_bytes()==b'keep'
    after=m.read_json(state/'receipt.json')
    assert after['after']==parent['after'] and after['api_hashes']==parent['api_hashes']


def test_different_observed_script_is_not_overwritten(deployment):
    m,state,parent,builder,_=deployment
    (state/'web'/builder.FILE).write_bytes(b'other revision')
    parent['web_sha256']=m.tree_digest(state/'web');m.write_json(state/'receipt.json',parent)
    with pytest.raises(ValueError,match='OBSERVED_SCENE_SCRIPT_REQUIRED'):
        m.patch(state,m.payload(),apply=True,inspect=lambda *_:None,served=lambda *_:None)
    assert not (state/m.PATCH).exists()
