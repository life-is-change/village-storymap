import importlib.util
from pathlib import Path
import sys
import pytest
S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    spec=importlib.util.spec_from_file_location('task_lock_repair',S/'repair-autonomous-task-locks.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_lock_patch_only_accepts_exact_bodies_and_retains_previous_geo_mapping():
    from task_lock_order import body_pair,patch_sql,browser
    root=S.parents[1]
    for name,file in [('local_worker_call','local-tasks.sql'),('local_worker_file','local-task-files.sql')]:
        source=(root/'linux/sql'/file).read_text(encoding='utf8');before,after=body_pair(source,name)
        assert after==browser.function_body(source,name)
        legacy=source.replace(after,before)
        assert body_pair(legacy,name)==(before,after)
        assert after.index('PERFORM 1 FROM api_private.task_requests WHERE id=rid')<after.index('SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid')
        if name=='local_worker_file':assert "THEN 'roads_water'" in before and "THEN 'roads_water'" in after
    queue=(root/'linux/sql/local-tasks.sql').read_text();files=(root/'linux/sql/local-task-files.sql').read_text()
    sql=patch_sql(queue,files);assert 'TASK_LOCK_FUNCTION_CHANGED' in sql and 'GRANT ' not in sql
    assert 'EXECUTE' not in patch_sql(queue,files,apply=False)


def test_private_previous_geo_overlay_never_accepts_an_unrecorded_app_change(tmp_path):
    m=module();geo=m.geo;browser=m.browser;data=browser.inputs(S.parents[1]);meta={'releaseId':'fixture'}
    v3=tmp_path/'files'/browser.PATCH;v3.mkdir(parents=True,mode=0o700);(v3/'web').mkdir(mode=0o700)
    manifest={k:m.digest(v) for k,v in data.items()}
    for name,value in data.items():
        p=v3/'web'/name;p.parent.mkdir(parents=True,mode=0o700,exist_ok=True);p.write_bytes(value);p.chmod(0o600)
    m.storage.write_private_json(v3/'receipt.json',{'releaseId':'fixture','files':manifest,'sql_sha256':'a'*64,'phase':'served_verified_browser_login_pending'})
    m.storage.write_private_json(v3/'overlay-proof.json',{'tree_sha256':m.tree_digest(v3/'web')})
    root=tmp_path/'files'/geo.PATCH;root.mkdir(parents=True,mode=0o700);web=root/'web';web.mkdir(mode=0o700)
    p=web/'app.js';p.write_bytes(data['app.js']);p.chmod(0o600)
    m.storage.write_private_json(root/'receipt.json',{'releaseId':'fixture','files':{'app.js':m.digest(data['app.js'])},'sql_sha256':'b'*64,'source_web':str(v3/'web'),'phase':'served_verified_browser_login_pending'})
    m.storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':m.tree_digest(web)})
    hashes={browser.PATCH:'a'*64,geo.PATCH:'b'*64}
    assert m.verify_previous(tmp_path,meta,data,hashes,web)==web
    p.write_text('unrecorded mutation')
    with pytest.raises(ValueError):m.verify_previous(tmp_path,meta,data,hashes,web)
