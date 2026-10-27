"""Build two checksum-pinned, standalone operators; no model weights included."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import zlib

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent));sys.path.insert(0,str(ROOT))
import component_quality_rollout as worker
import build_component_frontend_patch as frontend
from rural_house_generator.backend.component_building.app.facade import normalize_facade


def smoke():
    building={'id':'quality-smoke','geometry_revision':1,'origin':[0,0],
              'local_rings':[[[-5,-4],[5,-4],[5,4],[-5,4],[-5,-4]]]}
    payload={'floors':2,'floor_height':3.4,'front_edge':0,'facade':{'width':10,'depth':8,
        'masses':[{'id':'m','x0':-5,'x1':5,'front':0}],
        'openings':[{'id':'access','mass':'m','x':1,'width':2,'bottom':3.45,'height':2.6,
                     'kind':'door','shape':'rect','subtype':'glazed_door'}],
        'balconies':[{'x':1,'width':3,'base':3.4,'depth':.9,'rail_height':1,'railing':{'style':'metal'}}],
        'structure':{'porches':[{'mass':'m','x0':-.5,'x1':2.5,'bottom':3.4,'top':6.8,'recess':.65}]},
        'roof':{'type':'hip','rise':1.4},'render_profile':'rural-realistic','wall_joints':True,
        'entrance_support_version':1,'complete_hidden':True}}
    return {'spec':normalize_facade(building,payload),'render':False,'web_compression':True}


def build(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    values={'files':{name:base64.b64encode((ROOT/name).read_bytes().replace(b'\r\n',b'\n')).decode() for name in worker.FILES},
            'startup_helper':base64.b64encode((ROOT/'linux/scripts/component_worker_startup_recovery.py').read_bytes().replace(b'\r\n',b'\n')).decode(),
            'smoke':smoke()}
    data=json.dumps(values,sort_keys=True).encode()
    code=Path(worker.__file__).read_text(encoding='utf8')
    code=code.replace("PAYLOAD=''",'PAYLOAD='+repr(base64.b64encode(zlib.compress(data,9)).decode()))
    code=code.replace("PAYLOAD_SHA256=''",'PAYLOAD_SHA256='+repr(hashlib.sha256(data).hexdigest()))
    (folder/'component-quality-worker-20261027.py').write_text(code,encoding='utf8',newline='\n')
    cloud=folder/'component-quality-cloud-20261027.py';frontend.build(cloud)
    code=cloud.read_text(encoding='utf8').replace("PATCH = 'generator-preview-layout-20261026-v1'","PATCH = 'generator-quality-20261027-v1'")
    code=code.replace('REQUIRE_IDLE = False','REQUIRE_IDLE = True')
    cloud.write_text(code,encoding='utf8',newline='\n')


if __name__=='__main__':build(sys.argv[1])
