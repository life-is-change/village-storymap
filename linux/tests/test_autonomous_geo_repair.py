import importlib.util
from pathlib import Path
import sys
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    spec=importlib.util.spec_from_file_location('geo_repair',S/'repair-autonomous-geo-results.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_geo_patch_attests_only_two_existing_function_bodies_and_retains_permission_gates():
    m=module();root=S.parents[1]
    sql=m.patch_sql((root/'linux/sql/local-tasks.sql').read_text(),(root/'linux/sql/local-task-files.sql').read_text())
    assert 'local_worker_file(uuid,text,text,text,uuid,uuid,jsonb)' in sql
    assert 'local_gpu_outputs_ready(api_private.local_gpu_runs)' in sql
    assert 'GEO_RESULT_FUNCTION_CHANGED' in sql and 'pg_get_functiondef' in sql
    assert 'roads_water' in sql and 'local_gpu_guard(r)' in sql and 'LEASE_LOST' in sql
    assert not any(v in sql for v in ['UPDATE api_private.local_gpu_runs','GRANT ', 'ALTER TABLE', 'DELETE FROM'])
    check=m.patch_sql((root/'linux/sql/local-tasks.sql').read_text(),(root/'linux/sql/local-task-files.sql').read_text(),apply=False)
    assert 'EXECUTE' not in check


def test_known_prior_browser_overlay_is_attested_before_copying_and_never_modified(tmp_path):
    m=module();old=m.browser;source=S.parents[1];data=old.inputs(source)
    root=tmp_path/'files'/old.PATCH;root.mkdir(parents=True,mode=0o700)
    web=root/'web';web.mkdir(mode=0o700)
    for name,value in data.items():
        path=web/name;path.parent.mkdir(parents=True,mode=0o700,exist_ok=True);path.write_bytes(value);path.chmod(0o600)
    meta={'releaseId':'fixture'};manifest={k:m.digest(v) for k,v in data.items()}
    old.storage.write_private_json(root/'receipt.json',{'releaseId':'fixture','files':manifest,'sql_sha256':'a'*64,'phase':'served_verified_browser_login_pending'})
    old.storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':old.tree_digest(web)})
    assert m.verify_previous(tmp_path,meta,data,{old.PATCH:'a'*64},web)==web
    (web/'app.js').write_text('unexpected change')
    with pytest.raises(ValueError,match='PREVIOUS_BROWSER_PATCH_CHANGED'):
        m.verify_previous(tmp_path,meta,data,{old.PATCH:'a'*64},web)
