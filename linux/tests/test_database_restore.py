"""Restore safety and snapshot checks, without a Docker daemon or private data."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
from unittest.mock import patch

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'restore-db-copy.py'


def module():
    assert SCRIPT.is_file(), 'Isolated restore tool has not been implemented'
    spec = importlib.util.spec_from_file_location('db_restore', SCRIPT)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def backup_fixture(root):
    root.mkdir()
    manifest = {'status': 'archive_verified_not_restored', 'files': {}}
    for name in ('database.dump', 'roles.sql', 'inventory.json', 'contents.txt'):
        raw = b'{"extensions": []}' if name == 'inventory.json' else b'fixture'
        (root / name).write_bytes(raw)
        manifest['files'][name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    (root / 'manifest.json').write_text(json.dumps(manifest))
    return root


def test_tampered_or_incomplete_backup_cannot_start_a_restore(tmp_path):
    m = module()
    root = backup_fixture(tmp_path / 'backup')
    m.verify_backup(root)
    (root / 'database.dump').write_bytes(b'tampered')
    with pytest.raises(ValueError, match='database.dump'):
        m.verify_backup(root)
    (root / 'database.dump').unlink()
    with pytest.raises(ValueError, match='database.dump'):
        m.verify_backup(root)


def test_unverified_status_and_unexpected_manifest_paths_are_refused(tmp_path):
    m = module()
    root = backup_fixture(tmp_path / 'backup')
    path = root / 'manifest.json'
    manifest = json.loads(path.read_text())
    manifest['status'] = 'partial'
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        m.verify_backup(root)
    manifest['status'] = 'archive_verified_not_restored'
    manifest['files']['../outside'] = manifest['files'].pop('roles.sql')
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        m.verify_backup(root)


def test_target_cannot_reuse_existing_data_or_overlap_backup_or_web(tmp_path):
    m = module()
    home, repo = tmp_path / 'home', tmp_path / 'repo'
    home.mkdir(); repo.mkdir()
    backup = backup_fixture(home / 'backups')
    existing = home / 'existing'
    existing.mkdir()
    for target in (existing, backup / 'target', home, repo / 'target', home / 'village-deploy' / 'db'):
        with pytest.raises(ValueError):
            m.validate_destination(target, backup, repo, home)
    assert m.validate_destination(home / 'db-copy', backup, repo, home) == home / 'db-copy'


def test_copy_parser_counts_rows_without_retaining_values_and_preserves_sequence_state():
    m = module()
    sql = '''COPY public.items (id, value) FROM stdin;
1\tprivate\\nvalue
2\tanother\\tvalue
\\.
COPY auth.users (id) FROM stdin;
\\.
COPY extensions.spatial_ref_sys (srid) FROM stdin;
\\.
SELECT pg_catalog.setval('public.items_id_seq', 19, false);
'''
    snapshot = m.parse_data_snapshot(sql)
    assert snapshot['rows'] == {'public.items': 2, 'auth.users': 0}
    assert snapshot['sequences'] == {'public.items_id_seq': [19, False]}
    assert 'private' not in json.dumps(snapshot)
    assert m.parse_data_snapshot('COPY public.items (v) FROM stdin;\nx\u0085y\n\\.\n')['rows']['public.items'] == 1
    with pytest.raises(ValueError, match='COPY'):
        m.parse_data_snapshot('COPY public.items (id) FROM stdin;\n1\n')


def test_quoted_identifiers_and_crlf_are_supported():
    m = module()
    snapshot = m.parse_data_snapshot('COPY "public"."some table" (id) FROM stdin;\r\n7\r\n\\.\r\n')
    assert snapshot['rows'] == {'public.some table': 1}
    assert m.quote_ident('a"b') == '"a""b"'


def test_toc_kind_counts_do_not_confuse_data_owned_sequences_or_publication_tables():
    m = module()
    toc = '''1; 1259 1 TABLE public items postgres
2; 0 1 TABLE DATA public items postgres
3; 1259 2 SEQUENCE public items_id_seq postgres
4; 0 0 SEQUENCE OWNED BY public items_id_seq postgres
5; 0 0 SEQUENCE SET public items_id_seq postgres
6; 6104 3 PUBLICATION - pub postgres
7; 0 0 PUBLICATION TABLE public items postgres
8; 0 1 ROW SECURITY public items postgres
9; 3256 4 POLICY public items reader postgres
10; 0 0 INDEX ATTACH public items_part_idx postgres
11; 0 0 CHECK CONSTRAINT public items items_check postgres
12; 0 0 TABLE ATTACH public items_part postgres
'''
    counts = m.toc_counts(toc)
    assert counts['tables'] == 1
    assert counts['sequences'] == 1
    assert counts['publications'] == 1
    assert counts['row_security'] == 1
    assert counts['policies'] == 1
    assert counts['indexes'] == 0
    assert counts['constraints'] == 0
    assert counts['check_constraints'] == 1


def test_validation_compose_is_offline_resource_limited_and_has_no_existing_schema_init(tmp_path):
    m = module()
    doc = m.compose_document(tmp_path / 'state', tmp_path / 'backup')
    assert len(doc['services']) == 1
    service = doc['services']['db']
    assert service['network_mode'] == 'none'
    assert 'ports' not in service and 'build' not in service
    assert service['pull_policy'] == 'never'
    assert service['environment']['POSTGRES_USER'] == m.ADMIN
    assert m.ADMIN not in ('postgres', 'supabase_admin')
    assert service['environment']['POSTGRES_PASSWORD_FILE'] == '/run/secrets/bootstrap-password'
    assert service['mem_limit'] == '768m'
    assert service['command'][:3] == ['postgres', '-D', '/var/lib/postgresql/data']
    assert '127.0.0.1' in service['healthcheck']['test'], 'Do not consider initdb temporary socket server ready'
    mounts = {item['target']: item for item in service['volumes']}
    assert mounts['/docker-entrypoint-initdb.d']['read_only'] is True
    assert mounts['/restore']['read_only'] is True
    assert mounts['/run/secrets/bootstrap-password']['read_only'] is True
    assert mounts['/var/lib/postgresql/data']['type'] == 'bind'


def test_restored_data_and_sequence_mismatches_fail_validation():
    m = module()
    expected = {'rows': {'public.items': 2}, 'sequences': {'public.items_id_seq': [19, False]}}
    m.compare_snapshot(expected, expected)
    for bad in ({'rows': {'public.items': 1}, 'sequences': expected['sequences']},
                {'rows': expected['rows'], 'sequences': {'public.items_id_seq': [19, True]}}):
        with pytest.raises(ValueError):
            m.compare_snapshot(expected, bad)


def test_source_roles_cannot_touch_the_separate_bootstrap_admin():
    m = module()
    m.validate_roles_sql('CREATE ROLE postgres;\nALTER ROLE postgres WITH NOSUPERUSER;')
    with pytest.raises(ValueError):
        m.validate_roles_sql('CREATE ROLE ' + m.ADMIN + ';')


def test_one_missing_extension_version_stops_compatibility_validation():
    m = module()
    source = [{'extname': 'postgis', 'extversion': '3.3.7'}]
    m.check_extensions(source, [{'name': 'postgis', 'version': '3.3.7'}])
    with pytest.raises(ValueError, match='postgis'):
        m.check_extensions(source, [{'name': 'postgis', 'version': '3.6.0'}])


@pytest.mark.parametrize('failure', ['roles', 'database-create', 'restore'])
def test_sql_errors_stop_without_resetting_or_continuing(failure):
    m = module()
    class FailingDocker:
        phase = ''
        calls = []
        def exec(self, *args, **kwargs):
            self.calls.append((self.phase, args))
            if self.phase == 'restore':
                assert '--exit-on-error' in args and '--single-transaction' in args
                assert '--clean' not in args and '--no-owner' not in args and '--no-acl' not in args
            if self.phase == failure:
                raise RuntimeError('test failure')
        def sql(self, *args):
            return self.exec(*args)
    docker = FailingDocker()
    with pytest.raises(RuntimeError, match='test failure'):
        m.restore_archive(docker, 'CREATE ROLE anon;\n')
    assert docker.calls[-1][0] == failure
    assert all('DROP DATABASE' not in ' '.join(args) for _, args in docker.calls)


def test_constraint_and_index_catalog_predicates_match_dump_categories():
    m = module()
    with sqlite3.connect(':memory:') as db:
        db.execute('CREATE TABLE pg_constraint (contype TEXT, conindid INTEGER)')
        db.executemany('INSERT INTO pg_constraint VALUES (?,?)', [('p', 1), ('u', 2), ('x', 3), ('c', 0), ('f', 4)])
        clause = m.CATALOG_SQL.split("SELECT 'constraints',count(*)", 1)[1].split(' UNION ALL', 1)[0]
        predicate = clause.split(' WHERE ', 1)[1].strip()
        assert db.execute('SELECT count(*) FROM pg_constraint c WHERE ' + predicate).fetchone()[0] == 3
        db.execute('CREATE TABLE pg_index (indexrelid INTEGER)')
        db.executemany('INSERT INTO pg_index VALUES (?)', [(1,), (2,), (3,), (4,), (5,)])
        clause = m.CATALOG_SQL.split("SELECT 'indexes',count(*)", 1)[1].split(' UNION ALL', 1)[0]
        predicate = clause.split('WHERE ', 1)[1].strip()
        assert db.execute('SELECT i.indexrelid FROM pg_index i WHERE ' + predicate).fetchall() == [(4,), (5,)]


def test_sql_error_values_remain_only_in_private_log(tmp_path):
    m = module()
    docker = object.__new__(m.LocalDocker)
    docker.prefix, docker.state, docker.phase = ['docker'], tmp_path, 'restore'
    private_value = 'synthetic-private-user@example.invalid'
    result = subprocess.CompletedProcess([], 1, '', 'pg_restore: error: invalid input ' + private_value)
    with patch.object(m.subprocess, 'run', return_value=result):
        with pytest.raises(RuntimeError) as error:
            docker.run(['exec'])
    assert private_value not in str(error.value)
    assert private_value in (tmp_path / 'restore-error.log').read_text()


def test_named_catalog_checks_accept_generated_children_and_keep_sql_names_quoted():
    m = module()
    assert hasattr(m, 'verify_structure'), 'Named catalog validation is missing'
    toc = '''1; 1259 1 TABLE public items postgres
2; 0 0 TABLE ATTACH public items_part postgres
3; 1259 2 INDEX public items_idx postgres
4; 0 0 INDEX ATTACH public items_child_idx postgres
5; 2606 3 CONSTRAINT public items items_pkey postgres
6; 3256 4 POLICY public items Reader's policy postgres
'''
    class Docker:
        queries = []
        def sql(self, query):
            self.queries.append(query)
            return '1'
    docker = Docker()
    # Parent operations can create extra child constraints/indexes; verify each named
    # archived definition instead of equating total generated objects with TOC rows.
    raw = dict.fromkeys(m.KINDS.values(), 0)
    raw.update(tables=2, indexes=3, constraints=2, policies=1)
    matched = m.verify_structure(docker, toc, raw)
    assert matched['tables'] == matched['indexes'] == matched['constraints'] == matched['policies'] == 1
    assert any("Reader''s policy" in query for query in docker.queries)
    assert all('items_child_idx' not in query and 'items_part' not in query for query in docker.queries)


def test_source_bootstrap_grantor_is_mapped_without_changing_membership_options():
    m = module()
    assert hasattr(m, 'prepare_roles_sql'), 'Target bootstrap grantor mapping is missing'
    source = '''CREATE ROLE anon;
CREATE ROLE supabase_admin;
ALTER ROLE supabase_admin WITH SUPERUSER;
GRANT anon TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT anon TO authenticator WITH INHERIT FALSE GRANTED BY supabase_admin;
'''
    target = m.prepare_roles_sql(source)
    assert target == source.replace('GRANTED BY supabase_admin;', 'GRANTED BY "' + m.ADMIN + '";')
    assert 'ALTER ROLE supabase_admin WITH SUPERUSER;' in target
    assert 'GRANTED BY supabase_admin;' in source, 'Do not modify source backup'
    with pytest.raises(ValueError, match='grantor'):
        m.prepare_roles_sql('GRANT anon TO postgres GRANTED BY unexpected_role;')


def test_roles_are_submitted_on_stdin_in_one_transaction():
    m = module()
    class Docker:
        calls = []
        def exec(self, *args, **kwargs): self.calls.append((args, kwargs))
        def sql(self, *args): pass
    d = Docker()
    m.restore_archive(d, 'CREATE ROLE anon;\n')
    args, kwargs = d.calls[0]
    assert args[args.index('-f') + 1] == '-'
    assert '--single-transaction' in args
    assert kwargs['input'] == 'CREATE ROLE anon;\n'


def test_resume_container_must_keep_exact_private_mounts_image_labels_and_network(tmp_path):
    m = module()
    assert hasattr(m, 'validate_resume_container'), 'Guarded resume validation is missing'
    state, backup = tmp_path / 'state', tmp_path / 'backup'
    service = m.compose_document(state, backup)['services']['db']
    info = {'Image': next(iter(m.IMAGE_IDS)), 'Config': {'Image': m.IMAGE, 'Labels': {
        'com.docker.compose.project': 'village-db-copy', 'com.docker.compose.service': 'db'}},
        'HostConfig': {'NetworkMode': 'none', 'PortBindings': {}, 'ReadonlyRootfs': True},
        'Mounts': [{'Destination': v['target'], 'Source': v['source'], 'RW': not v['read_only']}
                   for v in service['volumes']]}
    m.validate_resume_container(info, state, backup)
    for bad in ('network', 'mount', 'image'):
        changed = json.loads(json.dumps(info))
        if bad == 'network': changed['HostConfig']['NetworkMode'] = 'bridge'
        if bad == 'mount': changed['Mounts'][0]['Source'] = str(tmp_path / 'other-data')
        if bad == 'image': changed['Image'] = 'sha256:unknown'
        with pytest.raises(ValueError): m.validate_resume_container(changed, state, backup)


def test_resume_refuses_created_database_or_unrolled_source_roles():
    m = module()
    assert hasattr(m, 'validate_resume_catalog'), 'Resume rollback checks are missing'
    pristine = {'bootstrap': True, 'other_roles': 0, 'relations': 0,
                'databases': ['postgres', 'restore_control']}
    m.validate_resume_catalog(pristine)
    for key, value in (('bootstrap', False), ('other_roles', 1), ('relations', 1),
                       ('databases', ['postgres', 'restore_control', m.DATABASE])):
        with pytest.raises(ValueError): m.validate_resume_catalog({**pristine, key: value})


def test_later_error_does_not_overwrite_original_private_log(tmp_path):
    m = module()
    d = object.__new__(m.LocalDocker)
    d.prefix, d.state, d.phase = ['docker'], tmp_path, 'roles'
    (tmp_path / 'roles-error.log').write_text('original failure')
    failed = subprocess.CompletedProcess([], 1, '', 'second failure')
    with patch.object(m.subprocess, 'run', return_value=failed):
        with pytest.raises(RuntimeError): d.run(['exec'])
    assert (tmp_path / 'roles-error.log').read_text() == 'original failure'
    assert any(p.read_text() == 'second failure' for p in tmp_path.glob('roles-error-*.log'))
