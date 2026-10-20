"""Inspect a verified archive offline. Never print credentials or user rows."""
from pathlib import Path
import argparse
import importlib.util
import json
import re
import subprocess
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[2]
COPY=re.compile(r'^COPY auth\."?([a-z_]+)"? \(([^)]+)\) FROM stdin;$')
TABLES=('users','identities','mfa_factors','schema_migrations','oauth_clients','sso_providers','sso_domains','passkeys')

def runtime_manifest():
    return json.loads((ROOT/'linux/auth-runtime.json').read_text(encoding='utf-8'))

def summarize_auth_copy(lines):
    runtime=runtime_manifest();known=set(runtime['migration_versions']+runtime['legacy_migration_versions'])
    versions=set();counts={name:0 for name in TABLES};passwords=0;table=None;columns=None;seen=set()
    for raw in lines:
        if len(raw)>1024*1024:raise ValueError('AUTH_RECORD_TOO_LARGE')
        line=raw.rstrip('\r\n')
        if table is None:
            match=COPY.fullmatch(line)
            if match:
                table=match[1];columns=[s.strip().strip('"') for s in match[2].split(',')]
                if table not in TABLES or table in seen or len(set(columns))!=len(columns):raise ValueError('AUTH_COPY_FORMAT_UNSUPPORTED')
                seen.add(table)
            continue
        if line==r'\.':table=None;continue
        values=line.split('\t')
        if len(values)!=len(columns):raise ValueError('AUTH_COPY_FORMAT_UNSUPPORTED')
        row=dict(zip(columns,values));counts[table]+=1
        if table=='schema_migrations':
            version=row.get('version')
            if version not in known:raise ValueError('AUTH_SCHEMA_VERSION_UNSUPPORTED')
            versions.add(version)
        elif table=='users':
            if not {'email','encrypted_password','phone','is_anonymous'}.issubset(row):raise ValueError('AUTH_USER_SCHEMA_UNSUPPORTED')
            if not re.fullmatch(r'sid-[a-z0-9_-]{2,32}@rzmbmwauomzwiyenafha\.supabase\.co',row['email']) or row['phone'] not in ('',r'\N') or row['is_anonymous']!='f':raise ValueError('AUTH_IDENTITY_FEATURE_UNSUPPORTED')
            if not re.fullmatch(r'\$2[aby]\$(?:0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}',row['encrypted_password']):raise ValueError('AUTH_PASSWORD_FORMAT_UNSUPPORTED')
            passwords+=1
        elif table=='identities':
            if row.get('provider')!='email':raise ValueError('AUTH_PROVIDER_UNSUPPORTED')
        else:raise ValueError('AUTH_IDENTITY_FEATURE_UNSUPPORTED')
    if table is not None or not {'users','identities','schema_migrations'}.issubset(seen) or not versions or counts['users']<1 or counts['identities']!=counts['users']:raise ValueError('AUTH_INCOMPLETE_SNAPSHOT')
    return {'status':'compatible_password_accounts_not_login_verified','users':counts['users'],'password_users':passwords,
            'identity_records':counts['identities'],'maximum_migration':max(versions),'migration_count':len(versions),
            'pending_migrations':sorted(set(runtime['migration_versions'])-versions),
            'unsupported_features':0,'target_version':runtime['version']}

def inspect_auth_snapshot(backup_dir,pg_bin):
    spec=importlib.util.spec_from_file_location('restore_db_copy',Path(__file__).with_name('restore-db-copy.py'))
    restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)
    backup=Path(backup_dir);restore.verify_backup(backup)
    executable=Path(pg_bin)/('pg_restore.exe' if __import__('os').name=='nt' else 'pg_restore')
    command=[str(executable),'--data-only','--no-owner','--no-privileges','--schema=auth','--file=-',*[f'--table={table}' for table in TABLES],str(backup/'database.dump')]
    # pg_restore never contacts PostgreSQL here. Stream the selected COPY data;
    # password hashes exist briefly in memory and are neither retained nor logged.
    process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8')
    try:
        result=summarize_auth_copy(process.stdout)
        if process.wait(timeout=30)!=0:raise ValueError('AUTH_ARCHIVE_DECODE_FAILED')
        return result
    finally:
        if process.poll() is None:process.kill()
        process.wait();process.stdout.close()

def auth_environment(database_url,jwt_secret):
    url=urlsplit(database_url)
    if url.scheme!='postgresql' or url.hostname!='postgres' or url.port!=5432 or url.username!='village_auth_runtime' or url.path!='/village_unified_candidate' or url.query or url.fragment or not url.password or len(jwt_secret)<48 or len(jwt_secret)>128 or re.search(r'\s',jwt_secret):raise ValueError('AUTH_CONFIGURATION_INVALID')
    return {'GOTRUE_API_HOST':'0.0.0.0','GOTRUE_API_PORT':'9999','API_EXTERNAL_URL':'https://8.148.248.237/auth/v1',
            'GOTRUE_SITE_URL':'https://8.148.248.237','GOTRUE_URI_ALLOW_LIST':'https://8.148.248.237',
            'GOTRUE_DB_DRIVER':'postgres','GOTRUE_DB_DATABASE_URL':database_url,'GOTRUE_DB_NAMESPACE':'auth',
            'GOTRUE_DB_MAX_POOL_SIZE':'2','GOTRUE_DB_MAX_IDLE_POOL_SIZE':'1','GOTRUE_DB_CLEANUP_ENABLED':'false',
            'GOTRUE_JWT_SECRET':jwt_secret,'GOTRUE_JWT_ISSUER':'https://8.148.248.237/auth/v1','GOTRUE_JWT_AUD':'authenticated',
            'GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated','GOTRUE_JWT_ADMIN_ROLES':'service_role','GOTRUE_JWT_EXP':'900',
            'GOTRUE_EXTERNAL_EMAIL_ENABLED':'true','GOTRUE_MAILER_AUTOCONFIRM':'true','GOTRUE_DISABLE_SIGNUP':'false',
            'GOTRUE_PASSWORD_MIN_LENGTH':'8','GOTRUE_EXTERNAL_PHONE_ENABLED':'false','GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED':'false',
            'GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED':'true','GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL':'10',
            'GOTRUE_LOG_LEVEL':'warn'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--backup-dir',required=True,type=Path);parser.add_argument('--pg-bin',required=True,type=Path)
    args=parser.parse_args()
    try:print(json.dumps(inspect_auth_snapshot(args.backup_dir,args.pg_bin)));print('AUTH_SNAPSHOT_COMPATIBILITY_CHECKED_NOT_LOGIN_VERIFIED')
    except (ValueError,OSError,subprocess.SubprocessError):raise SystemExit('STOP: AUTH_SNAPSHOT_CHECK_FAILED. Retain private files; do not paste account rows or hashes.')
