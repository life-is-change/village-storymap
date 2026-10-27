import copy
import base64
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


def test_completion_reads_current_start_logs_without_tail_limit():
    module=load(ROOT/'linux/releases/component-quality-worker-20261027.py','quality_log_test')
    calls=[]
    class Docker:
        def inspect(self,name):return {'Id':'same-worker'}
        def run(self,*args,**kwargs):
            calls.append((args,kwargs))
            return 'BLENDER_RUNTIME=OK' if '--tail' not in args else ''
    def wait_ready(docker,identifier,**kwargs):
        assert docker.inspect('worker')['Id']==identifier
        assert docker.run('logs','--since','current-start','--tail','100',module.WORKER)=='BLENDER_RUNTIME=OK'
        return 'ready'
    helper=SimpleNamespace(wait_ready=wait_ready)
    module.load_module=lambda path,name:helper
    completion.install_completion_guard(module)
    loaded=module.load_module('helper.py','quality_startup_helper')
    assert loaded.wait_ready(Docker(),'same-worker',timeout=5)=='ready'
    assert calls==[(('logs','--since','current-start',module.WORKER),{})]


@pytest.mark.parametrize('failure',[None,'missing_marker','failed_marker','restarting'])
def test_frozen_startup_wait_preserves_health_and_stability_checks(tmp_path,monkeypatch,failure):
    module=load(ROOT/'linux/releases/component-quality-worker-20261027.py','quality_real_wait_test')
    path=tmp_path/'startup.py'
    path.write_bytes(base64.b64decode(module.unpack()['startup_helper']))
    completion.install_completion_guard(module)
    helper=module.load_module(path,'quality_startup_helper')
    now=[0]
    monkeypatch.setattr(helper.time,'monotonic',lambda:now[0])
    monkeypatch.setattr(helper.time,'sleep',lambda seconds:now.__setitem__(0,now[0]+seconds))
    calls=[]
    class Docker:
        def inspect(self,name):
            return {'Id':'candidate','RestartCount':0,'State':{'Running':True,'Restarting':failure=='restarting',
                     'Pid':123,'StartedAt':'current-start','OOMKilled':False}}
        def run(self,*args,**kwargs):
            calls.append(args)
            assert args==('logs','--since','current-start',module.WORKER)
            logs='BLENDER_RUNTIME=OK\nFACADE_ML=OK\nFACADE_LAMA=OK\nALIYUN_GATEWAY=OK\n'
            if failure=='missing_marker':logs=logs.replace('FACADE_ML=OK','FACADE_ML=FAIL')
            if failure=='failed_marker':logs+='Facade worker health checks failed'
            return logs+'polling\n'*150
    if failure:
        with pytest.raises(ValueError,match='STARTUP_WORKER_NOT_READY'):
            helper.wait_ready(Docker(),'candidate',timeout=14)
    else:
        assert helper.wait_ready(Docker(),'candidate',timeout=14)['Id']=='candidate'
        assert now[0]>=10 and len(calls)>=6
