import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import pytest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('quality_rollout_test',ROOT/'linux/scripts/component_quality_rollout.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def baseline():
    rows={name:{'Id':name+'-id','Image':image,'State':{'Running':True,'Health':{'Status':'healthy'}},
                'Config':{'Env':['A=B']},'resources':['original']} for name,image in [(m.WORKER,m.BASE_IMAGE),(m.ML,m.ML_IMAGE)]}
    parent={'phase':'complete','commit':m.COMMIT,'kind':'worker','operator_sha256':m.OPERATOR_SHA,
            'images':{name:r['Image'] for name,r in rows.items()},'after':{name:r['Id'] for name,r in rows.items()},'other':{'geo':'untouched'}}
    api=SimpleNamespace(resource_snapshot=lambda row:row['resources'])
    return api,parent,rows


def test_only_observed_running_worker_and_ml_are_accepted():
    api,parent,rows=baseline();m.validate_live(api,parent,rows,None)
    rows[m.ML]['Image']='another-image'
    with pytest.raises(ValueError,match='ML_IDENTITY'):m.validate_live(api,parent,rows,None)


def test_stopped_old_worker_resumes_only_after_replacing_checkpoint():
    api,parent,rows=baseline();progress={'parent_before':parent,'image':'new-image','phase':'built','worker_before':copy.deepcopy(rows[m.WORKER])}
    rows[m.WORKER]['State']['Running']=False
    with pytest.raises(ValueError,match='WORKER_NOT_STABLE'):m.validate_live(api,parent,rows,progress)
    progress['phase']='replacing';m.validate_live(api,parent,rows,progress)


def test_created_quality_worker_resumes_but_crashed_quality_worker_requires_diagnosis():
    api,parent,rows=baseline();progress={'parent_before':parent,'image':'new-image','phase':'replacing','worker_before':copy.deepcopy(rows[m.WORKER])}
    rows[m.WORKER].update(Id='new-id',Image='new-image')
    rows[m.WORKER]['State'].update(Running=False,Status='created',ExitCode=0)
    m.validate_live(api,parent,rows,progress)
    rows[m.WORKER]['State'].update(Status='exited',ExitCode=1)
    with pytest.raises(ValueError,match='WORKER_NOT_STABLE'):m.validate_live(api,parent,rows,progress)


def test_image_transition_cannot_change_env_or_resources():
    api,parent,rows=baseline();progress={'parent_before':parent,'image':'new-image','phase':'built','worker_before':copy.deepcopy(rows[m.WORKER])}
    rows[m.WORKER].update(Id='new-id',Image='new-image');m.validate_live(api,parent,rows,progress)
    rows[m.WORKER]['Config']['Env'].append('CHANGED=1')
    with pytest.raises(ValueError,match='WORKER_RESOURCES_CHANGED'):m.validate_live(api,parent,rows,progress)


def test_missing_worker_resumes_only_during_validated_replacement():
    _,parent,rows=baseline()
    class Docker:
        def inspect(self,name):
            if name==m.WORKER:raise RuntimeError('DOCKER_OPERATION_FAILED')
            return rows[name]
        def run(self,*args):return ''
    with pytest.raises(RuntimeError):m.inspect_rows(Docker(),None)
    progress={'phase':'replacing','worker_before':rows[m.WORKER],'parent_before':parent}
    recovered=m.inspect_rows(Docker(),progress)
    assert recovered[m.WORKER]['quality_missing'] is True
    assert recovered[m.ML] is rows[m.ML]


def test_new_receipt_preserves_ml_other_services_and_original_parent():
    _,parent,_=baseline();old=copy.deepcopy(parent)
    progress={'parent_before':parent,'image':'new-image','operator_sha256':'sha1','payload_sha256':'sha2'}
    after=m.updated_parent(progress,'new-id')
    assert after['images'][m.WORKER]=='new-image'
    assert after['after'][m.WORKER]=='new-id'
    assert after['after'][m.ML]==old['after'][m.ML]
    assert after['other']==old['other']
    assert parent==old


def test_quality_bundle_embeds_reviewed_files_and_glazed_door_smoke(tmp_path):
    builder=m.load_module(ROOT/'linux/scripts/build_component_quality_bundle.py','quality_builder_test')
    builder.build(tmp_path)
    release=m.load_module(tmp_path/'component-quality-worker-20261027.py','quality_release_test')
    value=release.unpack()
    assert set(value['files'])==set(m.FILES)
    assert value['smoke']['spec']['facade']['openings'][0]['subtype']=='glazed_door'
    cloud=m.load_module(tmp_path/'component-quality-cloud-20261027.py','quality_cloud_test')
    assert cloud.REQUIRE_IDLE is True
    assert cloud.PATCH=='generator-quality-20261027-v1'
    assert len(cloud.payload())==5


def test_relation_ids_follow_normalized_openings_without_mutating_input():
    builder=m.load_module(ROOT/'linux/scripts/build_component_quality_bundle.py','quality_relation_builder')
    payload=builder.smoke()['spec']
    payload['facade']['openings'][0]['id']='photo-candidate'
    payload['facade']['structure']['balcony_relations']=[{'opening_id':'photo-candidate','balcony':0,'depth_measured':False}]
    building={'id':'test','geometry_revision':1,'origin':[0,0],'local_rings':[[[-5,-4],[5,-4],[5,4],[-5,4],[-5,-4]]]}
    from rural_house_generator.backend.component_building.app.facade import normalize_facade
    value=normalize_facade(building,payload)
    assert value['facade']['structure']['balcony_relations'][0]['opening_id']==value['facade']['openings'][0]['id']
    assert payload['facade']['structure']['balcony_relations'][0]['opening_id']=='photo-candidate'
