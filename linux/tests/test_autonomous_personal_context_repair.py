import importlib.util
from pathlib import Path
import sys
import pytest

S=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(S))

def module():
    p=S/'repair-autonomous-personal-context.py'
    assert p.is_file(), 'missing safe repair for legacy personal-space schema'
    spec=importlib.util.spec_from_file_location('personal_context_repair',p)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def valid_steps():
    m=module()
    return {**{n:{'status':'done'} for n in m.REQUIRED},'schema-files':{'status':'pending'}}

def test_requires_exact_pending_files_phase_before_any_sql():
    m=module();steps=valid_steps();m.validate_steps(steps)
    for key in ['restore','auth-migrations','schema-planning']:
        altered={**steps,key:{'status':'pending'}}
        with pytest.raises(ValueError):m.validate_steps(altered)
    with pytest.raises(ValueError):m.validate_steps({**steps,'schema-scene':{'status':'done'}})
    with pytest.raises(ValueError):m.validate_steps({**steps,'schema-files':{'status':'done'}})

def test_compatibility_retains_source_rows_and_requires_absent_columns_and_overload():
    m=module();sql=m.compatibility_sql()
    assert 'ADD COLUMN teaching_project_id uuid REFERENCES public.teaching_projects(id) ON DELETE RESTRICT' in sql
    assert 'ADD COLUMN context_space_type text' in sql
    assert 'PERSONAL_SOURCE_ROWS_CHANGED' in sql
    assert 'LEGACY_PERSONAL_SCHEMA_REQUIRED' in sql
    assert 'autonomous_control.personal_context_compat' in sql
    assert "current_database()<>'village_unified_candidate'" in sql
    assert 'UPDATE public.course_personal_spaces SET' not in sql
    assert 'ON CONFLICT(owner_id, course_id, village_id, space_type)' in sql
    assert 'PERSONAL_SPACE_PROJECT_CONFLICT' in sql
    assert 'FROM PUBLIC, anon, authenticated' in sql
    assert 'GRANT EXECUTE' not in sql
