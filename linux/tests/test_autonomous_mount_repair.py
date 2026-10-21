import json,hashlib,sys,importlib.util,contextlib
from pathlib import Path
from types import SimpleNamespace
import pytest
S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))

def module():
    p=S/'repair-autonomous-candidate-order.py';assert p.is_file()
    spec=importlib.util.spec_from_file_location('mount_order_repair_test',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def fixture(tmp_path,monkeypatch):
    from test_autonomous_operator import baseline
    from autonomous_operator import OLD_CANDIDATES,stop_receipt
    from autonomous_extract import tree_digest
    m=module();root=tmp_path/'state';root.mkdir(mode=0o700)
    for n in ('data','control'): (root/n).mkdir(mode=0o700)
    release=root/'releases/autonomous-fixture';release.mkdir(parents=True,mode=0o700)
    for n in ('web','schema','control'):(release/n).mkdir(mode=0o700)
    digests={n:tree_digest(release/n) for n in ('web','schema','control')}
    meta={'releaseId':'autonomous-fixture','archive_sha256':'a'*64,'static_sha256':digests['web'],'schema_sha256':digests['schema'],'control_sha256':digests['control']}
    identity={'releaseId':meta['releaseId'],'archive_sha256':meta['archive_sha256'],'source_archive_sha256':'b'*64,'storage_inventory_sha256':'c'*64}
    objects={};receipts=[]
    for name,(project,service) in OLD_CANDIDATES.items():
        obj=baseline(name,'sha256:'+'a'*64,project,service);obj['Id']=hashlib.sha256(name.encode()).hexdigest()
        obj['Mounts']=[{'Source':'/private/a','Destination':'/run/a','RW':False},{'Source':'/private/b','Destination':'/run/b','RW':True}]
        row=stop_receipt(obj);mounts=[{'source':v['Source'],'target':v['Destination'],'rw':v['RW']} for v in reversed(obj['Mounts'])]
        row['mounts_sha256']=hashlib.sha256(json.dumps(mounts,sort_keys=True).encode()).hexdigest();receipts.append(row);objects[name]=obj
    saved={'candidates':receipts}
    docs={'initial-baseline.json':saved,'inputs.json':{'archive':'archive','backup':'backup','storage':'storage'},'autonomous-checkpoints.json':{'version':1,'identity':identity,'nonce':'fixture','steps':{'release':{'status':'done','receipt':digests},'old-candidates-stopped':{'status':'pending'}}}}
    for name,doc in docs.items():m.storage.write_private_json(root/name,doc)
    calls=[]
    class Docker:
        def inspect(self,name):return objects[name]
        def run(self,*args):
            calls.append(args)
            if args[0]=='ps':return ''
            assert args[0]=='stop'
            obj=next(o for o in objects.values() if o['Id']==args[-1]);obj['State']['Running']=False;return ''
    from autonomous_bundle import load_script
    actual=load_script('deploy-autonomous')
    deploy=SimpleNamespace(read_meta=lambda:meta,check=lambda *args,**kwargs:{'source_archive_sha256':'b'*64,'storage_inventory_sha256':'c'*64,'baseline':saved},stop_old_candidates=actual.stop_old_candidates)
    monkeypatch.setattr(m,'load_script',lambda name:deploy)
    if sys.platform!='linux':monkeypatch.setattr(m,'operation_lock',lambda state:contextlib.nullcontext())
    return m,root,Docker(),objects,calls

def test_repair_retains_original_baseline_and_completes_only_proven_stop_step(tmp_path,monkeypatch):
    m,root,docker,objects,calls=fixture(tmp_path,monkeypatch);before=(root/'initial-baseline.json').read_bytes()
    m.repair(root,docker=docker)
    assert (root/'initial-baseline.json').read_bytes()==before
    steps=json.loads((root/'autonomous-checkpoints.json').read_text())['steps']
    assert set(steps)=={'release','old-candidates-stopped'} and steps['old-candidates-stopped']['status']=='done'
    assert all(not o['State']['Running'] for o in objects.values())
    assert len([a for a in calls if a[0]=='stop'])==5
    assert not (root/'release.json').exists() and not list((root/'data').iterdir())

@pytest.mark.parametrize('change',['mount','checkpoint','control','database'])
def test_repair_refuses_unproven_changes_before_stopping_anything(tmp_path,monkeypatch,change):
    m,root,docker,objects,calls=fixture(tmp_path,monkeypatch)
    if change=='mount':next(iter(objects.values()))['Mounts'][0]['RW']=True
    elif change=='checkpoint':
        p=root/'autonomous-checkpoints.json';doc=json.loads(p.read_text());doc['steps']['postgres']={'status':'pending'};m.storage.write_private_json(p,doc)
    elif change=='control':(root/'control/changed').write_text('unexpected')
    elif change=='database':(root/'data/PG_VERSION').write_text('17')
    with pytest.raises(ValueError):m.repair(root,docker=docker)
    assert not [a for a in calls if a[0]=='stop']
