"""Build a standalone overlay on the verified quality rollout, not old images."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import zlib

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent));sys.path.insert(0,str(ROOT))
import component_quality_rollout as quality
from build_component_quality_bundle import smoke

BASELINE_SHA='51294854b024360ec6f3a2543906a13792d17c2c343f70b77e998bab00e53677'
FILES=quality.FILES+tuple(quality.PREFIX+p for p in ('modeling/generate_facade.py','modeling/balcony_layout.py'))

CONFIGURE='''
def configure_quality_baseline(state,storage):
    global BASE_IMAGE
    old_path=state/'quality-20261027-v1/checkpoint.json'
    original=BASE/'operators/component-quality-worker-20261027.py'
    if any(p.is_symlink() for p in (original,*original.parents)) or digest(original.read_bytes())!=BASELINE_SHA:
        raise ValueError('VERIFIED_QUALITY_OPERATOR_REQUIRED')
    old=storage.read_private_json(old_path)
    current=storage.read_private_json(state/'receipt.json')
    checkpoint=state/'hybrid-balcony-20261027-v1/checkpoint.json'
    if checkpoint.exists():current=storage.read_private_json(checkpoint)['parent_before']
    if (old.get('phase')!='complete' or old.get('operator_sha256')!=BASELINE_SHA
            or old.get('payload_sha256')!=BASELINE_PAYLOAD_SHA
            or current.get('quality_patch')!={'operator_sha256':BASELINE_SHA,'payload_sha256':BASELINE_PAYLOAD_SHA}
            or current['images'][WORKER]!=old['image'] or current['after'][WORKER]!=old['new_container_id']):
        raise ValueError('COMPLETED_QUALITY_BASELINE_REQUIRED')
    BASE_IMAGE=old['image']
'''


def replace_once(code,old,new):
    if code.count(old)!=1:raise ValueError('BUNDLE_TEMPLATE_CHANGED')
    return code.replace(old,new,1)


def build(folder):
    frozen=quality.load_module(ROOT/'linux/releases/component-quality-worker-20261027.py','hybrid_quality_baseline')
    frozen_data=(ROOT/'linux/releases/component-quality-worker-20261027.py').read_bytes()
    if quality.digest(frozen_data)!=BASELINE_SHA:raise ValueError('FROZEN_QUALITY_RELEASE_CHANGED')
    config=smoke()
    config['spec']['facade']['structure']['porches'][0]['recess']=1.0
    config['spec']['facade']['structure']['balcony_relations']=[{'balcony':0,'opening_id':config['spec']['facade']['openings'][0]['id'],
        'depth_version':1,'clear_depth':1.5,'recess':1.,'placement':'recessed-prior','depth_measured':False}]
    value={'files':{p:base64.b64encode((ROOT/p).read_bytes().replace(b'\r\n',b'\n')).decode() for p in FILES},
           'startup_helper':base64.b64encode((ROOT/'linux/scripts/component_worker_startup_recovery.py').read_bytes().replace(b'\r\n',b'\n')).decode(),
           'smoke':config}
    raw=json.dumps(value,sort_keys=True).encode()
    code=Path(quality.__file__).read_text(encoding='utf8')
    code=replace_once(code,"PAYLOAD=''",'PAYLOAD='+repr(base64.b64encode(zlib.compress(raw,9)).decode()))
    code=replace_once(code,"PAYLOAD_SHA256=''",'PAYLOAD_SHA256='+repr(quality.digest(raw)))
    code=replace_once(code,"def digest(data):",'BASELINE_SHA='+repr(BASELINE_SHA)+'\nBASELINE_PAYLOAD_SHA='+repr(frozen.PAYLOAD_SHA256)+'\n'+CONFIGURE+'\n\ndef digest(data):')
    start=code.index('FILES=tuple(');end=code.index('\nPAYLOAD=',start)
    code=code[:start]+'FILES='+repr(FILES)+code[end:]
    code=code.replace("folder=state/'quality-20261027-v1'","folder=state/'hybrid-balcony-20261027-v1'")
    code=code.replace("old_document=state/'startup-health-recovery/facade-worker.json'","old_document=state/'quality-20261027-v1/facade-worker.json'")
    code=code.replace("'OBSERVED_STARTUP_COMPOSE_REQUIRED'","'OBSERVED_QUALITY_COMPOSE_REQUIRED'")
    code=code.replace('component_quality_worker','component_hybrid_balcony_worker')
    code=code.replace('STOP: COMPONENT_QUALITY ','STOP: COMPONENT_HYBRID_BALCONY ')
    code=replace_once(code,"        with operation_lock(paths['lock']):\n", "        with operation_lock(paths['lock']):\n            configure_quality_baseline(state,storage)\n")
    code=replace_once(code," assert m['balcony_doors']==1", " assert m['balcony_floor_support_samples']==5\n assert len(m['balcony_dimensions'])==1\n d=m['balcony_dimensions'][0]\n assert abs(d['clear_depth']-1.5)<1e-6 and abs(d['recess']-1.)<1e-6 and .5<d['projection']<.65\n assert m['balcony_doors']==1")
    compile(code,'hybrid-operator','exec')
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    path=folder/'component-hybrid-balcony-worker-20261027.py'
    path.write_text(code,encoding='utf8',newline='\n')
    return path


if __name__=='__main__':print(build(sys.argv[1]))
