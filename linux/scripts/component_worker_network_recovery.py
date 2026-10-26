#!/usr/bin/env python3
"""Finish the observed ab908db rollout by restoring its one missing endpoint.

No image build, container recreation, Compose change, network creation, source
replacement or baseline reset. All original post-update guards remain required.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

COMMIT = 'af39f0411ac638d360d10e2c4d57e5d8c56ed929'
OPERATOR_SHA = '274927ea7c2d96ea7c12559c756a959836a89de99a15389c0992a713218e925d'
BASE = Path('/media/gpu332/newapply/village-platform/deploy/components')
WORKER = 'village-platform-facade-worker-1'
ML = 'village-platform-facade-ml-1'
INTERNAL = 'village-platform_facade-internal'
EGRESS = 'village-platform_egress'
IMAGES = {
    WORKER: 'sha256:3d8f777714d5b611f2312a29f3a606e9c234b4a92b3181c87133cd1307657ef3',
    ML: 'sha256:a38a7be2a34018802047f88d9692256f4f6d21801559c211ba64c692ccb3a123',
}
ALIASES = [WORKER, 'facade-worker']
IDENTITY_CHECK = ("from village_processing.local_task_http import LocalTaskHTTP;"
                  "h=LocalTaskHTTP(key_file='/run/secrets/aliyun-worker-key',kind='facade');"
                  "h.verify_identity();h.close()")
ML_CHECK = ("import urllib.request,json;assert json.load(urllib.request.urlopen("
            "'http://facade-ml:8012/health',timeout=15))['components_version']==1")


def recovery_plan(m, receipt, current, documents, network):
    if (receipt.get('phase') not in ('prepared', 'complete') or receipt.get('kind') != 'worker'
            or receipt.get('commit') != COMMIT or receipt.get('operator_sha256') != OPERATOR_SHA
            or receipt.get('images') != IMAGES or set(receipt.get('before', {})) != set(IMAGES)
            or set(current) != set(IMAGES) or set(documents) != set(IMAGES)):
        raise ValueError('OBSERVED_PREPARED_ROLLOUT_REQUIRED')
    for name, row in current.items():
        before = receipt['before'][name]
        service = 'facade-worker' if name == WORKER else 'facade-ml'
        if (before.get('Image') != m.OBSERVED[name] or before.get('Name') != '/' + name
                or row.get('Name') != '/' + name or row.get('Image') != IMAGES[name]
                or not re.fullmatch('[a-f0-9]{64}', row.get('Id', ''))
                or not row.get('State', {}).get('Running')
                or row.get('Config', {}).get('WorkingDir') != '/opt/village-components'):
            raise ValueError('RECOVERY_CONTAINER_IDENTITY_CHANGED')
        if name == ML and row['State'].get('Health', {}).get('Status') != 'healthy':
            raise ValueError('RECOVERY_ML_NOT_HEALTHY')
        original, updated = documents[name]['original'], documents[name]['updated']
        if (original['services'][service]['image'] != before['Image']
                or m.worker_document(original, service, IMAGES[name]) != updated):
            raise ValueError('RECOVERY_SAVED_COMPOSE_CHANGED')
        planned_networks = {updated['networks'][key]['name']
                            for key in updated['services'][service].get('networks', {})}
        endpoints = before['NetworkSettings']['Networks']
        if planned_networks != set(endpoints):
            raise ValueError('RECOVERY_DECLARED_NETWORKS_CHANGED')
        a, b = m.resource_snapshot(before), m.resource_snapshot(row)
        if name == WORKER:
            a.pop('networks'); b.pop('networks')
        if a != b:
            raise ValueError('RECOVERY_UNRELATED_RESOURCES_CHANGED')
        allowed = ('PYTHONPATH', 'BLENDER_EXECUTABLE')
        old_env, new_env = m.environment(before['Config']['Env']), m.environment(row['Config']['Env'])
        if ({k: v for k, v in old_env.items() if k not in allowed}
                != {k: v for k, v in new_env.items() if k not in allowed}):
            raise ValueError('RECOVERY_ENVIRONMENT_CHANGED')
        if (not new_env.get('PYTHONPATH', '').split(':')[0] == '/opt/village-components'
                or name == WORKER and new_env.get('BLENDER_EXECUTABLE') != m.BLENDER):
            raise ValueError('RECOVERY_COMPONENT_RUNTIME_CHANGED')
        # IP allocation changes on recreation, but the network identity must not.
        for key, endpoint in row['NetworkSettings']['Networks'].items():
            if key not in endpoints or endpoint.get('NetworkID') != endpoints[key].get('NetworkID'):
                raise ValueError('RECOVERY_NETWORK_IDENTITY_CHANGED')
    old = receipt['before'][WORKER]['NetworkSettings']['Networks']
    now = current[WORKER]['NetworkSettings']['Networks']
    if set(old) != {INTERNAL, EGRESS} or set(now) not in ({EGRESS}, {INTERNAL, EGRESS}):
        raise ValueError('ONLY_OBSERVED_INTERNAL_ENDPOINT_CAN_BE_RECOVERED')
    endpoint = old[INTERNAL]
    if (network.get('Name') != INTERNAL or network.get('Id') != endpoint.get('NetworkID')
            or not re.fullmatch('[a-f0-9]{64}', network.get('Id', ''))
            or network.get('Driver') != 'bridge' or network.get('Internal') is not True
            or endpoint.get('Aliases') != ALIASES
            or any(endpoint.get(key) for key in ('IPAMConfig', 'DriverOpts', 'Links'))):
        raise ValueError('OBSERVED_INTERNAL_NETWORK_REQUIRED')
    if INTERNAL in now and set(now[INTERNAL].get('Aliases') or []) != set(ALIASES):
        raise ValueError('RECOVERY_NETWORK_ALIASES_CHANGED')
    if receipt['phase'] == 'complete' and (INTERNAL not in now or receipt.get('after') != {
            name: row['Id'] for name, row in current.items()}):
        raise ValueError('COMPLETED_ROLLOUT_CHANGED')
    return {'missing': INTERNAL not in now, 'network': INTERNAL, 'network_id': network['Id'],
            'container_id': current[WORKER]['Id'], 'aliases': list(ALIASES)}


def connect_endpoint(docker, plan):
    # Exact IDs avoid attaching a concurrent name replacement to any network.
    args = ['network', 'connect']
    for alias in plan['aliases']:
        args += ['--alias', alias]
    docker.run(*args, plan['network_id'], plan['container_id'])


def load_observed_operator(state):
    # The original producer intentionally writes operator.py as0644 inside
    # its private0700 state. It is public code, not a confidential credential.
    operator = state / 'operator.py'
    if any(path.is_symlink() for path in (operator, *operator.parents)):
        raise ValueError('ORIGINAL_ROLLOUT_OPERATOR_CHANGED')
    info = operator.stat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or sys.platform == 'linux' and (info.st_uid != os.geteuid() or info.st_mode & 0o022)
            or hashlib.sha256(operator.read_bytes()).hexdigest() != OPERATOR_SHA):
        raise ValueError('ORIGINAL_ROLLOUT_OPERATOR_CHANGED')
    spec = importlib.util.spec_from_file_location('observed_component_rollout', operator)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def recover(state, docker, m, storage, *, apply):
    receipt = storage.read_private_json(state / 'receipt.json')
    documents = {}
    for name in IMAGES:
        service = 'facade-worker' if name == WORKER else 'facade-ml'
        documents[name] = {'original': storage.read_private_json(state / (service + '-original.json')),
                           'updated': storage.read_private_json(state / (service + '.json'))}

    def inspect_plan():
        rows = {name: docker.inspect(name) for name in IMAGES}
        network = json.loads(docker.run('network', 'inspect', INTERNAL))
        if len(network) != 1:
            raise ValueError('OBSERVED_INTERNAL_NETWORK_REQUIRED')
        plan = recovery_plan(m, receipt, rows, documents, network[0])
        if m.all_other(docker, IMAGES) != receipt['other']:
            raise ValueError('RECOVERY_OTHER_SERVICES_CHANGED')
        return rows, plan

    rows, plan = inspect_plan()
    proof = receipt.get('blender_runtime_smoke', {})
    if (proof != storage.read_private_json(state / 'blender-runtime-smoke.json')
            or proof.get('image') != IMAGES[WORKER] or proof.get('version') != [3, 6, 23]
            or proof.get('glb_bytes', 0) < 20 or proof.get('png_bytes', 0) < 8
            or proof.get('render_engine') != 'CYCLES' or proof.get('view_transform') != 'Filmic'):
        raise ValueError('RECOVERY_VERIFIED_BLENDER_SMOKE_REQUIRED')
    if not apply:
        return {'status': 'component_worker_network_recovery_preflight_passed', 'connection_needed': plan['missing']}

    ids = {name: row['Id'] for name, row in rows.items()}
    attempt = {'version': 1, 'commit': COMMIT, 'operator_sha256': OPERATOR_SHA,
               'containers': ids, 'images': IMAGES, 'network_id': plan['network_id']}
    checkpoint = state / 'network-recovery-attempt.json'
    if checkpoint.exists():
        if storage.read_private_json(checkpoint) != attempt:
            raise ValueError('RECOVERY_ATTEMPT_IDENTITY_CHANGED')
    else:
        storage.write_private_json(checkpoint, attempt)
    backup = state / 'receipt-before-network-recovery.json'
    if receipt['phase'] == 'prepared':
        if backup.exists():
            if storage.read_private_json(backup) != receipt:
                raise ValueError('RECOVERY_ORIGINAL_RECEIPT_CHANGED')
        else:
            storage.write_private_json(backup, receipt)
    fresh, latest = inspect_plan()
    if ids != {name: row['Id'] for name, row in fresh.items()} or latest != plan:
        raise ValueError('RECOVERY_CONTAINERS_CHANGED_DURING_CHECK')
    if plan['missing']:
        print(json.dumps({'stage': 'restore_worker_internal_network', 'status': 'started'}), flush=True)
        connect_endpoint(docker, plan)
        print(json.dumps({'stage': 'restore_worker_internal_network', 'status': 'passed'}), flush=True)
    rows, restored = inspect_plan()
    if restored['missing'] or ids != {name: row['Id'] for name, row in rows.items()}:
        raise ValueError('RECOVERY_ENDPOINT_NOT_RESTORED')
    for name, row in rows.items():
        if m.resource_snapshot(row) != m.resource_snapshot(receipt['before'][name]):
            raise ValueError('RECOVERY_POST_UPDATE_RESOURCES_CHANGED')
    for service, name in (('facade-worker', WORKER), ('facade-ml', ML)):
        m.docker_step(docker, 'verify_' + service + '_imports', 'exec', name,
                      'python', '-c', m.component_import_smoke(service), timeout=60)
    m.docker_step(docker, 'verify_worker_aliyun_identity', 'exec', WORKER,
                  'python', '-c', IDENTITY_CHECK, timeout=60)
    m.docker_step(docker, 'verify_worker_to_ml', 'exec', WORKER,
                  'python', '-c', ML_CHECK, timeout=30)
    output = m.docker_step(docker, 'verify_worker_blender', 'exec', WORKER, m.BLENDER, '--version', timeout=30)
    if not re.search(r'^Blender 3\.6\.23\s*$', output, re.M):
        raise ValueError('RECOVERY_BLENDER_VERSION_CHANGED')
    final, plan = inspect_plan()
    if plan['missing'] or ids != {name: row['Id'] for name, row in final.items()}:
        raise ValueError('RECOVERY_CONTAINERS_CHANGED_DURING_VERIFICATION')
    if receipt['phase'] == 'prepared':
        completed = copy.deepcopy(receipt)
        completed.update(phase='complete', after=ids, network_recovery={
            'network': INTERNAL, 'network_id': plan['network_id'], 'aliases': ALIASES,
            'recovery_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        })
        # Re-read before replacing; never erase a concurrent receipt change.
        if storage.read_private_json(state / 'receipt.json') != receipt:
            raise ValueError('RECOVERY_RECEIPT_CHANGED_DURING_VERIFICATION')
        storage.write_private_json(state / 'receipt.json', completed)
    return {'status': 'component_workers_network_recovered_real_photo_test_pending',
            'network_restored': INTERNAL, 'containers_recreated': False, 'other_services_unchanged': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        if sys.platform != 'linux' or os.geteuid() == 0:
            raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        sys.dont_write_bytecode = True
        os.umask(0o077)
        state = BASE / 'state' / COMMIT[:12]
        m = load_observed_operator(state)
        source = BASE / 'releases' / ('village-components-' + COMMIT[:12])
        if m.source_context(source) != COMMIT:
            raise ValueError('ORIGINAL_COMPONENT_PAYLOAD_REQUIRED')
        import business_storage_copy as storage
        from autonomous_operator import Docker, operation_lock
        paths = m.worker_paths(source, COMMIT, Path.home())
        storage.private_path(state, directory=True)
        storage.private_path(paths['temporary'], directory=True)
        with operation_lock(paths['lock']):
            docker = Docker(state, temporary=paths['temporary'])
            result = recover(state, docker, m, storage, apply=args.apply)
            if args.apply:
                result['original_receipt_verified'] = m.verify(state, docker, COMMIT, 'worker')['status']
        print(json.dumps(result))
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, subprocess.SubprocessError) as error:
        code = str(error) if re.fullmatch('[A-Z_]{1,100}', str(error)) else type(error).__name__
        print('STOP: COMPONENT_NETWORK_RECOVERY ' + code + '. Preserve receipt and private logs.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
