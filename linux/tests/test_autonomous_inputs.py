import importlib.util
from pathlib import Path
import sys
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'prepare-autonomous-inputs.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('autonomous_inputs_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_full_index_requires_every_record_not_just_selected_business_buckets(tmp_path):
    m=module()
    from test_business_storage_copy import inventory,Transport
    s=m.storage;root=s.new_run_directory(tmp_path/'inputs',[]);doc=s.validate_inventory(inventory());s.write_private_json(root/'inventory.json',doc)
    with pytest.raises(ValueError):m.build_index(root)
    s.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(s),selected_buckets=s.all_inventory_buckets(doc))
    result=m.build_index(root)
    assert len(result['objects'])==2 and result['source_archive_sha256']=='a'*64
    assert {o['bucket'] for o in result['objects']}=={'scene-assets','geoprocessing-results'}
    manifest=s.read_private_json(root/'copy-manifest.json');manifest['records']['object-2']['status']='source_changed';s.write_private_json(root/'copy-manifest.json',manifest)
    with pytest.raises(ValueError):m.build_index(root)


def test_resume_inputs_refuses_swapping_snapshot_or_auth_report(tmp_path):
    m=module()
    from test_business_storage_copy import inventory
    root=tmp_path/'full';doc=inventory();auth={'users':4,'target_version':'v2.197.0'}
    m.initialize_inputs(root,doc,auth)
    assert m.initialize_inputs(root,doc,auth)==root
    with pytest.raises(ValueError):m.initialize_inputs(root,{**doc,'generated_at':'changed'},auth)
    with pytest.raises(ValueError):m.initialize_inputs(root,doc,{**auth,'users':5})


def test_full_index_loads_receipts_only_under_one_exclusive_lock(tmp_path,monkeypatch):
    m=module()
    from test_business_storage_copy import inventory,Transport
    s=m.storage;root=s.new_run_directory(tmp_path/'inputs',[]);doc=s.validate_inventory(inventory());s.write_private_json(root/'inventory.json',doc)
    s.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,Transport(s),selected_buckets=s.all_inventory_buckets(doc))
    original=s.load_transfer
    def guarded(*args,**kwargs):
        assert (root/'.transfer.lock').is_file()
        return original(*args,**kwargs)
    monkeypatch.setattr(s,'load_transfer',guarded)
    assert len(m.build_index(root)['objects'])==2


def test_frozen_control_helpers_do_not_treat_entire_operator_home_as_repository(tmp_path,monkeypatch):
    from test_business_storage_copy import module as storage_module,inventory
    s=storage_module();root=s.new_run_directory(tmp_path/'inputs',[]);s.write_private_json(root/'inventory.json',inventory())
    monkeypatch.setattr(s,'__file__',str(tmp_path/'state/control/business_storage_copy.py'))
    assert s.load_transfer(root)[0]['project_ref']==s.PROJECT
