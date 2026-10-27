"""Embed the single scene-terrain performance fix in the verified cloud operator."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import zlib

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent))
import component_frontend_patch as operator

FILE='3D_scenes_edit/preview_3d/scene-preview-adapter.js'
BEFORE_SHA='bd098f42f446e37121886b2ff9877e0a877222d8692efacfdd1fb52654d271a5'


def build(output):
    values={FILE:base64.b64encode((ROOT/FILE).read_bytes().replace(b'\r\n',b'\n')).decode()}
    raw=json.dumps(values,sort_keys=True).encode()
    code=Path(operator.__file__).read_text(encoding='utf8')
    start=code.index('FILES = tuple(');end=code.index('# Release builder',start)
    code=code[:start]+'FILES = '+repr((FILE,))+'\nEXPECTED_BEFORE = '+repr({FILE:BEFORE_SHA})+'\n'+code[end:]
    code=code.replace("PAYLOAD = ''",'PAYLOAD = '+repr(base64.b64encode(zlib.compress(raw,9)).decode()))
    code=code.replace("PAYLOAD_SHA256 = ''",'PAYLOAD_SHA256 = '+repr(hashlib.sha256(raw).hexdigest()))
    code=code.replace("PATCH = 'generator-preview-layout-20261026-v1'","PATCH = 'scene-terrain-performance-20261027-v1'")
    marker='    if not apply:\n'
    if code.count(marker)!=1:raise ValueError('CLOUD_PATCH_TEMPLATE_CHANGED')
    code=code.replace(marker,"    if {name: sha(data) for name, data in old.items()} != EXPECTED_BEFORE:\n        raise ValueError('OBSERVED_SCENE_SCRIPT_REQUIRED')\n"+marker)
    code=code.replace('component_generator_frontend_preflight_passed','scene_terrain_frontend_preflight_passed')
    code=code.replace('component_generator_frontend_updated_real_photo_test_pending','scene_terrain_frontend_updated_reload_pending')
    code=code.replace('FIVE_GENERATOR_FILES_REQUIRED','ONE_SCENE_SCRIPT_REQUIRED')
    code=code.replace('STOP: GENERATOR_FRONTEND_PATCH ','STOP: SCENE_TERRAIN_PATCH ')
    compile(code,str(output),'exec')
    Path(output).write_text(code,encoding='utf8',newline='\n')


if __name__=='__main__':build(sys.argv[1])
