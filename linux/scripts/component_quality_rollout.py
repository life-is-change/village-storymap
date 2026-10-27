#!/usr/bin/env python3
"""Layer the reviewed component-quality files onto the observed local Worker.

No registry pull, package install, model download, ML update or Docker migration.
"""
import argparse
import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zlib

BASE=Path('/media/gpu332/newapply/village-platform/deploy/components')
COMMIT='af39f0411ac638d360d10e2c4d57e5d8c56ed929'
WORKER='village-platform-facade-worker-1'
ML='village-platform-facade-ml-1'
BASE_IMAGE='sha256:f8643ebfcd2a5d14def8d4bb9cab53fcf0fb336b91839fbd9762cb43f35aef9e'
ML_IMAGE='sha256:a38a7be2a34018802047f88d9692256f4f6d21801559c211ba64c692ccb3a123'
OPERATOR_SHA='274927ea7c2d96ea7c12559c756a959836a89de99a15389c0992a713218e925d'
PREFIX='rural_house_generator/backend/component_building/'
FILES=tuple(PREFIX+name for name in ('adapter.py','app/facade.py','app/structure.py',
    'vision/facade.py','vision/structure_graph.py','vision/balcony_relations.py','modeling/component_geometry.py',
    'modeling/realistic_materials.py','modeling/color_space.py'))
PAYLOAD=''
PAYLOAD_SHA256=''
SMOKE=r'''import json,subprocess,tempfile,os
from pathlib import Path
from rural_house_generator.backend.component_building.vision.balcony_relations import relate_balconies
from rural_house_generator.backend.component_building.modeling.color_space import tint_linear_pixels
from rural_house_generator.backend.component_building.assets import optimize_web_glb
import numpy as np
assert abs(float(tint_linear_pixels(np.ones((16,4)),[.5,.5,.5])[0,0])-.21404114)<.00001
with tempfile.TemporaryDirectory() as name:
 p=Path(name);cfg=json.loads(Path('/opt/village-components/quality-smoke.json').read_text(encoding='utf8'))
 cfg['output']=str(p/'building.glb');config=p/'job.json';config.write_text(json.dumps(cfg))
 env=dict(os.environ,RURAL_COMPONENT_CACHE=str(p/'materials'))
 subprocess.run(['/opt/blender-runtime/blender-3.6.23-linux-x64/blender','-b','--factory-startup','--python-exit-code','1',
 '--python','/opt/village-components/rural_house_generator/backend/component_building/modeling/generate_facade.py','--',str(config)],
 check=True,stdout=subprocess.DEVNULL,env=env,timeout=180)
 m=json.loads((p/'manifest.json').read_text(encoding='utf8'))
 assert m['balcony_doors']==1 and m['opening_center_wall_hits']==0 and m['roof_bearing_misses']==0
 assert m['roof_shell_checks'] and all(c['nonmanifold_edges']==0 and c['winding_conflicts']==0 for c in m['roof_shell_checks'])
 assert (p/'building.glb').read_bytes()[:4]==b'glTF'
 optimize_web_glb(p/'building.glb')
 print(json.dumps({'quality_geometry_smoke':True,'glazed_balcony_doors':m['balcony_doors'],'glb_bytes':(p/'building.glb').stat().st_size}))
'''


def digest(data):return hashlib.sha256(data).hexdigest()


def load_module(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def unpack():
    raw=zlib.decompress(base64.b64decode(PAYLOAD))
    if digest(raw)!=PAYLOAD_SHA256:raise ValueError('QUALITY_PAYLOAD_CHANGED')
    value=json.loads(raw)
    if set(value['files'])!=set(FILES):raise ValueError('NINE_REVIEWED_FILES_REQUIRED')
    return value


def context(folder,value,m):
    root=folder/'build-context';root.mkdir(mode=0o700,exist_ok=True)
    for name,data in value['files'].items():m.write_public(root,name,base64.b64decode(data))
    m.write_public(root,'quality-smoke.json',json.dumps(value['smoke']).encode())
    text='FROM village-component-quality-base:'+BASE_IMAGE[7:19]+'\nCOPY --chown=10001:10001 rural_house_generator /opt/village-components/rural_house_generator\nCOPY --chown=10001:10001 quality-smoke.json /opt/village-components/quality-smoke.json\n'
    m.write_public(root,'Dockerfile',text.encode())
    return root


def validate_live(m,parent,rows,progress):
    before=progress['parent_before'] if progress else parent
    if before.get('phase')!='complete' or before.get('commit')!=COMMIT or before.get('kind')!='worker' or before.get('operator_sha256')!=OPERATOR_SHA:
        raise ValueError('COMPLETED_COMPONENT_WORKER_REQUIRED')
    if before['images'].get(WORKER)!=BASE_IMAGE or before['images'].get(ML)!=ML_IMAGE:
        raise ValueError('OBSERVED_QUALITY_BASE_REQUIRED')
    if rows[ML]['Id']!=before['after'][ML] or rows[ML]['Image']!=ML_IMAGE or rows[ML]['State'].get('Health',{}).get('Status')!='healthy':
        raise ValueError('ML_IDENTITY_OR_HEALTH_CHANGED')
    row=rows[WORKER];allowed={BASE_IMAGE}
    if progress:allowed.add(progress['image'])
    if row['Image'] not in allowed:raise ValueError('WORKER_IMAGE_CHANGED')
    required=before['after'][WORKER] if row['Image']==BASE_IMAGE else progress.get('new_container_id')
    if required and row['Id']!=required:raise ValueError('WORKER_CONTAINER_CHANGED')
    replacing=progress and progress['phase']=='replacing' and not row['State'].get('Restarting')
    resumable=replacing and (row['Image']==BASE_IMAGE or (row['State'].get('Status') in ('created','exited') and row['State'].get('ExitCode',0)==0))
    if (not row['State']['Running'] or row['State'].get('Restarting')) and not resumable:raise ValueError('WORKER_NOT_STABLE')
    baseline=progress['worker_before'] if progress else row
    if m.resource_snapshot(row)!=m.resource_snapshot(baseline) or row['Config']['Env']!=baseline['Config']['Env']:
        raise ValueError('WORKER_RESOURCES_CHANGED')


def updated_parent(progress,identifier):
    after=copy.deepcopy(progress['parent_before'])
    after['images'][WORKER]=progress['image'];after['after'][WORKER]=identifier
    after['quality_patch']={'operator_sha256':progress['operator_sha256'],'payload_sha256':progress['payload_sha256']}
    return after


def inspect_rows(docker,progress):
    ml=docker.inspect(ML)  # A daemon/permission failure must not look like absence.
    try:worker=docker.inspect(WORKER)
    except RuntimeError:
        if not progress or progress['phase']!='replacing':raise
        names=docker.run('ps','-a','--filter','name=^/'+WORKER+'$','--format','{{.ID}}').strip()
        if names:raise ValueError('WORKER_INSPECTION_FAILED_WITH_EXISTING_NAME')
        worker=copy.deepcopy(progress['worker_before']);worker['quality_missing']=True
    return {WORKER:worker,ML:ml}


def rollout(state,docker,m,storage,*,apply,idle_confirmed=False):
    parent_path=state/'receipt.json';parent=storage.read_private_json(parent_path)
    folder=state/'quality-20261027-v1';storage.no_links(folder)
    folder.mkdir(mode=0o700,exist_ok=True);storage.private_path(folder,directory=True)
    record=folder/'checkpoint.json';progress=storage.read_private_json(record) if record.exists() else None
    own=digest(Path(__file__).read_bytes())
    if progress and (progress['operator_sha256']!=own or progress['payload_sha256']!=PAYLOAD_SHA256):
        raise ValueError('QUALITY_CHECKPOINT_CHANGED')
    rows=inspect_rows(docker,progress)
    validate_live(m,parent,rows,progress)
    baseline=progress['parent_before'] if progress else parent
    if m.all_other(docker,(WORKER,ML))!=baseline['other']:raise ValueError('OTHER_SERVICES_CHANGED')
    if not progress:m.verify(state,docker,COMMIT,'worker')
    if not apply:return {'status':'component_quality_worker_preflight_passed','models_downloaded':False,'ml_update':False}
    if not idle_confirmed:raise ValueError('CONFIRM_CLOUD_PREFLIGHT_IDLE_BEFORE_WORKER_REPLACEMENT')
    value=unpack()
    startup=base64.b64decode(value['startup_helper'])
    m.write_public(folder,'startup-helper.py',startup)
    helper=load_module(folder/'startup-helper.py','quality_startup_helper')
    if progress is None:
        old_document=state/'startup-health-recovery/facade-worker.json'
        document=storage.read_private_json(old_document)
        if rows[WORKER]['Config']['Labels'].get('com.docker.compose.project.config_files')!=str(old_document):
            raise ValueError('OBSERVED_STARTUP_COMPOSE_REQUIRED')
        m.validate_candidate(docker,rows[WORKER],document,'facade-worker')
        root=context(folder,value,m);tag='village-component-quality-base:'+BASE_IMAGE[7:19]
        docker.run('tag',BASE_IMAGE,tag)
        if json.loads(docker.run('image','inspect',tag))[0]['Id']!=BASE_IMAGE:raise ValueError('QUALITY_BASE_TAG_CHANGED')
        image=m.docker_step(docker,'build_quality_overlay','build','--pull=false','--network=none','-q',
                            '-t','village-component-worker:quality-'+PAYLOAD_SHA256[:12],root,timeout=180).strip()
        if not re.fullmatch('sha256:[a-f0-9]{64}',image):raise ValueError('QUALITY_IMAGE_INVALID')
        old,new=[json.loads(docker.run('image','inspect',i))[0] for i in (BASE_IMAGE,image)]
        if new['Config']!=old['Config'] or new['RootFS']['Layers'][:-2]!=old['RootFS']['Layers']:
            raise ValueError('QUALITY_IMAGE_CHANGED_BEYOND_REVIEWED_FILES')
        smoke=m.docker_step(docker,'quality_balcony_and_color_smoke','run','--rm','--pull=never','--network','none',
            '--read-only','--tmpfs','/tmp:rw,size=1073741824,mode=1777','--entrypoint','python',image,'-c',SMOKE,timeout=240)
        document=helper.replacement_document(document,image)
        storage.write_private_json(folder/'facade-worker.json',document)
        progress={'phase':'built','image':image,'parent_before':parent,'worker_before':rows[WORKER],
                  'operator_sha256':own,'payload_sha256':PAYLOAD_SHA256,'smoke':smoke,
                  'compose_sha256':digest((folder/'facade-worker.json').read_bytes())}
        storage.write_private_json(record,progress)
    if digest((folder/'facade-worker.json').read_bytes())!=progress['compose_sha256']:
        raise ValueError('QUALITY_COMPOSE_CHANGED')
    current=inspect_rows(docker,progress);validate_live(m,parent,current,progress)
    if parent not in (progress['parent_before'],updated_parent(progress,current[WORKER]['Id'])):
        raise ValueError('QUALITY_PARENT_RECEIPT_CHANGED')
    if current[WORKER]['Image']==BASE_IMAGE or not current[WORKER]['State']['Running']:
        # Idle confirmation is required immediately before this command sequence.
        progress['phase']='replacing';storage.write_private_json(record,progress)
        if current[WORKER]['Image']==BASE_IMAGE and current[WORKER]['State']['Running'] and not current[WORKER].get('quality_missing'):
            m.docker_step(docker,'stop_idle_worker','stop','--time','45',WORKER,timeout=60)
        m.docker_step(docker,'replace_quality_worker','compose','-f',folder/'facade-worker.json','up','-d',
                      '--no-deps','--no-build','--pull','never','--force-recreate','facade-worker',timeout=120)
    current={name:docker.inspect(name) for name in (WORKER,ML)}
    if current[WORKER]['Image']!=progress['image']:raise ValueError('QUALITY_NEW_IMAGE_REQUIRED')
    progress['new_container_id']=current[WORKER]['Id'];storage.write_private_json(record,progress)
    print(json.dumps({'stage':'quality_worker_startup','status':'started'}),flush=True)
    helper.wait_ready(docker,current[WORKER]['Id'])
    current={name:docker.inspect(name) for name in (WORKER,ML)};validate_live(m,parent,current,progress)
    networks={name:json.loads(docker.run('network','inspect',name))[0] for name in progress['worker_before']['NetworkSettings']['Networks']}
    helper.validate_endpoints(current[WORKER],networks)
    if m.all_other(docker,(WORKER,ML))!=baseline['other']:raise ValueError('OTHER_SERVICES_CHANGED')
    identity="from village_processing.local_task_http import LocalTaskHTTP;h=LocalTaskHTTP(key_file='/run/secrets/aliyun-worker-key',kind='facade');h.verify_identity();h.close()"
    m.docker_step(docker,'quality_aliyun_identity','exec',WORKER,'python','-c',identity,timeout=60)
    after=updated_parent(progress,current[WORKER]['Id'])
    storage.write_private_json(parent_path,after)
    progress['phase']='complete';storage.write_private_json(record,progress)
    m.verify(state,docker,COMMIT,'worker')
    return {'status':'component_quality_worker_updated_real_photo_test_pending','ml_unchanged':True,
            'models_downloaded':False,'blender_reinstalled':False,'other_services_unchanged':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__);action=parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--check',action='store_true');action.add_argument('--apply',action='store_true')
    parser.add_argument('--idle-confirmed',action='store_true');args=parser.parse_args()
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        sys.dont_write_bytecode=True;os.umask(0o077)
        state=BASE/'state'/COMMIT[:12];operator=state/'operator.py'
        if any(p.is_symlink() for p in (operator,*operator.parents)) or digest(operator.read_bytes())!=OPERATOR_SHA:
            raise ValueError('PINNED_COMPONENT_OPERATOR_REQUIRED')
        m=load_module(operator,'quality_observed_operator')
        source=BASE/'releases'/('village-components-'+COMMIT[:12])
        if m.source_context(source)!=COMMIT:raise ValueError('PINNED_COMPONENT_SOURCE_REQUIRED')
        import business_storage_copy as storage
        from autonomous_operator import Docker,operation_lock
        paths=m.worker_paths(source,COMMIT,Path.home());storage.private_path(state,directory=True)
        with operation_lock(paths['lock']):
            result=rollout(state,Docker(state,temporary=paths['temporary']),m,storage,apply=args.apply,idle_confirmed=args.idle_confirmed)
        print(json.dumps(result));return 0
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError) as error:
        code=str(error) if re.fullmatch('[A-Z_]{1,100}',str(error)) else type(error).__name__
        print('STOP: COMPONENT_QUALITY '+code+'. Preserve checkpoints and private logs; do not rerun initial installers.')
        return 1


if __name__=='__main__':raise SystemExit(main())
