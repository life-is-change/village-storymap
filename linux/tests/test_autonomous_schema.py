import sys
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
ROOT=Path(__file__).resolve().parents[2]


def module():
    import autonomous_schema
    return autonomous_schema


def test_schema_bundle_includes_local_auth_and_queues_in_dependency_order():
    m=module();items=m.schema_bundle(ROOT)
    assert list(items)==['identity.sql','catalog.sql','survey.sql','planning.sql','events.sql','files.sql','scene.sql','tasks.sql',
        'local-auth.sql','local-auth-recovery.sql','local-tasks.sql','local-task-files.sql','local-cloud.sql']
    assert 'ensure_local_profile' in items['local-auth.sql']
    assert 'village_unified_login' in items['scene.sql'] and 'village_scene_files_login' not in items['scene.sql']


def test_step_receipt_is_transactional_and_cannot_match_other_sql_or_run_source():
    m=module();sql='BEGIN;\nCREATE TABLE fixture(id int);\nCOMMIT;\n'
    wrapped=m.transactional_step('local-auth.sql',sql)
    assert wrapped.count('BEGIN;')==1 and wrapped.count('COMMIT;')==1
    assert wrapped.index('CREATE TABLE fixture')<wrapped.index('INSERT INTO autonomous_control.installed_steps')<wrapped.index('COMMIT;')
    assert "current_database()<>'village_unified_candidate'" in wrapped
    with pytest.raises(ValueError):m.transactional_step('../source.sql',sql)
    assert m.step_hash(sql)!=m.step_hash(sql+'-- changed\n')


def test_hba_limits_exact_runtime_roles_to_private_compose_subnet():
    m=module();before=m.hba('172.30.0.0/16',migration=True);after=m.hba('172.30.0.0/16',migration=False)
    assert 'village_auth_migrator' in before and 'village_auth_migrator' not in after
    assert 'host village_unified_candidate village_unified_login 172.30.0.0/16 scram-sha-256' in after
    assert after.endswith('host all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n')
    for subnet in ['0.0.0.0/0','8.8.8.0/24','::/0','172.30.0.1/16']:
        with pytest.raises(ValueError):m.hba(subnet,migration=False)


def test_auth_preparation_changes_only_auth_owners_and_requires_separate_safe_passwords():
    m=module();sql=m.auth_owner_sql('a'*48,'b'*48)
    assert "n.nspname='auth'" in sql and 'ALTER SCHEMA auth OWNER TO village_auth_migrator' in sql
    assert 'NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE' in sql
    assert "SET search_path=auth" in sql
    assert 'ALTER ROLE supabase_admin' not in sql and 'ALTER SCHEMA public OWNER' not in sql
    with pytest.raises(ValueError):m.auth_owner_sql("a';secret",'b'*48)
    with pytest.raises(ValueError):m.auth_owner_sql('a'*48,'a'*48)
