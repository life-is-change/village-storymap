import json
from pathlib import Path

import pytest
from PIL import Image

from rural_house_generator.backend.component_building.adapter import build_spec, validate_options


def evidence():
    return {'feature_version': 3, 'building_box': [.1, .05, .9, .95], 'detections': [
        {'kind': 'building', 'box': [.1, .05, .9, .95], 'score': .9},
        {'kind': 'roof', 'box': [.1, .05, .9, .2], 'score': .9},
        {'kind': 'door', 'box': [.4, .65, .55, .94], 'score': .9},
        {'kind': 'window', 'box': [.6, .3, .8, .5], 'score': .9},
    ]}


def test_height_uses_wall_aspect_and_known_front_width_not_nine_meters(tmp_path):
    image = tmp_path / 'photo.png'
    Image.new('RGB', (1000, 1000), '#cccccc').save(image)
    result = build_spec(image, evidence(), {'buildingWidth': 12, 'buildingDepth': 8,
        'modelPurpose': 'existing', 'floors': 3, 'roofCount': 1})
    spec = result['spec']
    crop = result['crop']
    assert spec['metrics']['wall_height'] == pytest.approx(12 * (crop[3]-crop[1])/(crop[2]-crop[0]))
    assert spec['facade']['width'] == 12
    assert spec['facade']['depth'] == 8
    assert spec['facade']['masses'][0]['front'] == 0
    assert spec['local_frame']['front_tangent'] == [1, 0]
    assert spec['metrics']['wall_height'] != 9
    assert spec['platform']['height_source'] == 'rectified-wall-aspect'
    assert result['warnings'] == spec['assumptions'] == spec['warnings']
    assert not any('不强制匹配' in text for text in result['warnings'])


def test_options_reject_unbounded_geometry_and_preserve_legacy_default():
    assert validate_options({})['generation_method'] == 'texture'
    with pytest.raises(ValueError):
        validate_options({'generationMethod': 'components', 'modelPurpose': 'arbitrary'})
    with pytest.raises(ValueError):
        validate_options({'generationMethod': 'components', 'floors': 999})


def test_irregular_existing_footprint_is_not_silently_replaced(tmp_path):
    image = tmp_path / 'photo.png'; Image.new('RGB', (100, 100)).save(image)
    with pytest.raises(ValueError, match='占地'):
        build_spec(image, evidence(), {'buildingWidth': 12, 'buildingDepth': 8,
            'modelPurpose': 'existing', 'footprintRectangularity': .65})


def test_standard_elevation_publishes_a_full_mask_without_calling_rectifier(tmp_path):
    from rural_house_generator.backend.app.facade.job_processor import FacadeJobProcessor
    class FailRectifier:
        def rectify_file(self, *args):
            raise AssertionError('Standard design image must not be rectified or cleaned')
    image = tmp_path/'source.png'; Image.new('RGB', (64, 96)).save(image)
    artifacts = FacadeJobProcessor(FailRectifier(), None).rectify(image, tmp_path/'job', use_original=True)
    assert artifacts.building_mask.is_file()
    assert Image.open(artifacts.source).size == (64, 96)
    assert json.loads(artifacts.diagnostics.read_text())['resample_passes'] == 0


def test_cleaning_preserves_air_conditioner_railing_eave_pixels():
    import numpy as np
    from rural_house_generator.backend.component_building.detection import subtract_protected
    occlusion = np.full((10, 10), 255, dtype='uint8')
    protected = np.zeros((10, 10), dtype='uint8'); protected[2:5, 3:7] = 255
    result = subtract_protected(occlusion, protected)
    assert not result[2:5, 3:7].any()
    assert result[8, 8] == 255


def test_web_texture_budget_preserves_geometry_bytes_and_image_binding(tmp_path):
    import io, struct
    from rural_house_generator.backend.component_building.assets import optimize_web_glb
    encoded=io.BytesIO();Image.new('RGB',(1024,1024),'#ab5835').save(encoded,format='PNG')
    geometry=b'geometry1234';binary=geometry+encoded.getvalue()
    doc={'asset':{'version':'2.0'},'buffers':[{'byteLength':len(binary)}],
         'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(geometry)},
                        {'buffer':0,'byteOffset':len(geometry),'byteLength':len(encoded.getvalue())}],
         'images':[{'bufferView':1,'mimeType':'image/png'}]}
    js=json.dumps(doc).encode();js+=b' '*((-len(js))%4);binary+=b'\0'*((-len(binary))%4)
    path=tmp_path/'model.glb';path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)
    result=optimize_web_glb(path);raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
    packed=json.loads(raw[20:20+length]);payload=raw[28+length:]
    assert payload[:len(geometry)]==geometry
    assert packed['images'][0]['bufferView']==1
    view=packed['bufferViews'][1]
    assert Image.open(io.BytesIO(payload[view['byteOffset']:view['byteOffset']+view['byteLength']])).size==(512,512)
    assert result['texture_max_size']==512


def test_worker_does_not_advertise_components_for_blender_three_zero_or_old_ml(monkeypatch):
    from types import SimpleNamespace
    from rural_house_generator.backend.component_building import capability
    blender=SimpleNamespace(executable=Path('/usr/bin/blender'))
    monkeypatch.setattr(capability.subprocess,'run',lambda *a,**k:SimpleNamespace(returncode=0,stdout='Blender 3.0.1'))
    assert capability.compatible(blender) is False
    monkeypatch.setattr(capability.subprocess,'run',lambda *a,**k:SimpleNamespace(returncode=0,stdout='Blender 3.6.23'))
    monkeypatch.setattr(capability.LocalModelClient,'health',lambda self:{'status':'ok'})
    assert capability.compatible(blender) is False
    monkeypatch.setattr(capability.LocalModelClient,'health',lambda self:{'status':'ok','components_version':1})
    assert capability.compatible(blender) is True
