#!/usr/bin/env python3
"""Archive managed PostgreSQL without changing the live application connection."""
import argparse
import datetime as dt
import getpass
import hashlib
import json
import locale
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import warnings


HOST = 'aws-1-ap-northeast-1.pooler.supabase.com'
PORT = '5432'
DATABASE = 'postgres'
USER = 'postgres.rzmbmwauomzwiyenafha'
CA_FILE = Path(__file__).resolve().parents[1] / 'certs' / 'supabase-prod-ca-2021.crt'

INVENTORY_SQL = """SELECT json_build_object(
 'server_version', current_setting('server_version'),
 'server_version_num', current_setting('server_version_num')::int,
 'database_bytes', pg_database_size(current_database()),
 'counts_observed_at_inventory', json_build_object(
   'auth_users', (select count(*) from auth.users),
   'storage_objects', (select count(*) from storage.objects)),
 'extensions', (select json_agg(row_to_json(e)) from
   (select extname, extversion from pg_extension order by extname) e),
 'public_tables', (select json_agg(row_to_json(t)) from
   (select schemaname, tablename from pg_tables
    where schemaname = 'public' order by tablename) t));"""


def pgpass_line(host, port, database, user, password):
    fields = (host, port, database, user, password)
    if any(any(char in field for char in ('\n', '\r', '\0')) for field in fields):
        raise ValueError('Connection fields must not contain newlines or NUL.')
    return ':'.join(field.replace('\\', '\\\\').replace(':', '\\:') for field in fields) + '\n'


def validate_output_root(path, repo, home):
    path = Path(path).resolve()
    forbidden = (Path(repo).resolve(), (Path(home) / 'village-deploy').resolve())
    if any(path == base or base in path.parents or path in base.parents for base in forbidden):
        raise ValueError('Backup output must be separate from source and village-deploy/web directories.')
    return path


def run(command, **kwargs):
    return subprocess.run(command, check=True, text=True, encoding='utf-8', capture_output=True, **kwargs)


def pg_tool(bin_dir, name):
    return Path(bin_dir) / (name + ('.exe' if os.name == 'nt' else ''))


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == 'nt':
        identity = subprocess.check_output(['whoami', '/user', '/fo', 'csv', '/nh'])
        match = re.search(rb'S-\d-\d+(?:-\d+)+', identity)
        if not match:
            raise ValueError('Cannot determine current Windows user SID; no backup was written.')
        sid = match.group().decode('ascii')
        # A Windows chmod alone does not restrict NTFS access. Protect the directory
        # before creating any archive or credential files inside it.
        subprocess.run(['icacls', str(path), '/inheritance:r', '/grant:r',
                        '*' + sid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'],
                       check=True, capture_output=True)
    else:
        if path.stat().st_uid != os.geteuid():
            raise ValueError('Backup directory must be owned by the current user.')
        path.chmod(0o700)


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def backup(output_root, bin_dir, password, repo, home, ssl_root_cert=CA_FILE):
    # Validate before making directories, opening a credential file or contacting the source.
    line = pgpass_line(HOST, PORT, DATABASE, USER, password)
    output_root = validate_output_root(output_root, repo, home)
    ssl_root_cert = Path(ssl_root_cert).resolve()
    if not ssl_root_cert.is_file():
        raise ValueError('Trusted server CA certificate file is missing; no backup was started.')
    private_directory(output_root)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-')
    destination = Path(tempfile.mkdtemp(prefix=stamp, dir=output_root))
    private_directory(destination)
    print('Backup directory:', destination, flush=True)
    bin_dir = Path(bin_dir)
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    with tempfile.TemporaryDirectory(prefix='credential-', dir=destination) as credential_dir:
        credential = Path(credential_dir) / 'pgpass'
        credential.write_text(line, encoding='utf-8')
        credential.chmod(0o600)
        env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        env.update(PGHOST=HOST, PGPORT=PORT, PGDATABASE=DATABASE, PGUSER=USER,
                   PGPASSFILE=str(credential), PGSSLMODE='verify-full',
                   PGSSLROOTCERT=str(ssl_root_cert), PGCONNECT_TIMEOUT='15', PGCLIENTENCODING='UTF8',
                   PGAPPNAME='village-db-backup',
                   PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=5000 -c statement_timeout=120000')
        print('Reading source inventory using verified TLS...', flush=True)
        inventory = json.loads(run([str(pg_tool(bin_dir, 'psql')), '-X', '-w', '-A', '-t',
                                   '-v', 'ON_ERROR_STOP=1', '-c', INVENTORY_SQL], env=env).stdout)
        if int(inventory['server_version_num']) // 10000 != 17:
            raise ValueError('Expected source PostgreSQL 17; stop and review client/target versions.')
        (destination / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
        print('Exporting roles (role passwords are excluded)...', flush=True)
        roles_partial = destination / 'roles.sql.partial'
        run([str(pg_tool(bin_dir, 'pg_dumpall')), '-w', '--roles-only', '--no-role-passwords',
             '--file', str(roles_partial)], env=env)
        roles_partial.rename(destination / 'roles.sql')
        print('Exporting a consistent database archive...', flush=True)
        partial = destination / 'database.dump.partial'
        run([str(pg_tool(bin_dir, 'pg_dump')), '-w', '--format=custom', '--lock-wait-timeout=5s',
             '--file', str(partial)], env=env)
    # Credentials are removed before offline verification; no destination DB is contacted.
    print('Decoding the entire archive offline (not restoring)...', flush=True)
    offline_env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    toc = run([str(pg_tool(bin_dir, 'pg_restore')), '--list', str(partial)], env=offline_env).stdout
    run([str(pg_tool(bin_dir, 'pg_restore')), '--file', os.devnull, str(partial)], env=offline_env)
    if 'TABLE DATA auth users ' not in toc:
        raise ValueError('Archive is missing auth.users table data; retain the partial backup and inspect.')
    partial.rename(destination / 'database.dump')
    (destination / 'contents.txt').write_text(toc, encoding='utf-8')
    files = ('database.dump', 'roles.sql', 'inventory.json', 'contents.txt')
    for name in files:
        (destination / name).chmod(0o600)
    manifest = {
        'status': 'archive_verified_not_restored',
        'started_at_utc': started,
        'completed_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
        'source': {'host': HOST, 'database': DATABASE, 'user': USER},
        'ca_certificate_sha256': checksum(ssl_root_cert),
        'files': {name: {'bytes': (destination / name).stat().st_size,
                         'sha256': checksum(destination / name)} for name in files},
        'limits': ['Role passwords excluded; regenerate on target.',
                   'Storage object bytes and service/JWT/provider configuration not included.',
                   'Inventory counts are observations, not transaction-snapshot restore checks.',
                   'Raw managed-platform archive needs compatibility review before restore.',
                   'Vault ciphertext does not establish availability of its decryption key.']}
    manifest_partial = destination / 'manifest.json.partial'
    manifest_partial.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    manifest_partial.chmod(0o600)
    manifest_partial.rename(destination / 'manifest.json')
    print('DB_BACKUP_ARCHIVE_VERIFIED_NOT_RESTORED', flush=True)
    print('Archive bytes:', manifest['files']['database.dump']['bytes'], flush=True)
    print('No frontend, worker, source database settings or database ports were changed.', flush=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-root', type=Path, default=Path.home() / 'village-db-backups')
    default_bin = Path.home() / '.codex/tools/village-pg17/pgsql/bin' if os.name == 'nt' else Path('/usr/lib/postgresql/17/bin')
    parser.add_argument('--bin-dir', type=Path, default=default_bin)
    parser.add_argument('--ssl-root-cert', type=Path, default=CA_FILE)
    args = parser.parse_args()
    secret = ''
    try:
        os.umask(0o077)
        for name in ('psql', 'pg_dump', 'pg_dumpall', 'pg_restore'):
            if not os.access(pg_tool(args.bin_dir, name), os.X_OK):
                raise ValueError('PostgreSQL 17 clients are missing; install them or supply --bin-dir. See linux/README.database-copy.md.')
        if not args.ssl_root_cert.is_file():
            raise ValueError('Trusted server CA certificate is missing; supply --ssl-root-cert.')
        validate_output_root(args.output_root, Path(__file__).resolve().parents[2], Path.home())
        # Refuse getpass's echoing fallback on terminals that cannot hide input.
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            secret = getpass.getpass('Supabase DATABASE password (hidden; not your website password): ')
        if not secret:
            raise ValueError('Empty database password; backup was not started.')
        backup(args.output_root, args.bin_dir, secret, Path(__file__).resolve().parents[2], Path.home(),
               ssl_root_cert=args.ssl_root_cert)
    except (ValueError, OSError, subprocess.CalledProcessError, getpass.GetPassWarning, EOFError) as error:
        detail = getattr(error, 'stderr', None) or str(error)
        if isinstance(detail, bytes):
            detail = detail.decode(locale.getpreferredencoding(False), errors='replace')
        if secret:
            detail = detail.replace(secret, '[REDACTED]')
        print('STOP: ' + detail[:2000], file=sys.stderr)
        print('Existing/partial backup files are retained. Send only this final error, not SQL/dump files.', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('\nSTOP: interrupted; partial backups are retained.', file=sys.stderr)
        return 130
    return 0


if __name__ == '__main__':
    sys.exit(main())
