"""Safety checks for backups; no live credentials or remote database are used."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'backup-managed-db.py'


def load_script():
    spec = importlib.util.spec_from_file_location('database_backup', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_pgpass_escapes_colons_and_backslashes_and_rejects_multiline_passwords():
    module = load_script()
    assert module.pgpass_line('host', '5432', 'db', 'user', r'a:b\c') == 'host:5432:db:user:a\\:b\\\\c\n'
    with pytest.raises(ValueError):
        module.pgpass_line('host', '5432', 'db', 'user', 'a\nb')


def test_output_under_source_or_deployed_web_is_refused_even_through_symlink():
    module = load_script()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        repo, home = root / 'repo', root / 'home'
        with pytest.raises(ValueError):
            module.validate_output_root(repo / 'backups', repo, home)
        with pytest.raises(ValueError):
            module.validate_output_root(home / 'village-deploy' / 'public' / 'backup', repo, home)
        if os.name != 'nt':
            home.mkdir()
            repo.mkdir()
            (home / 'shortcut').symlink_to(repo, target_is_directory=True)
            with pytest.raises(ValueError):
                module.validate_output_root(home / 'shortcut' / 'backup', repo, home)


def test_failed_dump_retains_partial_backup_removes_credential_and_cannot_claim_success():
    module = load_script()
    secret = r'test:password\value'
    calls, credential_paths = [], []
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        def fake_run(command, **kwargs):
            calls.append(command)
            env = kwargs.get('env', {})
            if 'PGPASSFILE' in env:
                credential = Path(env['PGPASSFILE'])
                credential_paths.append(credential)
                assert credential.is_file()
                assert 'PGPASSWORD' not in env
                assert env['PGSSLMODE'] == 'verify-full'
                assert Path(env['PGSSLROOTCERT']).is_file(), 'use the dashboard CA, not an assumed system CA'
                assert 'default_transaction_read_only=on' in env['PGOPTIONS']
                assert secret not in ' '.join(command)
            tool = Path(command[0]).stem
            if tool == 'psql':
                return subprocess.CompletedProcess(command, 0, json.dumps({'server_version_num': 170006}), '')
            if tool == 'pg_dumpall':
                Path(command[command.index('--file') + 1]).write_text('-- roles', encoding='utf-8')
                return subprocess.CompletedProcess(command, 0, '', '')
            if tool == 'pg_dump':
                Path(command[command.index('--file') + 1]).write_bytes(b'partial')
                raise subprocess.CalledProcessError(1, command, stderr='connection lost')
            raise AssertionError(command)
        with patch.object(module, 'run', side_effect=fake_run):
            with pytest.raises(subprocess.CalledProcessError):
                module.backup(root / 'backups', root / 'tools', secret, root / 'repo', root / 'home')
        archives = list((root / 'backups').glob('*/database.dump.partial'))
        assert len(archives) == 1 and archives[0].read_bytes() == b'partial'
        assert not list((root / 'backups').glob('*/manifest.json'))
        assert credential_paths and all(not path.exists() for path in credential_paths)


def test_archive_decode_failure_is_not_reported_as_verified_backup():
    module = load_script()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        def fake_run(command, **kwargs):
            tool = Path(command[0]).stem
            if tool == 'psql':
                return subprocess.CompletedProcess(command, 0, '{"server_version_num":170006}', '')
            if tool in ('pg_dump', 'pg_dumpall'):
                Path(command[command.index('--file') + 1]).write_bytes(b'archive')
                return subprocess.CompletedProcess(command, 0, '', '')
            if '--list' in command:
                return subprocess.CompletedProcess(command, 0, '1; 0 0 TABLE DATA auth users postgres\n', '')
            raise subprocess.CalledProcessError(1, command, stderr='invalid compressed data')
        with patch.object(module, 'run', side_effect=fake_run):
            with pytest.raises(subprocess.CalledProcessError):
                module.backup(root / 'backups', root / 'tools', 'secret', root / 'repo', root / 'home')
        assert list((root / 'backups').glob('*/database.dump.partial'))
        assert not list((root / 'backups').glob('*/manifest.json'))


def test_verified_archive_has_matching_checksums_unique_directory_and_no_saved_source_password():
    module = load_script()
    secret = r'private:test\password'
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        def fake_run(command, **kwargs):
            tool = Path(command[0]).stem
            assert secret not in ' '.join(command)
            if tool == 'psql':
                return subprocess.CompletedProcess(command, 0, '{"server_version_num":170006}', '')
            if tool in ('pg_dump', 'pg_dumpall'):
                Path(command[command.index('--file') + 1]).write_bytes(b'valid archive fixture')
                return subprocess.CompletedProcess(command, 0, '', '')
            assert 'PGPASSFILE' not in kwargs['env'], 'offline decoding must not retain source credentials'
            return subprocess.CompletedProcess(command, 0, '1; 0 0 TABLE DATA auth users postgres\n', '')
        with patch.object(module, 'run', side_effect=fake_run):
            first = module.backup(root / 'backups', root / 'tools', secret, root / 'repo', root / 'home')
            second = module.backup(root / 'backups', root / 'tools', secret, root / 'repo', root / 'home')
        assert first != second
        for folder in (first, second):
            manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
            assert manifest['status'] == 'archive_verified_not_restored'
            assert not list(folder.glob('*.partial'))
            for name, details in manifest['files'].items():
                assert details['sha256'] == module.checksum(folder / name)
                assert details['bytes'] == (folder / name).stat().st_size
            assert all(secret.encode() not in file.read_bytes() for file in folder.iterdir())
            if os.name == 'posix':
                assert folder.stat().st_mode & 0o777 == 0o700
                assert all(file.stat().st_mode & 0o777 == 0o600 for file in folder.iterdir())


def test_changed_source_major_version_stops_before_export():
    module = load_script()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        result = subprocess.CompletedProcess([], 0, '{"server_version_num":180001}', '')
        with patch.object(module, 'run', return_value=result) as runner:
            with pytest.raises(ValueError, match='PostgreSQL 17'):
                module.backup(root / 'backups', root / 'tools', 'secret', root / 'repo', root / 'home')
        assert runner.call_count == 1
        assert not list((root / 'backups').glob('*/manifest.json'))


def test_decodable_archive_missing_auth_data_is_retained_but_not_verified():
    module = load_script()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        def fake_run(command, **kwargs):
            tool = Path(command[0]).stem
            if tool == 'psql':
                return subprocess.CompletedProcess(command, 0, '{"server_version_num":170006}', '')
            if tool in ('pg_dump', 'pg_dumpall'):
                Path(command[command.index('--file') + 1]).write_bytes(b'archive')
            return subprocess.CompletedProcess(command, 0, '-- no auth data', '')
        with patch.object(module, 'run', side_effect=fake_run):
            with pytest.raises(ValueError, match='auth.users'):
                module.backup(root / 'backups', root / 'tools', 'secret', root / 'repo', root / 'home')
        assert list((root / 'backups').glob('*/database.dump.partial'))
        assert not list((root / 'backups').glob('*/manifest.json'))


def test_bundled_ca_matches_the_certificate_from_the_authenticated_dashboard():
    module = load_script()
    assert module.checksum(module.CA_FILE) == '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'


@pytest.mark.skipif(os.name != 'nt', reason='Windows entrypoint behavior')
def test_windows_cli_allows_interactive_backup_and_selects_exe_clients():
    module = load_script()
    assert module.pg_tool(Path('tools'), 'psql').name == 'psql.exe'
    with patch.object(module.sys, 'argv', ['backup-managed-db.py']), \
         patch.object(module.os, 'access', return_value=True), \
         patch.object(module.getpass, 'getpass', return_value='test-secret'), \
         patch.object(module, 'backup') as execute:
        assert module.main() == 0
    execute.assert_called_once()


def test_missing_custom_ca_stops_before_creating_backup_or_contacting_database():
    module = load_script()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        with patch.object(module, 'run') as runner:
            with pytest.raises(ValueError, match='certificate'):
                module.backup(root / 'backups', root / 'tools', 'secret', root / 'repo', root / 'home',
                              ssl_root_cert=root / 'missing-ca.crt')
        assert not (root / 'backups').exists()
        runner.assert_not_called()


def test_cli_reports_binary_acl_error_without_traceback_or_password(capsys):
    module = load_script()
    secret = 'fake-password-only-for-test'
    failure = subprocess.CalledProcessError(1, ['icacls'], stderr=b'access denied: fake-password-only-for-test')
    with patch.object(module.sys, 'argv', ['backup-managed-db.py']), \
         patch.object(module.os, 'access', return_value=True), \
         patch.object(module.getpass, 'getpass', return_value=secret), \
         patch.object(module, 'backup', side_effect=failure):
        assert module.main() == 1
    error = capsys.readouterr().err
    assert 'STOP:' in error and '[REDACTED]' in error
    assert secret not in error and 'Traceback' not in error
