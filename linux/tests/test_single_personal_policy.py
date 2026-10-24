from pathlib import Path
import sys
S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))
ROOT=S.parents[1]


def test_policy_patch_is_compare_and_swap_and_additive_without_wiping_existing_personal_results():
    from single_personal_policy import patch_sql
    sql=patch_sql(ROOT)
    assert 'SINGLE_PERSONAL_FUNCTION_CHANGED' in sql
    assert "BEGIN READ ONLY;" in patch_sql(ROOT,apply=False)
    assert 'DELETE FROM public.course_personal_spaces' not in sql
    assert 'DROP TABLE' not in sql
    assert 'experience_space_id' in sql and 'applied_result_versions' in sql
    from single_personal_policy import replacements
    after=dict((name,body) for name,_,body in replacements(ROOT))
    assert 'JOIN public.course_groups enrolled' in after['public.context_space_mutable(uuid,uuid,text)']
    assert "public.current_profile_role()='admin'" in after['public.context_space_mutable(uuid,uuid,text)']


def test_fixed_shared_access_expression_keeps_balanced_grouping():
    import re
    from single_personal_policy import replacements
    for name,_,body in replacements(ROOT):
        clean=re.sub("'([^']|'')*'",'',body)
        assert clean.count('(')==clean.count(')'),name


def test_previous_workspace_receipt_uses_post_repair_geometry_digest():
    import hashlib,json
    from autonomous_bundle import load_script
    repair=load_script('repair-autonomous-single-personal')
    expected={'app.js':repair.BASELINE['app.js'],'features/map-editing/geometry-editor.js':hashlib.sha256((ROOT/'features/map-editing/geometry-editor.js').read_bytes().replace(b'\r\n',b'\n')).hexdigest()}
    assert repair.PREVIOUS_WORKSPACE_FILES==expected
    assert expected['features/map-editing/geometry-editor.js']!=repair.workspace.BASELINE['features/map-editing/geometry-editor.js']


def test_only_confirmed_legacy_selection_crlf_body_is_accepted_exactly():
    import hashlib
    from single_personal_policy import original_bodies,replacements,patch_sql
    selection='public.set_personal_layer_version(uuid,text,uuid)'
    for signature,before,after in replacements(ROOT):
        accepted=original_bodies(signature,before)
        assert before in accepted
        if signature==selection:
            legacy=before.replace('\n','\r\n')
            assert hashlib.sha256(legacy.encode()).hexdigest()=='ef3ff2da00e768f054f0b0ff8036ef7b670456ed3ad2b9bd50d6b28822a68144'
            assert accepted==(before,legacy)
            assert legacy+'\r\n-- unknown' not in accepted
            for apply in (False,True):
                assert "'"+legacy.replace("'","''")+"'" in patch_sql(ROOT,apply=apply)
        else:
            assert accepted==(before,)
