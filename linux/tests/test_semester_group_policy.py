from pathlib import Path
import sys
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'linux/scripts'))


def test_semester_policy_replaces_known_functions_and_rejects_source_drift():
    from semester_group_policy import replacements, patch_sql
    changes = {name: (before, after) for name, before, after in replacements(ROOT)}
    ensure = changes['public.ensure_group_plan_space(uuid,uuid,text,uuid)'][1]
    assert 'project_group_eligible(course_group.id, v_project.id)' in ensure
    assert "md5(concat_ws(':', p_teaching_project_id, p_village_id, p_group_id))" in ensure
    assert 'v_group.space_id' not in ensure
    dashboard = changes['public.get_group_plan_admin_dashboard(uuid,uuid)'][1]
    assert 'project_group_eligible(course_group.id, v_project.id)' in dashboard
    for name in ('context_space_mutable','context_space_accessible'):
        body = changes[f'public.{name}(uuid,uuid,text)'][1]
        assert 'project_group_eligible(membership.group_id, project.id)' in body
    sql = patch_sql(ROOT)
    assert 'SEMESTER_GROUP_FUNCTION_CHANGED' in sql
    assert 'BEGIN READ ONLY;' in patch_sql(ROOT, apply=False)
    assert 'CREATE TABLE' not in patch_sql(ROOT, apply=False)
    assert 'DELETE FROM public.group_memberships' not in sql
    assert 'DROP TABLE' not in sql
    assert 'SEMESTER_GROUP_AMBIGUOUS_HISTORY' in sql


def test_schema_contains_real_scope_invariants_and_not_magic_role_assignment():
    schema = (ROOT / 'linux/sql/semester-groups.sql').read_text(encoding='utf-8')
    assert 'semester_membership_unique' in schema
    assert 'semester_progress_unique' in schema
    assert "scope_kind='lab'" in schema
    assert 'SEMESTER_GROUP_AMBIGUOUS_HISTORY' in schema
    assert 'UPDATE public.profiles' not in schema
    assert "scope_kind='semester'" in schema
    assert 'teaching_project_id, student_key, task_id' in schema


def test_personal_results_and_every_plan_creator_are_scoped_by_project():
    from semester_group_policy import replacements
    changes = {name: after for name, _, after in replacements(ROOT)}
    personal = changes['public.ensure_course_personal_space(text,uuid,text,text,text)']
    assert 'ON CONFLICT(owner_id, course_id, teaching_project_id, village_id, space_type)' in personal
    batch = changes['public.ensure_group_plan_spaces_for_snapshot(uuid)']
    assert 'project_group_eligible(course_group.id, v_project.id)' in batch
    assert 'project_group_eligible' in changes['public.is_group_plan_member(text)']
