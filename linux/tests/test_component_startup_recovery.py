"""The real failure is an obsolete startup version gate, not missing Blender."""
import copy
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import urllib.error
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import component_rollout as rollout
import business_storage_copy as storage
from test_component_network_recovery import scenario


def recovery():
    import component_worker_startup_recovery
    return component_worker_startup_recovery


def inputs():
    receipt, rows, documents, network = scenario()
    worker = rows['village-platform-facade-worker-1']
    worker['State'].update(Status='restarting', Restarting=True, Pid=0, ExitCode=1, OOMKilled=False)
    attempt = {'containers': {name: row['Id'] for name, row in rows.items()}}
    return receipt, rows, documents, attempt


def test_plan_accepts_observed_restarting_worker_without_loosening_resource_guards():
    m = recovery()
    receipt, rows, documents, attempt = inputs()
    before = copy.deepcopy((receipt, rows, documents, attempt))
    m.validate_baseline(rollout, receipt, rows, documents, attempt)
    assert (receipt, rows, documents, attempt) == before


@pytest.mark.parametrize('change', ['image', 'id', 'env', 'resources', 'ml', 'compose', 'receipt', 'network'])
def test_unknown_drift_is_rejected_before_replacement(change):
    m = recovery()
    receipt, rows, documents, attempt = inputs()
    worker = rows['village-platform-facade-worker-1']
    if change == 'image': worker['Image'] = 'sha256:' + 'f' * 64
    elif change == 'id': worker['Id'] = '9' * 64
    elif change == 'env': worker['Config']['Env'].append('UNKNOWN=private-value')
    elif change == 'resources': worker['HostConfig']['Privileged'] = True
    elif change == 'ml': rows['village-platform-facade-ml-1']['State']['Health']['Status'] = 'unhealthy'
    elif change == 'compose': documents['village-platform-facade-worker-1']['updated']['services']['facade-worker']['command'] = ['wrong']
    elif change == 'receipt': receipt['operator_sha256'] = 'f' * 64
    elif change == 'network': worker['NetworkSettings']['Networks']['unknown'] = {}
    with pytest.raises(ValueError):
        m.validate_baseline(rollout, receipt, rows, documents, attempt)


def test_pinned_health_overlay_reuses_every_base_layer_and_changes_only_one_file(tmp_path):
    m = recovery()
    source = (Path(__file__).resolve().parents[2] / 'server/src/village_processing/health.py').read_text().encode()
    context = m.prepare_context(tmp_path, source, rollout)
    assert set(p.name for p in context.iterdir()) == {'Dockerfile', 'health.py'}
    assert (context / 'health.py').read_bytes() == source
    text = (context / 'Dockerfile').read_text()
    assert text.splitlines() == [
        'FROM village-component-health-base:3d8f777714d5',
        'COPY --chown=10001:10001 health.py /opt/village-components/village_processing/health.py',
    ]
    with pytest.raises(ValueError, match='STARTUP_HEALTH_SOURCE_CHANGED'):
        m.prepare_context(tmp_path, source + b'\n', rollout)


def test_recovery_document_preserves_env_gpu_volumes_command_and_other_services():
    m = recovery()
    _, _, documents, _ = inputs()
    old = documents['village-platform-facade-worker-1']['updated']
    new = m.replacement_document(old, 'sha256:' + 'c' * 64)
    expected = copy.deepcopy(old)
    expected['services']['facade-worker']['image'] = 'sha256:' + 'c' * 64
    assert new == expected
    assert old['services']['facade-worker']['image'].endswith('1307657ef3')


def test_recovery_can_import_original_helpers_without_putting_old_backend_first():
    m = recovery()
    _, _, documents, _ = inputs()
    old = documents['village-platform-facade-worker-1']['updated']
    result = m.replacement_document(old, 'sha256:' + 'c' * 64, pythonpath='/opt/village-components:/app')
    assert result['services']['facade-worker']['working_dir'] == '/opt/village-components'
    assert result['services']['facade-worker']['environment']['PYTHONPATH'] == '/opt/village-components:/app'
    assert result['services']['facade-worker']['environment']['KEEP'] == 'private-placeholder'


def test_a_transient_running_flag_cannot_be_worker_readiness():
    m = recovery()
    _, rows, _, _ = inputs()
    worker = rows['village-platform-facade-worker-1']
    worker['State']['Running'] = True
    assert not m.worker_alive(worker)
    worker['State'].update(Restarting=False, Pid=123)
    assert m.worker_alive(worker)
    worker['State']['OOMKilled'] = True
    assert not m.worker_alive(worker)


def test_complete_requires_actual_network_endpoints_not_only_container_metadata():
    m = recovery()
    _, rows, _, _ = inputs()
    worker = rows['village-platform-facade-worker-1']
    worker['State'].update(Restarting=False, Pid=123)
    worker['NetworkSettings']['Networks']['village-platform_facade-internal'] = {
        'NetworkID': 'a' * 64,
    }
    networks = {
        'village-platform_facade-internal': {'Id': 'a' * 64, 'Containers': {}},
        'village-platform_egress': {'Id': 'b' * 64, 'Containers': {}},
    }
    with pytest.raises(ValueError, match='STARTUP_NETWORK_ENDPOINT_MISSING'):
        m.validate_endpoints(worker, networks)
    for network in networks.values(): network['Containers'][worker['Id']] = {'Name': 'village-platform-facade-worker-1'}
    m.validate_endpoints(worker, networks)


def test_wait_requires_startup_log_success_stable_pid_and_no_restart(monkeypatch):
    m = recovery()
    _, rows, _, _ = inputs()
    worker = rows['village-platform-facade-worker-1']
    worker['RestartCount'] = 0
    worker['State'].update(Restarting=False, Pid=123, StartedAt='2026-10-26T09:00:00Z')
    now = [0]
    monkeypatch.setattr(m.time, 'monotonic', lambda: now[0])
    monkeypatch.setattr(m.time, 'sleep', lambda value: now.__setitem__(0, now[0] + value))
    class Docker:
        def inspect(self, name): return copy.deepcopy(worker)
        def run(self, *args): return 'BLENDER_RUNTIME=OK\nFACADE_ML=OK\nFACADE_LAMA=OK\nALIYUN_GATEWAY=OK\n'
    result = m.wait_ready(Docker(), worker['Id'], timeout=30)
    assert result['Id'] == worker['Id']
    assert now[0] >= 10
    worker['State'].update(Restarting=True, Pid=0)
    with pytest.raises(ValueError, match='STARTUP_WORKER_NOT_READY'):
        m.wait_ready(Docker(), worker['Id'], timeout=5)


@pytest.mark.parametrize('stale', [False, True])
def test_wait_accepts_delayed_current_marker_but_never_an_old_process_marker(monkeypatch, stale):
    m = recovery()
    _, rows, _, _ = inputs()
    worker = rows['village-platform-facade-worker-1']
    worker['State'].update(Restarting=False, Pid=123, StartedAt='2026-10-26T09:00:00Z')
    now = [0]
    monkeypatch.setattr(m.time, 'monotonic', lambda: now[0])
    monkeypatch.setattr(m.time, 'sleep', lambda value: now.__setitem__(0, now[0] + value))
    class Docker:
        def inspect(self, name): return copy.deepcopy(worker)
        def run(self, *args):
            marker = 'BLENDER_RUNTIME=OK\nFACADE_ML=OK\nFACADE_LAMA=OK\nALIYUN_GATEWAY=OK\n'
            if stale: return '' if '--since' in args else marker
            return marker if now[0] >= 2 else ''
    if stale:
        with pytest.raises(ValueError, match='STARTUP_WORKER_NOT_READY'):
            m.wait_ready(Docker(), worker['Id'], timeout=30)
    else:
        assert m.wait_ready(Docker(), worker['Id'], timeout=30)['Id'] == worker['Id']
        assert now[0] >= 12


def test_final_receipt_preserves_original_operator_and_original_before_snapshots(tmp_path):
    m = recovery()
    receipt, rows, _, _ = inputs()
    storage.write_private_json(tmp_path / 'receipt.json', receipt)
    proof = copy.deepcopy(receipt['blender_runtime_smoke'])
    proof['image'] = 'sha256:' + 'c' * 64
    progress = {'image': proof['image'], 'smoke': proof, 'phase': 'replaced'}
    m.complete_receipt(tmp_path, receipt, rows, progress, storage)
    final = storage.read_private_json(tmp_path / 'receipt.json')
    assert final['phase'] == 'complete'
    assert final['before'] == receipt['before']
    assert final['operator_sha256'] == receipt['operator_sha256']
    assert final['images']['village-platform-facade-worker-1'] == proof['image']
    assert final['blender_runtime_smoke'] == proof
    assert storage.read_private_json(tmp_path / 'receipt-before-startup-recovery.json') == receipt


def test_real_health_copy_overlay_preserves_image_configuration_and_nonroot_access(tmp_path, monkeypatch):
    if sys.platform != 'linux' or os.environ.get('GITHUB_ACTIONS') != 'true':
        pytest.skip('Actual images are restricted to disposable Linux CI')
    m = recovery()
    prefix = ['sudo', '-n', 'docker', '--context', 'default']
    def docker(*args):
        return subprocess.run([*prefix, *map(str, args)], capture_output=True, text=True,
                              check=True, timeout=120).stdout
    images = []
    try:
        for relative, content in [('legacy/experiments/__init__.py', "ORIGIN='legacy-helper'\n"),
                                  ('legacy/rural_house_generator/__init__.py', "ORIGIN='old-backend'\n"),
                                  ('overlay/rural_house_generator/__init__.py', "ORIGIN='new-backend'\n")]:
            path = tmp_path / relative;path.parent.mkdir(parents=True, exist_ok=True);path.write_text(content)
        basefile = tmp_path / 'base.Dockerfile'
        basefile.write_text('FROM python:3.10.18-slim\nENV PYTHONPATH=/opt/village-components\n'
                            'COPY legacy /app\nCOPY overlay /opt/village-components\n'
                            'USER 10001:10001\nWORKDIR /opt/village-components\n'
                            'CMD ["python","-c","import time;time.sleep(120)"]\n')
        base = docker('build', '-q', '-f', basefile, tmp_path).strip();images.append(base)
        monkeypatch.setitem(m.IMAGES, m.WORKER, base)
        docker('tag', base, m.base_reference())
        source = (Path(__file__).resolve().parents[2] / 'server/src/village_processing/health.py').read_bytes()
        context = m.prepare_context(tmp_path, source, rollout)
        image = docker('build', '--pull=false', '--network=none', '-q', context).strip();images.append(image)
        a, b = [json.loads(docker('image', 'inspect', value))[0] for value in (base, image)]
        assert a['Config'] == b['Config']
        assert b['RootFS']['Layers'][:-1] == a['RootFS']['Layers']
        code = "import hashlib,os;assert os.getuid()==10001;assert hashlib.sha256(open('/opt/village-components/village_processing/health.py','rb').read()).hexdigest()=='2a74dc3ae6b30234e2f9156ac81cd6c375dc5c4bf27ad48e61cd6b805dd2cc9e'"
        docker('run', '--rm', '--read-only', '--network=none', '--entrypoint', 'python', image, '-c', code)
        with pytest.raises(subprocess.CalledProcessError):
            docker('run', '--rm', '--network=none', '--entrypoint', 'python', image, '-c', 'import experiments')
        code = "import experiments,rural_house_generator;assert experiments.ORIGIN=='legacy-helper';assert rural_house_generator.ORIGIN=='new-backend'"
        docker('run', '--rm', '--read-only', '--network=none', '--env', 'PYTHONPATH=/opt/village-components:/app',
               '--entrypoint', 'python', image, '-c', code)
    finally:
        subprocess.run([*prefix, 'image', 'rm', m.base_reference()], capture_output=True)
        for image in reversed(images): subprocess.run([*prefix, 'image', 'rm', image], capture_output=True)


@pytest.mark.parametrize('failure', [None, 'import', 'identity', 'source_first'])
def test_recovery_executes_targeted_update_and_never_completes_failed_checks(tmp_path, monkeypatch, failure):
    m = recovery()
    import component_worker_network_recovery as helper
    receipt, rows, documents, attempt = inputs()
    for name, docs in documents.items():
        service = 'facade-worker' if name == m.WORKER else 'facade-ml'
        for suffix, key in (('-original.json', 'original'), ('.json', 'updated')):
            storage.write_private_json(tmp_path / (service + suffix), docs[key])
    storage.write_private_json(tmp_path / 'receipt.json', receipt)
    storage.write_private_json(tmp_path / 'network-recovery-attempt.json', attempt)
    context = tmp_path / 'startup-health-recovery/build-context';context.mkdir(parents=True, mode=0o700)
    context.joinpath('health.py').write_bytes((Path(__file__).resolve().parents[2] / 'server/src/village_processing/health.py').read_text().encode())
    downloads = []
    if failure == 'source_first':
        source = context.joinpath('health.py').read_bytes();context.joinpath('health.py').unlink()
        def download(request, **kwargs):
            downloads.append(request.full_url)
            if len(downloads) == 1: raise urllib.error.HTTPError(request.full_url, 403, 'fixture', {}, None)
            return io.BytesIO(source)
        monkeypatch.setattr(m.urllib.request, 'urlopen', download)
    now = [0]
    monkeypatch.setattr(m.time, 'monotonic', lambda: now[0])
    monkeypatch.setattr(m.time, 'sleep', lambda value: now.__setitem__(0, now[0] + value))
    class Docker:
        state = tmp_path
        def __init__(self): self.rows = copy.deepcopy(rows);self.stops = 0;self.builds = 0;self.failure = failure
        def inspect(self, name): return copy.deepcopy(self.rows[name])
        def run(self, *args, **kwargs):
            if args == ('ps', '-aq'): return ''
            if args[:2] == ('network', 'inspect'):
                name = args[2];network_id = 'a' * 64 if name.endswith('internal') else 'b' * 64
                return json.dumps([{'Name': name, 'Id': network_id,
                                    'Containers': {self.rows[m.WORKER]['Id']: {'Name': m.WORKER}}}])
            if args[0] == 'build': self.builds += 1;return 'sha256:' + 'c' * 64
            if args[0] == 'tag': return ''
            if args[:2] == ('image', 'inspect'):
                layers = ['base'] + (['health'] if args[2].endswith('c' * 64) else [])
                image_id = 'sha256:' + 'c' * 64 if args[2].endswith('c' * 64) else m.IMAGES[m.WORKER]
                return json.dumps([{'Id': image_id, 'Config': {'User': '10001:10001'}, 'RootFS': {'Layers': layers},
                                    'Os': 'linux', 'Architecture': 'amd64'}])
            if args[0] == 'run':
                if self.failure == 'import' and '__main__,health' in args[-1]: raise RuntimeError('DOCKER_OPERATION_FAILED')
                if 'COMPONENT_BLENDER_SMOKE ' in args[-1]:
                    return 'COMPONENT_BLENDER_SMOKE ' + json.dumps({'version': [3,6,23], 'glb_bytes': 100,
                          'png_bytes': 100, 'render_engine': 'CYCLES', 'view_transform': 'Filmic'})
                return ''
            if args[0] == 'stop': self.stops += 1;return ''
            if args[0] == 'compose':
                document = storage.read_private_json(Path(args[args.index('-f')+1]))
                self.rows[m.WORKER].update(Image=document['services']['facade-worker']['image'], Id='c' * 64, RestartCount=0)
                row = self.rows[m.WORKER]
                env = rollout.environment(row['Config']['Env'])
                env['PYTHONPATH'] = document['services']['facade-worker']['environment']['PYTHONPATH']
                row['Config']['Env'] = [k + '=' + v for k, v in env.items()]
                row['State'].update(Running=True, Restarting=False, Pid=123, StartedAt='2026-10-26T09:00:00Z')
                row['NetworkSettings']['Networks']['village-platform_facade-internal'] = {'NetworkID': 'a' * 64}
                return ''
            if args[0] == 'logs': return 'BLENDER_RUNTIME=OK\nFACADE_ML=OK\nFACADE_LAMA=OK\nALIYUN_GATEWAY=OK\n'
            if args[0] == 'exec':
                if self.failure == 'identity' and 'verify_identity' in args[-1]: raise RuntimeError('DOCKER_OPERATION_FAILED')
                return ''
            pytest.fail(f'Unexpected Docker operation {args[:2]}')
    docker = Docker()
    if failure in ('import', 'identity'):
        with pytest.raises(RuntimeError, match='DOCKER_OPERATION_FAILED'):
            m.recover(tmp_path, docker, rollout, storage, helper, apply=True)
        assert storage.read_private_json(tmp_path / 'receipt.json') == receipt
        assert docker.stops == (0 if failure == 'import' else 1)
        docker.failure = None
    result = m.recover(tmp_path, docker, rollout, storage, helper, apply=True)
    assert result['status'] == 'component_worker_startup_recovered_real_photo_test_pending'
    assert docker.stops == 1
    assert docker.builds == (2 if failure == 'import' else 1)
    assert storage.read_private_json(tmp_path / 'receipt.json')['phase'] == 'complete'
    if failure == 'source_first': assert len(downloads) == 2
