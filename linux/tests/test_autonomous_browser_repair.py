import importlib.util
from pathlib import Path
import sys
import pytest
S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    spec=importlib.util.spec_from_file_location('browser_repair',S/'repair-autonomous-browser.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_photo_patch_accepts_only_attested_old_function_bodies_and_changes_no_business_rows():
    m=module()
    original="CREATE FUNCTION api_private.catalog_read(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN x.created_at;SELECT id,student_id,display_name,role,gender,class_name,grade,disabled_at FROM public.profiles;END$$;"
    survey="CREATE FUNCTION api_private.survey_read(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN x.created_at;END$$;"
    sql=m.photo_sql(original,survey)
    assert 'pg_get_functiondef' in sql and 'prosrc' in sql
    assert 'PHOTO_FUNCTION_CHANGED' in sql and 'uploaded_at' in sql
    assert not any(term in sql for term in ('ALTER TABLE','UPDATE public.','DELETE FROM','INSERT INTO public.','GRANT '))
    assert 'AS created_at,disabled_at' in sql


def test_web_overlay_changes_only_fixed_mounts_and_preserves_all_other_services(tmp_path):
    import copy
    m=module();base={'services':{'web':{'ports':['80:8080'],'volumes':[{'target':'/srv/village-web','source':'/original','read_only':True}]},'api':{'image':'fixed'},'postgres':{'volumes':['original-data']}}}
    before=copy.deepcopy(base)
    changed=m.overlay_compose(base,tmp_path,original_source='/original')
    assert base==before
    assert changed['services']['api']==before['services']['api']
    assert changed['services']['postgres']==before['services']['postgres']
    mounts=changed['services']['web']['volumes']
    assert mounts[0]['target']==before['services']['web']['volumes'][0]['target']
    assert mounts[0]['source']==str(tmp_path/'web')
    assert len(mounts)==1
    assert all(v['read_only'] for v in mounts)
    with pytest.raises(ValueError):m.overlay_compose(changed,tmp_path/'another',original_source='/original')


def test_photo_authorization_patch_only_targets_registered_photo_files():
    m=module()
    source='CREATE FUNCTION api_private.file_legacy(fid uuid) RETURNS jsonb AS $$'+m.LEGACY_PHOTO_GATE+'$$;\nCREATE FUNCTION api_private.file_authorize(fid uuid) RETURNS jsonb AS $$'+m.LEGACY_LOCAL_GATE+'$$;'
    sql=m.file_sql(source)
    assert "s.purpose=''photo''" in sql
    assert 'p.file_id=f.id AND p.photo_path=f.logical_path' in sql
    assert 'PHOTO_AUTHORIZATION_CHANGED' in sql
    assert 'GRANT ' not in sql and 'ALTER TABLE' not in sql


def test_upgrade_requires_exact_prior_overlay_receipt_and_file_tree(tmp_path):
    m=module();root=tmp_path/'files'/m.PREVIOUS_PATCH;root.mkdir(parents=True,mode=0o700)
    (root/'web').mkdir(mode=0o700);(root/'web/index.html').write_bytes(b'original overlay')
    manifest={'features/villages/village-client.js':'a'*64,'admin.js':'b'*64,'app-3d.js':'c'*64}
    meta={'releaseId':'test-release'}
    m.storage.write_private_json(root/'receipt.json',{'releaseId':'test-release','files':{'features/villages/village-client.js':'a'*64},'sql_sha256':'d'*64,'phase':'served_verified_browser_login_pending'})
    m.storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':m.tree_digest(root/'web')})
    assert m.previous_overlay(tmp_path,meta,manifest,'d'*64)==root/'web'
    (root/'web/index.html').write_bytes(b'changed')
    with pytest.raises(ValueError,match='PREVIOUS_BROWSER_PATCH_CHANGED'):m.previous_overlay(tmp_path,meta,manifest,'d'*64)
