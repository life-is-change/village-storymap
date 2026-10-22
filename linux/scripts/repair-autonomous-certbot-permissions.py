#!/usr/bin/env python3
"""Restrict owned Certbot files without changing frozen release bytes or trust."""
import argparse
import contextlib
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess


def owned(path, *, directory=False, private=False):
    path = Path(path).absolute()
    for component in (path, *path.parents):
        if component.is_symlink(): raise ValueError('CERTBOT_PATH_LINK_REFUSED')
    st = path.stat()
    if (not (stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode))
            or not directory and st.st_nlink != 1
            or os.name == 'posix' and (st.st_uid != os.geteuid() or st.st_mode & (0o077 if private else 0o022))):
        raise ValueError('CERTBOT_OWNED_PATH_REQUIRED')
    return path


def digest_fd(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    h = hashlib.sha256()
    while block := os.read(fd, 1024**2): h.update(block)
    return h.hexdigest()


def repair(state):
    """Caller holds the TLS lock. Validate the full set before restricting modes."""
    state = owned(state, directory=True, private=True)
    root = owned(state / 'certbot-production/config', directory=True, private=True)
    files = []
    paths = list(root.rglob('*'))
    if len(paths) > 5000: raise ValueError('CERTBOT_FILE_LIMIT')
    for path in paths:
        if path.is_symlink():
            relative = path.relative_to(root).as_posix()
            match = re.fullmatch(r'live/8\.148\.248\.237/(cert|chain|fullchain|privkey)\.pem', relative)
            target = path.resolve(strict=True)
            if (not match or target.parent != root / 'archive/8.148.248.237'
                    or not re.fullmatch(match[1] + r'[0-9]+\.pem', target.name)):
                raise ValueError('CERTBOT_LIVE_LINK_REQUIRED')
            owned(target)
            continue
        directory = path.is_dir()
        owned(path, directory=directory)
        if not directory:
            st = path.stat()
            if st.st_size > 32*1024**2 or os.name == 'posix' and stat.S_IMODE(st.st_mode) not in (0o600, 0o644):
                raise ValueError('CERTBOT_FILE_MODE_REQUIRED')
            files.append((path, st))
    changed = 0
    for path, before in files:
        owned(path)
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        try:
            current = os.fstat(fd)
            if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns, current.st_mode, current.st_nlink) != (
                    before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_mode, before.st_nlink):
                raise ValueError('CERTBOT_FILE_REPLACED')
            digest = digest_fd(fd)
            if stat.S_IMODE(before.st_mode) != 0o600:
                if os.name == 'posix': os.fchmod(fd, 0o600)
                else: path.chmod(0o600)
                changed += 1
            if digest_fd(fd) != digest: raise ValueError('CERTBOT_FILE_CONTENT_CHANGED')
        finally: os.close(fd)
    return changed


@contextlib.contextmanager
def tls_lock(state):
    import fcntl
    state = owned(state, directory=True, private=True)
    path = state / '.tls-operation.lock'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        st = os.fstat(fd)
        if st.st_uid != os.geteuid() or st.st_nlink != 1 or st.st_mode & 0o077:
            raise ValueError('PRIVATE_TLS_LOCK_REQUIRED')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally: os.close(fd)


def write_once(path, value, mode=0o600):
    if path.exists():
        if owned(path, private=True).read_bytes() != value: raise ValueError('CERTBOT_GUARD_INPUT_CHANGED')
    else:
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode), 'wb') as stream:
            stream.write(value); stream.flush(); os.fsync(stream.fileno())


def install_hooks(state, user, *, units=Path('/etc/systemd/system'), run=None):
    # This installer runs from the checkout. The copied --guard runtime uses
    # only stdlib, so timers never import mutable checkout modules.
    from autonomous_bundle import load_script
    import autonomous_tls
    if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', user or '') or user == 'root':
        raise ValueError('STANDARD_OPERATOR_REQUIRED')
    state = owned(state, directory=True, private=True)
    units = Path(units).absolute()
    if units.is_symlink() or not units.is_dir(): raise ValueError('SYSTEM_UNIT_DIRECTORY_REQUIRED')
    expected = {'tls': autonomous_tls.renewal_units(user)[0], 'backup': load_script('backup-autonomous').backup_units(user)[0]}
    for kind, value in expected.items():
        base = units / f'village-autonomous-{kind}.service'
        if base.is_symlink() or base.exists() and (not base.is_file() or base.stat().st_nlink != 1 or base.read_text() != value):
            raise ValueError('EXISTING_SYSTEM_SERVICE_DIFFERS')
    maintenance = state / 'certbot-permission-maintenance'
    maintenance.mkdir(mode=0o700, exist_ok=True); owned(maintenance, directory=True, private=True)
    content = owned(Path(__file__)).read_bytes()
    filename = 'guard-' + hashlib.sha256(content).hexdigest() + '.py'
    guard = maintenance / filename
    write_once(guard, content, mode=0o500)
    command = f'/usr/bin/python3 -B /home/{user}/village-autonomous/certbot-permission-maintenance/{filename} --guard'
    pending = []
    for kind, directive in [('tls', 'ExecStartPost'), ('backup', 'ExecStartPre')]:
        directory = units / f'village-autonomous-{kind}.service.d'
        destination = directory / '10-village-certbot-private.conf'
        value = f'[Service]\n{directive}={command}\n'.encode()
        if directory.is_symlink() or directory.exists() and not directory.is_dir(): raise ValueError('SYSTEM_DROPIN_DIRECTORY_REQUIRED')
        if destination.is_symlink() or destination.exists() and (
                not destination.is_file() or destination.stat().st_nlink != 1 or destination.read_bytes() != value):
            raise ValueError('EXISTING_CERTBOT_DROPIN_DIFFERS')
        source = maintenance / (kind + '.conf'); write_once(source, value)
        pending.append((source, directory, destination))
    if run is None:
        def run(*args):
            subprocess.run(['sudo', '-n', *map(str, args)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    for source, directory, destination in pending:
        run('install', '-d', '-o', 'root', '-g', 'root', '-m', '0755', '--', str(directory))
        run('install', '-o', 'root', '-g', 'root', '-m', '0644', '--', str(source), str(destination))
    run('systemctl', 'daemon-reload')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--guard', action='store_true')
    args = parser.parse_args()
    try:
        if os.name != 'posix' or os.geteuid() == 0: raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        state = Path.home() / 'village-autonomous'
        with tls_lock(state): changed = repair(state)
        if not args.guard:
            import pwd
            from autonomous_operator import operation_lock
            with operation_lock(state): install_hooks(state, pwd.getpwuid(os.geteuid()).pw_name)
        print('CERTBOT_PRIVATE_MODES_VERIFIED' if args.guard else 'CERTBOT_PRIVATE_MODES_AND_MAINTENANCE_HOOKS_VERIFIED')
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print('STOP: CERTBOT_PERMISSION_REPAIR_FAILED. Keep state and partial backups; no public switch was attempted.')
        return 1


if __name__ == '__main__': raise SystemExit(main())
