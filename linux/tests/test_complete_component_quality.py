import copy
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import pytest

ROOT=Path(__file__).resolve().parents[2]


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


completion=load(ROOT/'linux/scripts/complete_component_quality.py','completion_test')


def setup():
    path=ROOT/'linux/releases/component-quality-worker-20261027.py'
    assert hashlib.sha256(path.read_bytes()).hexdigest()==completion.ORIGINAL_SHA
    module=load(path,'frozen_quality_test')
    rows={name:{'Id':name,'Image':image,'State':{'Running':True,'Pid':123,'Health':{'Status':'healthy'}},
                'Config':{'Env':['A=B','SECOND=value=with=equals']},'resources':['original']}
          for name,image in ((module.WORKER,module.BASE_IMAGE),(module.ML,module.ML_IMAGE))}
    parent={'phase':'complete','commit':module.COMMIT,'kind':'worker','operator_sha256':module.OPERATOR_SHA,
            'images':{name:r['Image'] for name,r in rows.items()},'after':{name:r['Id'] for name,r in rows.items()}}
    progress={'phase':'replacing','parent_before':copy.deepcopy(parent),'worker_before':copy.deepcopy(rows[module.WORKER]),
              'image':'new-image','new_container_id':'new-id'}
    rows[module.WORKER].update(Id='new-id',Image='new-image')
    rows[module.WORKER]['Config']['Env'].reverse()
    completion.install_completion_guard(module)
    return module,SimpleNamespace(resource_snapshot=lambda r:r['resources']),parent,rows,progress


def test_frozen_validator_accepts_only_order_change_without_mutating_snapshots():
    module,api,parent,rows,progress=setup();saved=copy.deepcopy((parent,rows,progress))
    module.validate_live(api,parent,rows,progress)
    assert (parent,rows,progress)==saved


@pytest.mark.parametrize('change', ['value','duplicate','resource','image','id','stopped','restarting','pid','phase','missing_id','ml'])
def test_completion_keeps_all_other_guards(change):
    module,api,parent,rows,progress=setup();row=rows[module.WORKER]
    if change=='value':row['Config']['Env'][0]='SECOND=changed'
    elif change=='duplicate':row['Config']['Env'].append('A=B')
    elif change=='resource':row['resources'].append('network-changed')
    elif change=='image':row['Image']=module.BASE_IMAGE
    elif change=='id':row['Id']='unexpected'
    elif change=='stopped':row['State']['Running']=False
    elif change=='restarting':row['State']['Restarting']=True
    elif change=='pid':row['State']['Pid']=0
    elif change=='phase':progress['phase']='built'
    elif change=='missing_id':progress.pop('new_container_id')
    elif change=='ml':rows[module.ML]['Image']='changed'
    with pytest.raises(ValueError):module.validate_live(api,parent,rows,progress)


@pytest.mark.parametrize('env',[['BAD'],['=empty'],['A=1','A=2'],[None]])
def test_invalid_environment_rejected(env):
    with pytest.raises(ValueError):completion.canonical_environment(env)
