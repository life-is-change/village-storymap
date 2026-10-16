import copy
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import pytest

S=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(S))

def module():
    path=S/'business_storage_copy.py'
    assert path.is_file(), 'Storage copy module missing'
    spec=importlib.util.spec_from_file_location('storage_copy_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def inventory():
    return {'version':1,'project_ref':'rzmbmwauomzwiyenafha','source_archive_sha256':'a'*64,
            'generated_at':'2026-10-16T00:00:00+00:00','buckets':[{'id':'scene-assets','public':False},{'id':'geoprocessing-results','public':False}],
            'objects':[{'id':'object-1','bucket':'scene-assets','name':'空间/模型 1%.glb','snapshot_updated_at':'2026-10-01', 'declared_size':3,'snapshot_etag':None,'snapshot_version':None},
                       {'id':'object-2','bucket':'geoprocessing-results','name':'gpu/file','snapshot_updated_at':'2026-10-01','declared_size':None,'snapshot_etag':None,'snapshot_version':None}]}

def test_inventory_classification_and_summary_does_not_expose_object_paths():
    m=module();doc=m.validate_inventory(inventory());summary=m.inventory_summary(doc)
    assert summary['selected_objects']==1 and summary['excluded_objects']==1
    assert summary['known_bytes']==3 and summary['unknown_sizes']==0
    assert '空间' not in json.dumps(summary,ensure_ascii=False)
    assert m.SELECTED_BUCKETS=={'house-photos','scene-assets','scene-version-previews','group-models','village-datasets'}

@pytest.mark.parametrize('change', ['project','duplicate','size','bool_size','path','bucket','unknown_bucket'])
def test_inventory_rejects_malformed_or_ambiguous_input(change):
    m=module();doc=inventory()
    if change=='project':doc['project_ref']='other-project'
    if change=='duplicate':doc['objects'].append(copy.deepcopy(doc['objects'][0]))
    if change=='size':doc['objects'][0]['declared_size']=-1
    if change=='bool_size':doc['objects'][0]['declared_size']=True
    if change=='path':doc['objects'][0]['name']='../secret'
    if change=='bucket':doc['buckets'][0]['id']='../bucket'
    if change=='unknown_bucket':doc['objects'][0]['bucket']='missing-bucket'
    with pytest.raises(ValueError):m.validate_inventory(doc)

def test_inventory_empty_and_unknown_sizes():
    m=module();doc=inventory();doc['objects']=[]
    assert m.inventory_summary(m.validate_inventory(doc))['selected_objects']==0
    doc=inventory();doc['objects'][0]['declared_size']=None
    assert m.inventory_summary(m.validate_inventory(doc))['unknown_sizes']==1

def test_private_run_creation_refuses_web_overlap_and_existing_directory(tmp_path):
    m=module();web=tmp_path/'web';web.mkdir()
    with pytest.raises(ValueError):m.new_run_directory(web/'private',[web])
    run=tmp_path/'run';m.new_run_directory(run,[web])
    with pytest.raises(ValueError):m.new_run_directory(run,[web])
    m.write_private_json(run/'inventory.json',inventory())
    assert m.read_private_json(run/'inventory.json')['project_ref']=='rzmbmwauomzwiyenafha'

@pytest.mark.parametrize('accepted',[True,False])
def test_export_inventory_requires_matching_acceptance_and_keeps_private_rows(tmp_path,accepted):
    m=module();state=m.new_run_directory(tmp_path/'candidate',[]);backup=tmp_path/'backup'
    for name,doc in [('deployment-checkpoint.json',{'source_archive_sha256':'a'*64}),
        ('runtime-compose.json',{'services':{'db':{'volumes':[{'source':str(backup)}]}}}),
        ('candidate-verification.json',{'status':'permissions_restart_verified','runtime_fingerprint':'fp','source_archive_sha256':'a'*64,'attempt_id':'same'}),
        ('api-acceptance.json',{'status':'internal_validated_not_cut_over' if accepted else 'invalid','verification_attempt_id':'same'})]:
        m.write_private_json(state/name,doc)
    source=inventory();source['objects'][0]['declared_size']='3'
    class Docker:
        def exec(self,*args,input):
            assert args[:2]==('psql','-X') and 'BEGIN READ ONLY;' in input
            return json.dumps({'buckets':source['buckets'],'objects':source['objects']})
    deploy=SimpleNamespace(private_file=m.private_path,runtime_fingerprint=lambda *a:'fp',ROOT=tmp_path/'repo',rd=SimpleNamespace(ADMIN='fixture-admin',DATABASE='fixture-db'))
    target=tmp_path/'transfer'
    if accepted:
        summary=m.export_inventory(Docker(),state,target,deploy)
        assert summary['selected_objects']==1
        assert m.read_private_json(target/'inventory.json')['objects'][0]['name']=='空间/模型 1%.glb'
    else:
        with pytest.raises(ValueError):m.export_inventory(Docker(),state,target,deploy)
        assert not target.exists()
