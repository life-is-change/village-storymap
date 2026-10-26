"""Recover the observed prepared rollout without replacing its baseline."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import component_rollout as rollout
import business_storage_copy as storage


def recovery():
    import component_worker_network_recovery
    return component_worker_network_recovery


def scenario():
    from test_component_rollout import fixture
    worker = 'village-platform-facade-worker-1'
    ml = 'village-platform-facade-ml-1'
    internal = 'village-platform_facade-internal'
    egress = 'village-platform_egress'
    images = {
        worker: 'sha256:3d8f777714d5b611f2312a29f3a606e9c234b4a92b3181c87133cd1307657ef3',
        ml: 'sha256:a38a7be2a34018802047f88d9692256f4f6d21801559c211ba64c692ccb3a123',
    }
    before, current, documents = {}, {}, {}
    for index, name in enumerate((worker, ml), 1):
        service = 'facade-worker' if name == worker else 'facade-ml'
        old, doc, _ = fixture(service)
        old.update(Id=str(index + 2) * 64, Image=rollout.OBSERVED[name],
                   State={'Running': True, 'Health': {'Status': 'healthy'}})
        old['NetworkSettings']['Networks'][internal] = {
            'NetworkID': 'a' * 64, 'Aliases': [name, service],
            'IPAMConfig': None, 'DriverOpts': None, 'Links': None,
        }
        if name == worker:
            doc['networks']['egress'] = {'name': egress}
            doc['services'][service]['networks']['egress'] = {}
            old['NetworkSettings']['Networks'][egress] = {
                'NetworkID': 'b' * 64, 'Aliases': [name, service],
            }
        doc = rollout.external_networks(doc)
        doc['services'][service]['image'] = old['Image']
        updated = copy.deepcopy(doc)
        updated['services'][service]['image'] = images[name]
        updated['services'][service]['working_dir'] = '/opt/village-components'
        if name == worker:
            updated['services'][service]['environment']['BLENDER_EXECUTABLE'] = rollout.BLENDER
        documents[name] = {'original': doc, 'updated': updated}
        before[name] = old
        new = copy.deepcopy(old)
        new.update(Id=str(index) * 64, Image=images[name])
        new['Config']['WorkingDir'] = '/opt/village-components'
        new['Config']['Env'].append('PYTHONPATH=/opt/village-components')
        if name == worker:
            new['Config']['Env'].append('BLENDER_EXECUTABLE=' + rollout.BLENDER)
            del new['NetworkSettings']['Networks'][internal]
        current[name] = new
    smoke = {'image': images[worker], 'version': [3, 6, 23], 'glb_bytes': 100,
             'png_bytes': 100, 'render_engine': 'CYCLES', 'view_transform': 'Filmic'}
    receipt = {'phase': 'prepared', 'kind': 'worker',
               'commit': 'af39f0411ac638d360d10e2c4d57e5d8c56ed929',
               'operator_sha256': '274927ea7c2d96ea7c12559c756a959836a89de99a15389c0992a713218e925d',
               'before': before, 'images': images, 'other': {}, 'blender_runtime_smoke': smoke}
    network = {'Id': 'a' * 64, 'Name': internal, 'Driver': 'bridge', 'Internal': True}
    return receipt, current, documents, network


def test_plan_restores_only_observed_internal_network_with_original_aliases():
    m = recovery()
    receipt, current, documents, network = scenario()
    original = copy.deepcopy((receipt, current, documents, network))
    plan = m.recovery_plan(rollout, receipt, current, documents, network)
    assert plan['missing'] is True
    assert plan['network'] == 'village-platform_facade-internal'
    assert plan['network_id'] == 'a' * 64
    assert plan['container_id'] == '1' * 64
    assert plan['aliases'] == ['village-platform-facade-worker-1', 'facade-worker']
    assert (receipt, current, documents, network) == original


@pytest.mark.parametrize('change', [
    'wrong_operator', 'wrong_commit', 'wrong_image', 'resource', 'environment',
    'working_dir', 'unexpected_network', 'missing_egress', 'ml_network',
    'recreated_network', 'public_network', 'static_ip', 'driver_options',
    'aliases', 'compose_omits_network', 'compose_changed', 'stopped', 'unhealthy_ml',
])
def test_drift_is_rejected_before_any_recovery_mutation(change):
    m = recovery()
    receipt, current, documents, network = scenario()
    worker, ml = list(current)
    endpoint = receipt['before'][worker]['NetworkSettings']['Networks'][network['Name']]
    if change == 'wrong_operator': receipt['operator_sha256'] = '0' * 64
    elif change == 'wrong_commit': receipt['commit'] = '0' * 40
    elif change == 'wrong_image': current[worker]['Image'] = 'sha256:' + '0' * 64
    elif change == 'resource': current[worker]['HostConfig']['Privileged'] = True
    elif change == 'environment': current[worker]['Config']['Env'].append('KEEP=changed-secret')
    elif change == 'working_dir': current[worker]['Config']['WorkingDir'] = '/wrong'
    elif change == 'unexpected_network': current[worker]['NetworkSettings']['Networks']['unknown'] = {}
    elif change == 'missing_egress': current[worker]['NetworkSettings']['Networks'].clear()
    elif change == 'ml_network': current[ml]['NetworkSettings']['Networks'].clear()
    elif change == 'recreated_network': network['Id'] = 'c' * 64
    elif change == 'public_network': network['Internal'] = False
    elif change == 'static_ip': endpoint['IPAMConfig'] = {'IPv4Address': '172.20.0.20'}
    elif change == 'driver_options': endpoint['DriverOpts'] = {'unknown': 'value'}
    elif change == 'aliases': endpoint['Aliases'].append('unknown')
    elif change == 'compose_omits_network': documents[worker]['updated']['services']['facade-worker']['networks'].pop('internal')
    elif change == 'compose_changed': documents[worker]['updated']['services']['facade-worker']['privileged'] = True
    elif change == 'stopped': current[worker]['State']['Running'] = False
    elif change == 'unhealthy_ml': current[ml]['State']['Health']['Status'] = 'unhealthy'
    with pytest.raises(ValueError) as error:
        m.recovery_plan(rollout, receipt, current, documents, network)
    assert 'changed-secret' not in str(error.value)


class Engine:
    def __init__(self, current, network, *, fail=None):
        self.current = copy.deepcopy(current)
        self.network = network
        self.fail = fail
        self.connections = 0

    def inspect(self, name): return copy.deepcopy(self.current[name])

    def run(self, *args, **kwargs):
        if args[:2] == ('network', 'inspect'): return json.dumps([self.network])
        if args[:2] == ('network', 'connect'):
            self.connections += 1
            assert args == ('network', 'connect', '--alias', 'village-platform-facade-worker-1',
                            '--alias', 'facade-worker', 'a' * 64, '1' * 64)
            self.current['village-platform-facade-worker-1']['NetworkSettings']['Networks'][self.network['Name']] = {
                'NetworkID': self.network['Id'],
                'Aliases': ['village-platform-facade-worker-1', 'facade-worker'],
            }
            if self.fail == 'after_connect': raise RuntimeError('DOCKER_OPERATION_FAILED')
            return ''
        if args == ('ps', '-aq'): return ''
        if args[0] == 'exec':
            if self.fail == 'identity' and 'verify_identity' in args[-1]:
                raise RuntimeError('DOCKER_OPERATION_FAILED')
            if self.fail == 'ml_health' and 'urlopen' in args[-1]:
                raise RuntimeError('DOCKER_OPERATION_FAILED')
            return 'Blender 3.6.23\n' if args[-1] == '--version' else ''
        pytest.fail(f'Unexpected Docker operation {args[:2]}')


def prepared(tmp_path):
    receipt, current, documents, network = scenario()
    for name, docs in documents.items():
        service = 'facade-worker' if name.endswith('worker-1') else 'facade-ml'
        storage.write_private_json(tmp_path / (service + '-original.json'), docs['original'])
        storage.write_private_json(tmp_path / (service + '.json'), docs['updated'])
    storage.write_private_json(tmp_path / 'receipt.json', receipt)
    storage.write_private_json(tmp_path / 'blender-runtime-smoke.json', receipt['blender_runtime_smoke'])
    engine = Engine(current, network)
    engine.state = tmp_path
    return receipt, engine


def test_check_does_not_connect_or_complete_receipt(tmp_path):
    m = recovery()
    receipt, engine = prepared(tmp_path)
    result = m.recover(tmp_path, engine, rollout, storage, apply=False)
    assert result['status'] == 'component_worker_network_recovery_preflight_passed'
    assert engine.connections == 0
    assert storage.read_private_json(tmp_path / 'receipt.json') == receipt


def test_recovery_preserves_original_receipt_and_completes_only_after_runtime_checks(tmp_path):
    m = recovery()
    receipt, engine = prepared(tmp_path)
    result = m.recover(tmp_path, engine, rollout, storage, apply=True)
    assert result['status'] == 'component_workers_network_recovered_real_photo_test_pending'
    assert engine.connections == 1
    assert storage.read_private_json(tmp_path / 'receipt-before-network-recovery.json') == receipt
    after = storage.read_private_json(tmp_path / 'receipt.json')
    assert after['phase'] == 'complete'
    assert after['before'] == receipt['before']
    assert after['operator_sha256'] == receipt['operator_sha256']
    assert after['after'] == {'village-platform-facade-worker-1': '1' * 64,
                              'village-platform-facade-ml-1': '2' * 64}
    m.recover(tmp_path, engine, rollout, storage, apply=True)
    assert engine.connections == 1


@pytest.mark.parametrize('failure', ['identity', 'ml_health', 'after_connect'])
def test_failed_checks_keep_prepared_receipt_and_retry_does_not_reconnect(tmp_path, failure):
    m = recovery()
    receipt, engine = prepared(tmp_path)
    engine.fail = failure
    with pytest.raises(RuntimeError, match='DOCKER_OPERATION_FAILED'):
        m.recover(tmp_path, engine, rollout, storage, apply=True)
    assert storage.read_private_json(tmp_path / 'receipt.json') == receipt
    assert engine.connections == 1
    engine.fail = None
    m.recover(tmp_path, engine, rollout, storage, apply=True)
    assert engine.connections == 1
    assert storage.read_private_json(tmp_path / 'receipt.json')['phase'] == 'complete'


def test_retry_rejects_a_replaced_container_instead_of_accepting_new_baseline(tmp_path):
    m = recovery()
    receipt, engine = prepared(tmp_path)
    engine.fail = 'identity'
    with pytest.raises(RuntimeError):
        m.recover(tmp_path, engine, rollout, storage, apply=True)
    engine.fail = None
    engine.current['village-platform-facade-worker-1']['Id'] = '9' * 64
    with pytest.raises(ValueError, match='RECOVERY_ATTEMPT_IDENTITY_CHANGED'):
        m.recover(tmp_path, engine, rollout, storage, apply=True)
    assert storage.read_private_json(tmp_path / 'receipt.json') == receipt


def test_already_connected_endpoint_requires_original_dns_aliases(tmp_path):
    m = recovery()
    receipt, engine = prepared(tmp_path)
    engine.current['village-platform-facade-worker-1']['NetworkSettings']['Networks']['village-platform_facade-internal'] = {
        'NetworkID': 'a' * 64, 'Aliases': ['wrong-alias'],
    }
    with pytest.raises(ValueError, match='RECOVERY_NETWORK_ALIASES_CHANGED'):
        m.recover(tmp_path, engine, rollout, storage, apply=True)
    assert storage.read_private_json(tmp_path / 'receipt.json') == receipt
    assert engine.connections == 0


def test_startup_accepts_original_public_operator_inside_private_state(tmp_path):
    m = recovery()
    # Use the real pinned producer, including its intentional mode0644.
    path = rollout.write_public(tmp_path, 'operator.py', Path(rollout.__file__).read_bytes())
    if sys.platform == 'linux': assert path.stat().st_mode & 0o777 == 0o644
    loaded = m.load_observed_operator(tmp_path)
    assert loaded.operator_digest() == '274927ea7c2d96ea7c12559c756a959836a89de99a15389c0992a713218e925d'


@pytest.mark.parametrize('change', ['bytes', 'group_writable'])
def test_startup_rejects_modified_or_group_writable_operator(tmp_path, change):
    m = recovery()
    path = rollout.write_public(tmp_path, 'operator.py', Path(rollout.__file__).read_bytes())
    if change == 'bytes': path.write_bytes(path.read_bytes() + b'\n# changed\n')
    else:
        if sys.platform != 'linux': pytest.skip('POSIX write permissions require Linux')
        path.chmod(0o664)
    with pytest.raises(ValueError, match='ORIGINAL_ROLLOUT_OPERATOR_CHANGED'):
        m.load_observed_operator(tmp_path)


def test_real_docker_reconnect_restores_internal_service_dns_without_restart(tmp_path):
    if sys.platform != 'linux' or os.environ.get('GITHUB_ACTIONS') != 'true':
        pytest.skip('Real network mutation restricted to disposable Linux CI')
    m = recovery()
    tag = 'component-net-' + uuid.uuid4().hex[:10]
    internal, egress, worker, ml = (tag + suffix for suffix in ('-internal', '-egress', '-worker', '-ml'))
    class RealDocker:
        def run(self, *args, **kwargs):
            return subprocess.run(['sudo', '-n', 'docker', '--context', 'default', *args],
                                  capture_output=True, text=True, check=True, timeout=120).stdout
    docker = RealDocker()
    image = 'python:3.10.18-slim'
    try:
        docker.run('pull', image)
        internal_id = docker.run('network', 'create', '--internal', internal).strip()
        docker.run('network', 'create', egress)
        code = "from http.server import BaseHTTPRequestHandler,HTTPServer\nclass H(BaseHTTPRequestHandler):\n def do_GET(self):\n  self.send_response(200);self.end_headers();self.wfile.write(b'{\"components_version\":1}')\nHTTPServer(('0.0.0.0',8012),H).serve_forever()"
        docker.run('run', '-d', '--name', ml, '--network', internal, '--network-alias', 'facade-ml', image, 'python', '-c', code)
        worker_id = docker.run('run', '-d', '--name', worker, '--network', egress, image,
                               'python', '-c', 'import time;time.sleep(120)').strip()
        request = "import urllib.request,json;assert json.load(urllib.request.urlopen('http://facade-ml:8012/health',timeout=2))['components_version']==1"
        with pytest.raises(subprocess.CalledProcessError): docker.run('exec', worker, 'python', '-c', request)
        m.connect_endpoint(docker, {'network_id': internal_id, 'container_id': worker_id,
                                   'aliases': [worker, 'facade-worker']})
        for attempt in range(15):
            try:
                docker.run('exec', worker, 'python', '-c', request)
                break
            except subprocess.CalledProcessError:
                if attempt == 14: raise
                time.sleep(1)
        row = json.loads(docker.run('inspect', worker))[0]
        assert row['Id'] == worker_id
        assert set(row['NetworkSettings']['Networks']) == {internal, egress}
        assert set(row['NetworkSettings']['Networks'][internal]['Aliases']) >= {worker, 'facade-worker'}
        assert row['RestartCount'] == 0
    finally:
        subprocess.run(['sudo', '-n', 'docker', 'rm', '-f', worker, ml], capture_output=True)
        subprocess.run(['sudo', '-n', 'docker', 'network', 'rm', internal, egress], capture_output=True)
