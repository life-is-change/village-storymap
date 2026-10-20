import importlib.util
import json
from pathlib import Path
import pytest

ROOT=Path(__file__).resolve().parents[2]
def module():
    path=ROOT/'linux/scripts/prepare-local-auth.py'
    assert path.is_file(), 'Local Auth compatibility inspector is missing'
    spec=importlib.util.spec_from_file_location('local_auth',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def snapshot(*,provider='email',student_email='sid-332@rzmbmwauomzwiyenafha.supabase.co',factor=None,version='20260831180000',password=None):
    hashed=password if password is not None else '$2b$10$'+'A'*53
    text=f'COPY auth.users (id, email, encrypted_password, phone, is_anonymous) FROM stdin;\nuuid\t{student_email}\t{hashed}\t\\N\tf\n\\.\n'
    text+=f'COPY auth.identities (provider) FROM stdin;\n{provider}\n\\.\nCOPY auth.schema_migrations (version) FROM stdin;\n{version}\n\\.\n'
    if factor:text+='COPY auth.mfa_factors (factor_type, status) FROM stdin;\n'+factor+'\tverified\n\\.\n'
    return text.splitlines()

def test_password_snapshot_inspection_only_emits_counts_and_version_not_users_or_hashes():
    m=module();report=m.summarize_auth_copy(snapshot())
    assert report['status']=='compatible_password_accounts_not_login_verified'
    assert report['users']==1 and report['password_users']==1
    assert report['maximum_migration']=='20260831180000'
    assert '332' not in json.dumps(report) and '$2' not in json.dumps(report)

@pytest.mark.parametrize('patch',[
    {'provider':'google'},{'factor':'totp'},{'student_email':'other@example.com'},
    {'version':'20991231235959'},{'password':'plaintext-never-print'},
])
def test_unsupported_identity_or_schema_stops_without_exposing_sensitive_values(patch):
    m=module()
    with pytest.raises(ValueError,match='AUTH_') as raised:m.summarize_auth_copy(snapshot(**patch))
    assert all(value not in str(raised.value) for value in patch.values())

def test_truncated_or_missing_copy_and_missing_migrations_fail_closed():
    m=module()
    for lines in [[],['COPY auth.users (email) FROM stdin;','secret'],snapshot()[:-3]]:
        with pytest.raises(ValueError,match='AUTH_'):m.summarize_auth_copy(lines)

def test_runtime_environment_has_fixed_origin_bounded_pool_and_no_provider_credentials():
    m=module();env=m.auth_environment('postgresql://village_auth_runtime:synthetic-password@postgres:5432/village_unified_candidate','s'*64)
    assert env['GOTRUE_SITE_URL']=='https://8.148.248.237'
    assert env['GOTRUE_JWT_ISSUER']=='https://8.148.248.237/auth/v1'
    assert env['GOTRUE_DB_MAX_POOL_SIZE']=='2' and env['GOTRUE_DB_MAX_IDLE_POOL_SIZE']=='1'
    assert env['GOTRUE_EXTERNAL_EMAIL_ENABLED']=='true' and env['GOTRUE_MAILER_AUTOCONFIRM']=='true'
    assert env['GOTRUE_EXTERNAL_PHONE_ENABLED']=='false' and env['GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED']=='false'
    with pytest.raises(ValueError):m.auth_environment('postgresql://postgres:secret@evil/postgres','s'*64)
