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
