"""Full migration scope must not silently inherit the old five-bucket filter."""
import sys
from pathlib import Path
import json
import io
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from test_business_storage_copy import module, inventory, Transport


def test_full_scope_copies_old_gpu_exclusions_without_changing_legacy_default(tmp_path):
    m=module();doc=m.validate_inventory(inventory());scope=m.all_inventory_buckets(doc)
    assert scope==frozenset({'scene-assets','geoprocessing-results'})
    root=m.new_run_directory(tmp_path/'full',[])
    m.write_private_json(root/'inventory.json',doc)
    result=m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,
                            transport=Transport(m),selected_buckets=scope)
    assert result['copied']==2 and result['excluded_objects']==0
    assert m.verify_copy(root,selected_buckets=scope)['status']=='private_copy_verified_not_cut_over'
    assert m.inventory_summary(doc)['excluded_objects']==1
    with pytest.raises(ValueError):m.load_transfer(root) # no accidental scope downgrade


def test_full_scope_rejects_unknown_bucket_selection():
    m=module();doc=m.validate_inventory(inventory())
    with pytest.raises(ValueError):m.inventory_summary(doc,selected_buckets={'unknown'})


class Reply(io.BytesIO):
    status=200


def test_source_listing_checks_pagination_nested_objects_and_growth():
    m=module();doc=m.validate_inventory(inventory());requests=[]
    class Opener:
        def open(self,req,timeout):
            requests.append(req)
            if req.full_url.endswith('/bucket'):
                return Reply(json.dumps([{'id':b['id']} for b in doc['buckets']]).encode())
            body=json.loads(req.data);bucket=req.full_url.rsplit('/',1)[-1]
            if body['prefix']=='':return Reply(json.dumps([{'id':None,'name':'nested'}]).encode())
            obj=next(o for o in doc['objects'] if o['bucket']==bucket)
            return Reply(json.dumps([{'id':obj['id'],'name':'extra.glb'}]).encode())
    transport=m.SourceTransport('sb_secret_'+'a'*40,opener=Opener(),selected_buckets=m.all_inventory_buckets(doc))
    with pytest.raises(ValueError,match='SOURCE_INVENTORY_CHANGED'):
        transport.verify_inventory(doc)
    assert all(req.full_url.startswith(m.ORIGIN+'/storage/v1/') for req in requests)
    assert any(req.data and json.loads(req.data)['prefix']=='nested/' for req in requests)


def test_full_copy_requires_remote_inventory_preflight_before_downloading(tmp_path):
    m=module();doc=m.validate_inventory(inventory());root=m.new_run_directory(tmp_path/'full',[])
    m.write_private_json(root/'inventory.json',doc)
    class Changed(Transport):
        def verify_inventory(self,doc):raise ValueError('SOURCE_INVENTORY_CHANGED')
    t=Changed(m)
    with pytest.raises(ValueError,match='SOURCE_INVENTORY_CHANGED'):
        m.copy_inventory(root/'inventory.json',root,'sb_secret_'+'a'*40,transport=t,
                         selected_buckets=m.all_inventory_buckets(doc),check_source_inventory=True)
    assert t.gets==0


def test_source_listing_accepts_exact_inventory_and_rejects_duplicate_or_unbounded_tree():
    m=module();doc=m.validate_inventory(inventory())
    class Opener:
        duplicate=False
        def open(self,req,timeout):
            if req.full_url.endswith('/bucket'):data=[{'id':b['id']} for b in doc['buckets']]
            else:
                body=json.loads(req.data);bucket=req.full_url.rsplit('/',1)[-1]
                obj=next(o for o in doc['objects'] if o['bucket']==bucket)
                parts=obj['name'].split('/');prefix=body['prefix'];index=len(prefix.rstrip('/').split('/')) if prefix else 0
                data=[{'name':parts[index],'id':obj['id'] if index==len(parts)-1 else None}]
                if self.duplicate:data=data*2
            return Reply(json.dumps(data).encode())
    opener=Opener();t=m.SourceTransport('sb_secret_'+'a'*40,opener=opener,selected_buckets=m.all_inventory_buckets(doc))
    assert t.verify_inventory(doc)=={'buckets':2,'objects':2}
    opener.duplicate=True
    with pytest.raises(ValueError):t.verify_inventory(doc)
