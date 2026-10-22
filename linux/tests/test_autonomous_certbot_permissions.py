import importlib.util
import os
from pathlib import Path
import sys
import pytest

S = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(S))


def module():
    spec = importlib.util.spec_from_file_location('certbot_permission_test', S / 'repair-autonomous-certbot-permissions.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def fixture(state):
    root = state / 'certbot-production/config'
    root.mkdir(parents=True, mode=0o700)
    archive = root / 'archive/8.148.248.237'
    archive.mkdir(parents=True, mode=0o700)
    target = archive / 'fullchain1.pem'
    target.write_bytes(b'synthetic public certificate')
    target.chmod(0o644)
    return root, target


def test_repair_preserves_bytes_and_frozen_control_and_handles_next_renewal(tmp_path):
    m = module()
    state = tmp_path / 'state'; state.mkdir(mode=0o700)
    root, target = fixture(state)
    control = state / 'control'; control.mkdir(mode=0o700)
    original = control / 'backup-autonomous.py'; original.write_bytes(b'unchanged frozen controller')
    assert m.repair(state) == 1
    assert target.read_bytes() == b'synthetic public certificate'
    if os.name == 'posix': assert target.stat().st_mode & 0o777 == 0o600
    assert original.read_bytes() == b'unchanged frozen controller'
    repeated = m.repair(state)
    if os.name == 'posix': assert repeated == 0
    next_cert = target.with_name('fullchain2.pem')
    next_cert.write_bytes(b'next renewal'); next_cert.chmod(0o644)
    changed = m.repair(state)
    if os.name == 'posix': assert changed == 1
    assert next_cert.read_bytes() == b'next renewal'


@pytest.mark.skipif(os.name != 'posix', reason='POSIX permissions and Certbot symlinks')
def test_only_canonical_certbot_live_links_are_allowed_and_preflight_precedes_changes(tmp_path):
    m = module(); state = tmp_path / 'state'; state.mkdir(mode=0o700)
    root, target = fixture(state)
    live = root / 'live/8.148.248.237'; live.mkdir(parents=True, mode=0o700)
    (live / 'fullchain.pem').symlink_to('../../archive/8.148.248.237/fullchain1.pem')
    assert m.repair(state) == 1
    target.chmod(0o644)
    (root / 'unknown-link').symlink_to(target)
    with pytest.raises(ValueError): m.repair(state)
    assert target.stat().st_mode & 0o777 == 0o644
    (root / 'unknown-link').unlink()
    os.link(target, root / 'hard-link')
    with pytest.raises(ValueError): m.repair(state)
    assert target.stat().st_mode & 0o777 == 0o644


def test_hooks_run_after_renewal_and_before_backup_without_replacing_base_units(tmp_path):
    m = module(); state = tmp_path / 'state'; state.mkdir(mode=0o700)
    calls = []; units = tmp_path / 'units'; units.mkdir()
    m.install_hooks(state, 'admin', units=units, run=lambda *args: calls.append(args))
    inputs = list((state / 'certbot-permission-maintenance').glob('*.conf'))
    text = '\n'.join(p.read_text() for p in inputs)
    assert 'ExecStartPre=/usr/bin/python3 -B ' in text
    assert 'ExecStartPost=/usr/bin/python3 -B ' in text
    assert '--guard' in text
    assert not any('stop' in c or 'restart' in c or 'enable' in c for c in calls)
    assert all('.service.d/' in str(c[-1]).replace('\\', '/') for c in calls if c[0] == 'install' and '-d' not in c)
    assert calls[-1] == ('systemctl', 'daemon-reload')
    for p in units.glob('*.service'): pytest.fail('base unit overwritten')


def test_hooks_refuse_unrelated_existing_service(tmp_path):
    m = module(); state = tmp_path / 'state'; state.mkdir(mode=0o700)
    units = tmp_path / 'units'; units.mkdir()
    (units / 'village-autonomous-backup.service').write_text('unrelated service')
    calls = []
    with pytest.raises(ValueError): m.install_hooks(state, 'admin', units=units, run=lambda *args: calls.append(args))
    assert not calls


@pytest.mark.skipif(os.name != 'posix', reason='POSIX writable modes')
def test_group_writable_file_is_rejected_before_any_repair(tmp_path):
    m = module(); state = tmp_path / 'state'; state.mkdir(mode=0o700)
    root, target = fixture(state)
    extra = root / 'unsafe.conf'; extra.write_bytes(b'synthetic'); extra.chmod(0o664)
    with pytest.raises(ValueError): m.repair(state)
    assert target.stat().st_mode & 0o777 == 0o644


def test_unknown_dropin_is_not_overwritten_or_installed(tmp_path):
    m = module(); state = tmp_path / 'state'; state.mkdir(mode=0o700)
    units = tmp_path / 'units'; units.mkdir()
    directory = units / 'village-autonomous-backup.service.d'; directory.mkdir()
    existing = directory / '10-village-certbot-private.conf'; existing.write_text('unrelated dropin')
    calls = []
    with pytest.raises(ValueError): m.install_hooks(state, 'admin', units=units, run=lambda *args: calls.append(args))
    assert not calls and existing.read_text() == 'unrelated dropin'
