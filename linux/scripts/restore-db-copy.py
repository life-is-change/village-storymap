#!/usr/bin/env python3
"""Restore a verified archive into a new, network-isolated validation container."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
from typing import NamedTuple


ADMIN = 'village_restore_admin'
DATABASE = 'village_copy'
CONTAINER = 'village-db-copy-postgres'
IMAGE = 'supabase/postgres:17.6.1.136'
IMAGE_IDS = {
    'sha256:291367a26b42e028341d7f19b91dffa818c10e9ada6fa9022796a87b57028631',
    'sha256:f519727303f0af6862882be2a30f420e28710d4209226e681aaddb2c01d12d9b',
}
class RestoreTarget(NamedTuple):
    profile: str
    project: str
    container: str

def select_target(profile='copy'):
    targets={'copy':RestoreTarget('copy','village-db-copy',CONTAINER),
             'api-validation':RestoreTarget('api-validation','village-api-validation','village-api-validation-postgres')}
    if profile not in targets: raise ValueError('Unknown fixed restore target profile.')
    return targets[profile]
FILES = ('database.dump', 'roles.sql', 'inventory.json', 'contents.txt')
KINDS = {'TABLE': 'tables', 'SEQUENCE': 'sequences', 'FUNCTION': 'functions',
         'INDEX': 'indexes', 'CONSTRAINT': 'constraints', 'FK CONSTRAINT': 'foreign_keys',
         'CHECK CONSTRAINT': 'check_constraints',
         'POLICY': 'policies', 'ROW SECURITY': 'row_security', 'TRIGGER': 'triggers',
         'EVENT TRIGGER': 'event_triggers', 'PUBLICATION': 'publications'}
ALL_KINDS = sorted((*KINDS, 'TABLE DATA', 'SEQUENCE OWNED BY', 'SEQUENCE SET',
                    'PUBLICATION TABLE', 'PUBLICATION TABLES IN SCHEMA', 'INDEX ATTACH', 'TABLE ATTACH'), key=len, reverse=True)
IDENT = r'(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9$]*)'
COPY_RE = re.compile(r'^COPY (' + IDENT + r')\.(' + IDENT + r') \(.*\) FROM stdin;$')
SEQUENCE_RE = re.compile(r"^SELECT pg_catalog\.setval\('((?:[^']|'')*)', (-?\d+), (true|false)\);$")


def checksum(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_backup(root):
    root = Path(root)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('status') != 'archive_verified_not_restored' or set(manifest.get('files', {})) != set(FILES):
        raise ValueError('A complete verified backup manifest with exactly four files is required.')
    for name in FILES:
        path, expected = root / name, manifest['files'][name]
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing or linked backup file: ' + name)
        if path.stat().st_size != expected['bytes'] or checksum(path) != expected['sha256']:
            raise ValueError('Backup size/checksum mismatch: ' + name)
    return manifest


def validate_destination(target, backup, repo, home, *, resume=False):
    target, backup, repo, home = map(lambda p: Path(p).resolve(), (target, backup, repo, home))
    for forbidden in (backup, repo, home / 'village-deploy'):
        if target == forbidden or target in forbidden.parents or forbidden in target.parents:
            raise ValueError('Destination must be separate from backup, repository and deployed web directories.')
    if target.exists() and not resume:
        raise ValueError('Destination already exists; retain it and inspect. Never reset or overwrite: ' + str(target))
    if resume and not target.is_dir():
        raise ValueError('Resume requires an existing private validation directory.')
    return target


def quote_ident(value):
    return '"' + value.replace('"', '""') + '"'


def unquote_ident(value):
    return value[1:-1].replace('""', '"') if value.startswith('"') else value


def parse_data_snapshot(sql):
    rows, sequences, current, count = {}, {}, None, 0
    # splitlines() also splits Unicode characters which may occur inside COPY values.
    for line in sql.split('\n'):
        line = line.removesuffix('\r')
        if current is not None:
            if line == r'\.':
                schema, table = current
                if schema not in ('extensions', 'vault'):
                    rows[schema + '.' + table] = count
                current, count = None, 0
            else:
                count += 1
            continue
        copy = COPY_RE.fullmatch(line)
        if copy:
            current = tuple(map(unquote_ident, copy.groups()))
        elif line.startswith('COPY '):
            raise ValueError('Unsupported COPY header in archive; stop for review.')
        sequence = SEQUENCE_RE.fullmatch(line)
        if sequence:
            name, value, called = sequence.groups()
            sequences[name.replace("''", "'")] = [int(value), called == 'true']
    if current is not None:
        raise ValueError('Unterminated COPY block in archive.')
    return {'rows': rows, 'sequences': sequences}


def toc_records(toc):
    for line in toc.splitlines():
        match = re.match(r'^\d+; \d+ \d+ (.*)$', line)
        if not match:
            continue
        for kind in ALL_KINDS:
            if match[1].startswith(kind + ' '):
                if kind in KINDS:
                    yield KINDS[kind], match[1][len(kind) + 1:].rsplit(' ', 1)[0]
                break


def toc_counts(toc):
    counts = dict.fromkeys(KINDS.values(), 0)
    for kind, _ in toc_records(toc):
        counts[kind] += 1
    return counts


def compare_snapshot(expected, actual):
    for kind in ('rows', 'sequences'):
        if expected[kind] != actual[kind]:
            changed = sorted(k for k in set(expected[kind]) | set(actual[kind])
                             if expected[kind].get(k) != actual[kind].get(k))
            raise ValueError('Restored ' + kind + ' mismatch: ' + ', '.join(changed[:8]))


def validate_roles_sql(sql):
    if re.search(r'\b' + re.escape(ADMIN) + r'\b', sql, re.I):
        raise ValueError('Source roles must not create, alter or grant the separate bootstrap admin.')


def prepare_roles_sql(sql):
    """Map the source bootstrap grantor to this cluster's bootstrap superuser."""
    validate_roles_sql(sql)
    lines = []
    for line in sql.splitlines():
        if line.startswith('GRANT '):
            grant = re.fullmatch(r'(GRANT .+ GRANTED BY )(' + IDENT + r');', line)
            if not grant or unquote_ident(grant[2]) != 'supabase_admin':
                raise ValueError('Unexpected role-membership grantor; stop for explicit compatibility review.')
            line = grant[1] + quote_ident(ADMIN) + ';'
        lines.append(line)
    return '\n'.join(lines) + '\n'


def validate_resume_container(info, state, backup, *, target=None):
    target = target or select_target()
    labels = info.get('Config', {}).get('Labels') or {}
    host = info.get('HostConfig', {})
    if (info.get('Image') not in IMAGE_IDS or info.get('Config', {}).get('Image') != IMAGE
            or labels.get('com.docker.compose.project') != target.project
            or labels.get('com.docker.compose.service') != 'db'
            or host.get('NetworkMode') != 'none' or host.get('PortBindings')
            or not host.get('ReadonlyRootfs')):
        raise ValueError('Existing container identity/isolation does not match the private validation copy.')
    actual = {item['Destination']: item for item in info.get('Mounts', [])}
    expected = compose_document(state, backup, target=target)['services']['db']['volumes']
    for mount in expected:
        found = actual.get(mount['target'])
        if (not found or Path(found['Source']).resolve() != Path(mount['source']).resolve()
                or found['RW'] != (not mount['read_only'])):
            raise ValueError('Existing validation mount differs: ' + mount['target'])


def validate_resume_catalog(snapshot):
    if (not snapshot.get('bootstrap') or snapshot.get('other_roles') != 0
            or snapshot.get('relations') != 0
            or set(snapshot.get('databases', [])) != {'postgres', 'restore_control'}):
        raise ValueError('Resume requires the failed roles transaction to be rolled back and no target database/data. '
                         'Existing data/roles are retained; no automatic overwrite.')


RESUME_CATALOG_SQL = """SELECT json_build_object(
 'bootstrap',coalesce((SELECT rolsuper AND oid=10 FROM pg_roles WHERE rolname=current_user),false),
 'other_roles',(SELECT count(*) FROM pg_roles WHERE rolname !~ '^pg_' AND rolname<>current_user),
 'relations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','S')),
 'databases',(SELECT json_agg(datname) FROM pg_database WHERE NOT datistemplate));"""


def check_extensions(source, available):
    pairs = {(row['name'], row['version']) for row in available}
    for row in source:
        if (row['extname'], row['extversion']) not in pairs:
            raise ValueError('Required extension version unavailable: ' + row['extname'] + ' ' + row['extversion'])


def compose_document(state, backup, *, target=None):
    target = target or select_target()
    def mount(source, target, read_only=False):
        return {'type': 'bind', 'source': str(source), 'target': target,
                'read_only': read_only, 'bind': {'create_host_path': False}}
    return {'name': target.project, 'services': {'db': {
        'image': IMAGE, 'pull_policy': 'never', 'container_name': target.container,
        'network_mode': 'none', 'restart': 'unless-stopped', 'read_only': True,
        'mem_limit': '768m', 'memswap_limit': '768m', 'cpus': 1.0, 'pids_limit': 256,
        'shm_size': '128m', 'security_opt': ['no-new-privileges:true'],
        'tmpfs': ['/tmp:size=64m,mode=1777', '/var/run/postgresql:size=16m,mode=3775'],
        'environment': {'PGDATA': '/var/lib/postgresql/data', 'POSTGRES_USER': ADMIN,
                        'POSTGRES_DB': 'restore_control',
                        'POSTGRES_PASSWORD_FILE': '/run/secrets/bootstrap-password',
                        'POSTGRES_INITDB_ARGS': '--encoding=UTF8 --locale=C.UTF-8 --auth-host=scram-sha-256'},
        # Use a clean native initdb configuration, not /etc/postgresql's platform configuration.
        'command': ['postgres', '-D', '/var/lib/postgresql/data',
                    '-c', 'shared_preload_libraries=pg_stat_statements',
                    '-c', 'shared_buffers=128MB', '-c', 'work_mem=4MB',
                    '-c', 'maintenance_work_mem=64MB', '-c', 'max_connections=25',
                    '-c', 'max_locks_per_transaction=256', '-c', 'max_wal_size=256MB',
                    '-c', 'wal_level=logical', '-c', 'max_parallel_workers_per_gather=0'],
        'volumes': [mount(state / 'data', '/var/lib/postgresql/data'),
                    mount(state / 'empty-init', '/docker-entrypoint-initdb.d', True),
                    mount(state / 'bootstrap-password', '/run/secrets/bootstrap-password', True),
                    mount(backup, '/restore', True)],
        # initdb's temporary server is socket-only; TCP readiness avoids racing it.
        'healthcheck': {'test': ['CMD', 'pg_isready', '-h', '127.0.0.1',
                               '-U', ADMIN, '-d', 'restore_control'],
                        'interval': '5s', 'timeout': '3s', 'retries': 20, 'start_period': '10s'},
        'logging': {'driver': 'local', 'options': {'max-size': '5m', 'max-file': '3'}},
    }}}


CATALOG_SQL = r"""
WITH user_rel AS (
 SELECT c.oid,c.relkind,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
), counts AS (
 SELECT 'tables' k,count(*) v FROM user_rel WHERE relkind IN ('r','p')
 UNION ALL SELECT 'sequences',count(*) FROM user_rel WHERE relkind='S'
 UNION ALL SELECT 'row_security',count(*) FROM user_rel WHERE relrowsecurity
 UNION ALL SELECT 'functions',count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
 UNION ALL SELECT 'indexes',count(*) FROM pg_index i JOIN user_rel r ON r.oid=i.indrelid
 WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid AND c.contype IN ('p','u','x'))
 UNION ALL SELECT 'constraints',count(*) FROM pg_constraint c JOIN user_rel r ON r.oid=c.conrelid WHERE c.contype IN ('p','u','x')
 UNION ALL SELECT 'check_constraints',count(*) FROM pg_constraint c JOIN user_rel r ON r.oid=c.conrelid WHERE c.contype='c'
 UNION ALL SELECT 'foreign_keys',count(*) FROM pg_constraint c JOIN user_rel r ON r.oid=c.conrelid WHERE c.contype='f'
 UNION ALL SELECT 'policies',count(*) FROM pg_policy p JOIN user_rel r ON r.oid=p.polrelid
 UNION ALL SELECT 'triggers',count(*) FROM pg_trigger t JOIN user_rel r ON r.oid=t.tgrelid WHERE NOT t.tgisinternal
 UNION ALL SELECT 'event_triggers',count(*) FROM pg_event_trigger
 UNION ALL SELECT 'publications',count(*) FROM pg_publication
) SELECT json_object_agg(k,v) FROM counts;
"""


class LocalDocker:
    def __init__(self, state, *, target=None):
        self.target = target or select_target()
        self.prefix = ['docker'] if os.geteuid() == 0 else ['sudo', '-n', 'docker']
        self.prefix += ['--host', 'unix:///var/run/docker.sock']
        self.state = state
        self.phase = 'preflight'

    def run(self, args, *, input=None):
        result = subprocess.run(self.prefix + args, input=input, text=True, encoding='utf-8',
                                capture_output=True, env={k: v for k, v in os.environ.items()
                                                          if not k.startswith(('PG', 'DOCKER_', 'COMPOSE_'))})
        if result.returncode:
            if self.state.is_dir():
                log = self.state / (self.phase + '-error.log')
                if log.exists():
                    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S')
                    log = self.state / (self.phase + '-error-' + stamp + '-' + secrets.token_hex(3) + '.log')
                with log.open('x', encoding='utf-8') as stream:
                    stream.write(result.stderr)
            # Do not echo SQL, COPY values, function bodies or the database dump.
            raise RuntimeError('Phase ' + self.phase + ' failed (exit ' + str(result.returncode) + '). '
                               + 'Private error log retained in ' + str(self.state))
        return result.stdout

    def compose(self, *args):
        return self.run(['compose', '-f', str(self.state / 'compose.yaml'), *args])

    def exec(self, *args, input=None):
        return self.run(['exec', '-i', '--user', '0', self.target.container, *args], input=input)

    def sql(self, sql, database=DATABASE):
        return self.exec('psql', '-X', '-w', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                         '-h', '/var/run/postgresql', '-U', ADMIN, '-d', database, input=sql)

    def ready(self):
        for _ in range(45):
            info = json.loads(self.run(['inspect', self.target.container]))[0]
            if info['State'].get('Health', {}).get('Status') == 'healthy':
                return
            if not info['State'].get('Running'):
                raise RuntimeError('Database container stopped during initialisation; retain it and inspect logs.')
            time.sleep(2)
        raise RuntimeError('Database readiness timed out; retain container and logs.')


def actual_snapshot(docker, expected):
    rows, sequences = {}, {}
    for name in expected['rows']:
        schema, table = name.split('.', 1)
        rows[name] = int(docker.sql('SELECT count(*) FROM ' + quote_ident(schema) + '.' + quote_ident(table) + ';'))
    for name in expected['sequences']:
        match = re.fullmatch('(' + IDENT + r')\.(' + IDENT + ')', name)
        if not match:
            raise ValueError('Unsupported sequence identifier: ' + name)
        identifier = '.'.join(quote_ident(unquote_ident(p)) for p in match.groups())
        value, called = docker.sql('SELECT last_value,is_called FROM ' + identifier + ';').strip().split('|')
        sequences[name] = [int(value), called == 't']
    return {'rows': rows, 'sequences': sequences}


def verify_structure(docker, toc, raw_counts):
    """Match named TOC definitions; generated partition children are not TOC entries."""
    single = {'tables': "c.relkind IN ('r','p')", 'sequences': "c.relkind='S'",
              'indexes': "c.relkind IN ('i','I')", 'row_security': 'c.relrowsecurity'}
    related = {
        'constraints': ('pg_constraint', 'conrelid', 'conname', "o.contype IN ('p','u','x')"),
        'foreign_keys': ('pg_constraint', 'conrelid', 'conname', "o.contype='f'"),
        'check_constraints': ('pg_constraint', 'conrelid', 'conname', "o.contype='c'"),
        'policies': ('pg_policy', 'polrelid', 'polname', 'true'),
        'triggers': ('pg_trigger', 'tgrelid', 'tgname', 'NOT o.tgisinternal'),
    }
    groups = {kind: [] for kind in (*single, *related)}
    for kind, body in toc_records(toc):
        if kind in groups:
            fields = body.split(' ', 2 if kind in related else 1)
            if len(fields) != (3 if kind in related else 2):
                raise ValueError('Unsupported object name in archive catalog.')
            groups[kind].append(fields)
    matched = {}
    for kind, fields in groups.items():
        matched[kind] = 0
        if not fields:
            continue
        def literal(value):
            return "'" + value.replace("'", "''") + "'"
        values = ','.join('(' + ','.join(map(literal, row)) + ')' for row in fields)
        columns = 'schema_name,table_name,object_name' if kind in related else 'schema_name,object_name'
        query = 'WITH wanted(' + columns + ') AS (VALUES ' + values + ') SELECT count(*) FROM wanted w '
        query += 'JOIN pg_namespace n ON n.nspname=w.schema_name '
        if kind in single:
            query += 'JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=w.object_name WHERE ' + single[kind]
        else:
            table, relation, name, predicate = related[kind]
            query += 'JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=w.table_name '
            query += 'JOIN ' + table + ' o ON o.' + relation + '=c.oid AND o.' + name + '=w.object_name WHERE ' + predicate
        matched[kind] = int(docker.sql(query + ';'))
        if matched[kind] != len(fields):
            raise ValueError('Restored named archive objects differ: ' + kind)
    expected = toc_counts(toc)
    for kind in ('functions', 'event_triggers', 'publications'):
        matched[kind] = raw_counts[kind]
    if matched != expected:
        raise ValueError('Restored function/publication/event trigger counts differ from archive.')
    return matched


def restore_archive(docker, roles_sql):
    docker.phase = 'roles'
    docker.exec('psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
                '-h', '/var/run/postgresql', '-U', ADMIN, '-d', 'restore_control', '-f', '-', input=roles_sql)
    docker.phase = 'database-create'
    docker.sql('CREATE DATABASE ' + DATABASE + ' OWNER postgres TEMPLATE template0;', 'restore_control')
    docker.phase = 'restore'
    print('Restoring archive in one transaction...', flush=True)
    docker.exec('pg_restore', '--exit-on-error', '--single-transaction',
                '-h', '/var/run/postgresql', '-U', ADMIN, '-d', DATABASE, '/restore/database.dump')


def restore(backup, state, *, resume=False, target_profile='copy'):
    target = select_target(target_profile)
    if sys.platform != 'linux':
        raise ValueError('Run this restore tool only in the Aliyun Linux terminal.')
    os.umask(0o077)
    backup = Path(backup).resolve()
    state = validate_destination(state, backup, Path(__file__).resolve().parents[2], Path.home(), resume=resume)
    manifest = verify_backup(backup)
    roles_sql = prepare_roles_sql((backup / 'roles.sql').read_text(encoding='utf-8'))
    inventory = json.loads((backup / 'inventory.json').read_text(encoding='utf-8'))
    if int(inventory['server_version_num']) // 10000 != 17:
        raise ValueError('Expected PostgreSQL 17 source archive.')
    available = int(re.search(r'^MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text(), re.M)[1]) * 1024
    minimum_memory = 384 if resume else 900
    if available < minimum_memory * 1024**2 or shutil.disk_usage(Path.home()).free < 4 * 1024**3:
        raise ValueError('Require at least ' + str(minimum_memory) + ' MiB available memory and 4 GiB free home disk.')
    docker = LocalDocker(state, target=target)
    docker.run(['info', '--format', '{{.ServerVersion}}'])
    image = json.loads(docker.run(['image', 'inspect', IMAGE]))[0]
    if image['Id'] not in IMAGE_IDS or (image['Os'], image['Architecture']) != ('linux', 'amd64'):
        raise ValueError('Local database image identity/platform does not match the verified offline image.')
    containers = docker.run(['ps', '-a', '--format', '{{.Names}}']).splitlines()
    if target.container in containers and not resume:
        raise ValueError('Validation container already exists; do not replace it.')
    if resume:
        if target.container not in containers or (state / 'restore-result.json').exists():
            raise ValueError('Resume requires the existing incomplete validation container, with no success result.')
        if state.stat().st_uid != os.geteuid() or state.stat().st_mode & 0o077:
            raise ValueError('Resume state must be owned by the current user with private permissions.')
        if (json.loads((state / 'compose.yaml').read_text()) != compose_document(state, backup, target=target)
                or not (state / 'bootstrap-password').is_file()
                or not (state / 'archive-snapshot-counts.json').is_file()):
            raise ValueError('Resume state is not the matching archive-inspected validation checkpoint.')
        validate_resume_container(json.loads(docker.run(['inspect', target.container]))[0], state, backup, target=target)
    else:
        state.mkdir(mode=0o700, parents=True, exist_ok=False)
        for name in ('data', 'empty-init'):
            (state / name).mkdir(mode=0o700)
        # The bind mount bypasses the private parent; postgres must list this empty directory.
        (state / 'empty-init').chmod(0o755)
        (state / 'bootstrap-password').write_text(secrets.token_urlsafe(36) + '\n', encoding='ascii')
        (state / 'compose.yaml').write_text(json.dumps(compose_document(state, backup, target=target), indent=2) + '\n', encoding='utf-8')
    print('Private restore state:', state, flush=True)
    docker.phase = 'initialisation'
    if not resume:
        docker.compose('up', '-d', '--pull', 'never')
    docker.ready()
    if resume:
        validate_resume_catalog(json.loads(docker.sql(RESUME_CATALOG_SQL, 'restore_control')))
    available_extensions = json.loads(docker.sql(
        "SELECT coalesce(json_agg(json_build_object('name',name,'version',version)), '[]'::json) FROM pg_available_extension_versions;",
        'restore_control'))
    check_extensions(inventory['extensions'], available_extensions)
    docker.phase = 'archive-inspection'
    toc = docker.exec('pg_restore', '--list', '/restore/database.dump')
    # Decode only into this private process. Save counts, never SQL or row values to console.
    data_sql = docker.exec('pg_restore', '--data-only', '--file=-', '/restore/database.dump')
    expected = parse_data_snapshot(data_sql)
    del data_sql
    if 'auth.users' not in expected['rows'] or 'storage.objects' not in expected['rows']:
        raise ValueError('Archive is missing required Auth or Storage data blocks.')
    structure = toc_counts(toc)
    snapshot_path = state / 'archive-snapshot-counts.json'
    if resume:
        compare_snapshot(json.loads(snapshot_path.read_text()), expected)
    else:
        snapshot_path.write_text(json.dumps(expected, indent=2) + '\n', encoding='utf-8')
    target_roles = state / 'roles-target.sql'
    if target_roles.exists():
        if target_roles.is_symlink() or target_roles.read_text(encoding='utf-8') != roles_sql:
            raise ValueError('Existing target role script differs; retain it and inspect.')
    else:
        with target_roles.open('x', encoding='utf-8') as stream:
            stream.write(roles_sql)
    restore_archive(docker, roles_sql)
    docker.phase = 'verification'
    restored_extensions = json.loads(docker.sql(
        "SELECT json_agg(json_build_object('name',extname,'version',extversion)) FROM pg_extension;"))
    check_extensions(inventory['extensions'], restored_extensions)
    raw_counts = json.loads(docker.sql(CATALOG_SQL))
    (state / 'catalog-raw-counts.json').write_text(json.dumps({'archive': structure, 'target': raw_counts}, indent=2))
    actual_counts = verify_structure(docker, toc, raw_counts)
    compare_snapshot(expected, actual_snapshot(docker, expected))
    docker.sql('ANALYZE;')
    docker.phase = 'restart-verification'
    print('Checking data after container restart...', flush=True)
    docker.compose('restart', 'db')
    docker.ready()
    compare_snapshot(expected, actual_snapshot(docker, expected))
    info = json.loads(docker.run(['inspect', target.container]))[0]
    if info['HostConfig']['NetworkMode'] != 'none' or info['HostConfig'].get('PortBindings'):
        raise ValueError('Container isolation differs from the requested configuration.')
    stats = docker.run(['stats', '--no-stream', '--format', '{{.Name}} memory={{.MemUsage}} cpu={{.CPUPerc}}', target.container]).strip()
    result = {'status': 'isolated_restore_validated_not_cut_over', 'completed_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
              'source_archive_sha256': manifest['files']['database.dump']['sha256'], 'image_id': image['Id'],
              'role_grantor_mapping': {'supabase_admin': ADMIN}, 'target_roles_sha256': checksum(target_roles),
              'catalog_counts': actual_counts, 'row_counts': expected['rows'], 'sequences': expected['sequences'],
              'limits': ['No application cutover; original Supabase remains authoritative.',
                         'Storage bytes and service configuration not copied; Vault decryption not verified.',
                         'Source database-level properties need separate mapping to the named validation database.',
                         'Object counts and restored definitions do not prove application/RLS behavior.']}
    (state / 'restore-result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print('DB_COPY_RESTORE_VERIFIED_NOT_CUT_OVER', flush=True)
    print('Checked tables with data:', len(expected['rows']), 'sequences:', len(expected['sequences']), flush=True)
    print('Auth users:', expected['rows']['auth.users'], 'Storage metadata objects:', expected['rows']['storage.objects'], flush=True)
    print(stats)
    print('Original Supabase, website and 4090 settings were not changed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-dir', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path)
    parser.add_argument('--target-profile', choices=['copy','api-validation'], default='copy')
    parser.add_argument('--resume', action='store_true', help='Continue only a pristine, rolled-back roles-stage failure.')
    args = parser.parse_args()
    try:
        state = args.state_dir or (Path.home() / ('village-db-copy' if args.target_profile == 'copy' else 'village-api-validation/db'))
        restore(args.backup_dir, state, resume=args.resume, target_profile=args.target_profile)
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print('STOP: ' + str(error), file=sys.stderr)
        print('Retain backup, partial target and private logs. Do not reset or rerun over existing data.', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('STOP: interrupted; retain backup and partial target.', file=sys.stderr)
        return 130
    return 0


if __name__ == '__main__':
    sys.exit(main())
