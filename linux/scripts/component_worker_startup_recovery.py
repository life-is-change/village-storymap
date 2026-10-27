#!/usr/bin/env python3
"""Replace only the observed restarting Worker with a pinned health-gate fix."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

BASE = Path('/media/gpu332/newapply/village-platform/deploy/components')
COMMIT = 'af39f0411ac638d360d10e2c4d57e5d8c56ed929'
WORKER = 'village-platform-facade-worker-1'
ML = 'village-platform-facade-ml-1'
IMAGES = {
    WORKER: 'sha256:3d8f777714d5b611f2312a29f3a606e9c234b4a92b3181c87133cd1307657ef3',
    ML: 'sha256:a38a7be2a34018802047f88d9692256f4f6d21801559c211ba64c692ccb3a123',
}
HEALTH_COMMIT = 'd5d92f3f8d455403b74db0dd210093aff67cac9f'
HEALTH_SHA = '2a74dc3ae6b30234e2f9156ac81cd6c375dc5c4bf27ad48e61cd6b805dd2cc9e'
NETWORK_HELPER_SHA = '01124c9a884589972936d2c1fdce65175ccee4b2174ae5c4eaf2799f7e935966'
ORIGINAL_OPERATOR_SHA = '274927ea7c2d96ea7c12559c756a959836a89de99a15389c0992a713218e925d'


def digest(value):
    return hashlib.sha256(value).hexdigest()


def base_reference():
    # BuildKit treats a bare config-image sha as a registry reference. Use a
    # private local tag and verify that it resolves to the exact known image.
    return 'village-component-health-base:' + IMAGES[WORKER][7:19]


def validate_baseline(m, receipt, rows, documents, attempt, progress=None):
    expected = dict(IMAGES)
    if receipt.get('phase') == 'complete' and progress:
        expected[WORKER] = progress['image']
    if (receipt.get('phase') not in ('prepared', 'complete') or receipt.get('kind') != 'worker'
            or receipt.get('commit') != COMMIT or receipt.get('operator_sha256') != ORIGINAL_OPERATOR_SHA
            or receipt.get('images') != expected or set(rows) != set(IMAGES)
            or set(receipt.get('before', {})) != set(IMAGES)):
        raise ValueError('OBSERVED_WORKER_ROLLOUT_REQUIRED')
    for name, row in rows.items():
        old = receipt['before'][name]
        service = 'facade-worker' if name == WORKER else 'facade-ml'
        allowed_images = {IMAGES[name]}
        if name == WORKER and progress: allowed_images.add(progress['image'])
        if (old['Image'] != m.OBSERVED[name] or row['Name'] != '/' + name
                or row['Image'] not in allowed_images or not re.fullmatch('[a-f0-9]{64}', row['Id'])
                or row['Config'].get('WorkingDir') != '/opt/village-components'):
            raise ValueError('STARTUP_CONTAINER_IDENTITY_CHANGED')
        required_id = (progress.get('new_container_id') if name == WORKER and progress
                       and row['Image'] == progress['image'] else attempt['containers'].get(name))
        if required_id and row['Id'] != required_id:
            raise ValueError('STARTUP_CONTAINER_IDENTITY_CHANGED')
        original, updated = documents[name]['original'], documents[name]['updated']
        if m.worker_document(original, service, IMAGES[name]) != updated:
            raise ValueError('STARTUP_SAVED_COMPOSE_CHANGED')
        a, b = m.resource_snapshot(old), m.resource_snapshot(row)
        if name == WORKER:
            a.pop('networks'); b.pop('networks')
        if a != b:
            raise ValueError('STARTUP_RESOURCES_CHANGED')
        ignored = {'PYTHONPATH', 'BLENDER_EXECUTABLE'}
        before_env, after_env = m.environment(old['Config']['Env']), m.environment(row['Config']['Env'])
        if {k: v for k, v in before_env.items() if k not in ignored} != {k: v for k, v in after_env.items() if k not in ignored}:
            raise ValueError('STARTUP_ENVIRONMENT_CHANGED')
        if after_env.get('PYTHONPATH', '').split(':')[0] != '/opt/village-components':
            raise ValueError('STARTUP_IMPORT_PATH_CHANGED')
        if name == WORKER and after_env.get('BLENDER_EXECUTABLE') != m.BLENDER:
            raise ValueError('STARTUP_BLENDER_PATH_CHANGED')
        if name == WORKER and progress and row['Image'] == progress['image'] and after_env.get('PYTHONPATH') != progress['pythonpath']:
            raise ValueError('STARTUP_IMPORT_PATH_CHANGED')
        if not set(row['NetworkSettings']['Networks']).issubset(old['NetworkSettings']['Networks']):
            raise ValueError('STARTUP_NETWORKS_CHANGED')
        if name == ML and (not row['State']['Running'] or row['State'].get('Health', {}).get('Status') != 'healthy'):
            raise ValueError('STARTUP_ML_NOT_HEALTHY')


def prepare_context(folder, source, m):
    if len(source) != 6286 or digest(source) != HEALTH_SHA:
        raise ValueError('STARTUP_HEALTH_SOURCE_CHANGED')
    context = folder / 'build-context'
    context.mkdir(mode=0o700, exist_ok=True)
    m.write_public(context, 'health.py', source)
    dockerfile = ('FROM ' + base_reference() + '\n'
                  'COPY --chown=10001:10001 health.py /opt/village-components/village_processing/health.py\n')
    m.write_public(context, 'Dockerfile', dockerfile.encode())
    return context


def replacement_document(document, image, *, pythonpath=None):
    result = copy.deepcopy(document)
    result['services']['facade-worker']['image'] = image
    if pythonpath is not None: result['services']['facade-worker'].setdefault('environment', {})['PYTHONPATH'] = pythonpath
    return result


def worker_alive(row):
    state = row.get('State', {})
    return (state.get('Running') is True and not state.get('Restarting')
            and not state.get('OOMKilled') and state.get('Pid', 0) > 0)


def validate_endpoints(row, networks):
    if set(row['NetworkSettings']['Networks']) != set(networks):
        raise ValueError('STARTUP_NETWORK_ENDPOINT_MISSING')
    for name, network in networks.items():
        endpoint = row['NetworkSettings']['Networks'][name]
        if endpoint.get('NetworkID') != network['Id'] or row['Id'] not in (network.get('Containers') or {}):
            raise ValueError('STARTUP_NETWORK_ENDPOINT_MISSING')


def wait_ready(docker, identifier, *, timeout=180):
    deadline = time.monotonic() + timeout
    stable, previous = None, None
    while time.monotonic() < deadline:
        row = docker.inspect(WORKER)
        if row['Id'] != identifier:
            raise ValueError('STARTUP_CONTAINER_CHANGED_WHILE_WAITING')
        stamp = (row['State'].get('Pid'), row.get('RestartCount'), row['State'].get('StartedAt'))
        started = row['State'].get('StartedAt')
        logs = docker.run('logs', '--since', started, WORKER) if started else ''
        markers = ('BLENDER_RUNTIME=OK', 'FACADE_ML=OK', 'FACADE_LAMA=OK', 'ALIYUN_GATEWAY=OK')
        if worker_alive(row) and all(marker in logs for marker in markers) and 'Facade worker health checks failed' not in logs:
            if stable is None or stamp != previous: stable = time.monotonic()
            if stable is not None and time.monotonic() - stable >= 10: return row
        else:
            stable = None
        previous = stamp
        time.sleep(2)
    raise ValueError('STARTUP_WORKER_NOT_READY')


def complete_receipt(state, receipt, rows, progress, storage):
    backup = state / 'receipt-before-startup-recovery.json'
    if backup.exists():
        if storage.read_private_json(backup) != receipt:
            raise ValueError('STARTUP_ORIGINAL_RECEIPT_CHANGED')
    else:
        storage.write_private_json(backup, receipt)
    if storage.read_private_json(state / 'receipt.json') != receipt:
        raise ValueError('STARTUP_RECEIPT_CHANGED_DURING_VERIFICATION')
    result = copy.deepcopy(receipt)
    result['images'][WORKER] = progress['image']
    result.update(phase='complete', after={name: row['Id'] for name, row in rows.items()},
                  blender_runtime_smoke=progress['smoke'], startup_recovery=progress)
    storage.write_private_json(state / 'receipt.json', result)


def recover(state, docker, m, storage, helper, *, apply):
    receipt = storage.read_private_json(state / 'receipt.json')
    attempt = storage.read_private_json(state / 'network-recovery-attempt.json')
    documents = {}
    for name in IMAGES:
        service = 'facade-worker' if name == WORKER else 'facade-ml'
        documents[name] = {'original': storage.read_private_json(state / (service + '-original.json')),
                           'updated': storage.read_private_json(state / (service + '.json'))}
    folder = state / 'startup-health-recovery'
    storage.no_links(folder)
    folder.mkdir(mode=0o700, exist_ok=True)
    storage.private_path(folder, directory=True)
    checkpoint = folder / 'checkpoint.json'
    progress = storage.read_private_json(checkpoint) if checkpoint.exists() else None
    own_sha = digest(Path(__file__).read_bytes())
    if progress and (progress.get('health_sha256') != HEALTH_SHA or progress.get('recovery_sha256') != own_sha):
        raise ValueError('STARTUP_RECOVERY_CHECKPOINT_CHANGED')

    def inspect_all():
        rows = {name: docker.inspect(name) for name in IMAGES}
        validate_baseline(m, receipt, rows, documents, attempt, progress)
        if m.all_other(docker, IMAGES) != receipt['other']:
            raise ValueError('STARTUP_OTHER_SERVICES_CHANGED')
        networks = {}
        for name, endpoint in receipt['before'][WORKER]['NetworkSettings']['Networks'].items():
            network = json.loads(docker.run('network', 'inspect', name))[0]
            if network['Id'] != endpoint['NetworkID']:
                raise ValueError('STARTUP_NETWORK_IDENTITY_CHANGED')
            networks[name] = network
        return rows, networks

    rows, networks = inspect_all()
    if not apply:
        return {'status': 'component_worker_startup_recovery_preflight_passed', 'worker_restarting': bool(rows[WORKER]['State'].get('Restarting'))}
    if progress is None:
        url = ('https://raw.githubusercontent.com/life-is-change/village-storymap/' + HEALTH_COMMIT
               + '/server/src/village_processing/health.py')
        cached = folder / 'build-context/health.py'
        if cached.exists(): source = cached.read_bytes()
        else:
            sources = (url, 'https://api.github.com/repos/life-is-change/village-storymap/git/blobs/6223dfba2cbddfd3ebccc9b0fd3cde01df1cbcf5')
            for location in sources:
                try:
                    request = urllib.request.Request(location, headers={'User-Agent': 'village-component-recovery',
                                                                        'Accept': 'application/vnd.github.raw+json'})
                    with urllib.request.urlopen(request, timeout=30) as response: source = response.read(6287)
                    if len(source) == 6286 and digest(source) == HEALTH_SHA: break
                except OSError:
                    continue
            else:
                raise ValueError('STARTUP_HEALTH_SOURCE_UNAVAILABLE')
        context = prepare_context(folder, source, m)
        docker.run('tag', IMAGES[WORKER], base_reference())
        if json.loads(docker.run('image', 'inspect', base_reference()))[0]['Id'] != IMAGES[WORKER]:
            raise ValueError('STARTUP_LOCAL_BASE_IMAGE_CHANGED')
        image = m.docker_step(docker, 'build_worker_health_overlay', 'build', '--pull=false', '--network=none', '-q',
                              '-t', 'village-component-worker:health-' + HEALTH_SHA[:12], context, timeout=120).strip()
        if not re.fullmatch('sha256:[a-f0-9]{64}', image):
            raise ValueError('STARTUP_IMAGE_BUILD_REPORT_INVALID')
        base, built = [json.loads(docker.run('image', 'inspect', value))[0] for value in (IMAGES[WORKER], image)]
        layers = base['RootFS']['Layers']
        if (built['Config'] != base['Config'] or built['RootFS']['Layers'][:-1] != layers
                or built.get('Os') != 'linux' or built.get('Architecture') != 'amd64'):
            raise ValueError('STARTUP_OVERLAY_CHANGED_MORE_THAN_HEALTH_FILE')
        code = ("import hashlib,importlib;from village_processing import __main__,health;"
                "from rural_house_generator.backend.app.blender_service import BlenderService;"
                "from rural_house_generator.backend.app.facade.full_pipeline import FullLocalFacadeRectifier;"
                "from rural_house_generator.backend.app.facade.job_processor import FacadeJobProcessor;"
                "from village_processing.facade.pipeline import FacadePipeline;"
                "from village_processing.facade.worker import FacadeWorker;"
                "assert health.__file__=='/opt/village-components/village_processing/health.py';"
                "assert hashlib.sha256(open(health.__file__,'rb').read()).hexdigest()==" + repr(HEALTH_SHA) + ";"
                "names=['village_processing.__main__','rural_house_generator.backend.app.blender_service',"
                "'rural_house_generator.backend.app.facade.full_pipeline','rural_house_generator.backend.app.facade.job_processor',"
                "'rural_house_generator.backend.component_building.adapter'];"
                "assert all(importlib.import_module(n).__file__.startswith('/opt/village-components/') for n in names)")
        project_root = receipt['before'][WORKER]['Config']['WorkingDir']
        if not isinstance(project_root, str) or not project_root.startswith('/'):
            raise ValueError('STARTUP_ORIGINAL_PROJECT_CWD_REQUIRED')
        previous_path = m.environment(rows[WORKER]['Config']['Env']).get('PYTHONPATH', '/opt/village-components')
        pythonpath = ':'.join(part for part in previous_path.split(':') if part) + ':' + project_root
        m.docker_step(docker, 'verify_worker_startup_import', 'run', '--rm', '--pull=never', '--network', 'none',
                      '--read-only', '--env', 'PYTHONPATH=' + pythonpath, '--entrypoint', 'python', image, '-c', code, timeout=60)
        smoke = m.verify_blender_runtime(docker, image, rows[WORKER]['Config']['User'])
        document = replacement_document(documents[WORKER]['updated'], image, pythonpath=pythonpath)
        storage.write_private_json(folder / 'facade-worker.json', document)
        progress = {'phase': 'built', 'image': image, 'base_image': IMAGES[WORKER], 'health_sha256': HEALTH_SHA,
                    'recovery_sha256': own_sha, 'smoke': smoke, 'old_container_id': rows[WORKER]['Id'],
                    'pythonpath': pythonpath, 'compose_sha256': digest((folder / 'facade-worker.json').read_bytes())}
        storage.write_private_json(checkpoint, progress)
    if digest((folder / 'facade-worker.json').read_bytes()) != progress['compose_sha256']:
        raise ValueError('STARTUP_RECOVERY_COMPOSE_CHANGED')
    rows, networks = inspect_all()
    if rows[WORKER]['Image'] == IMAGES[WORKER]:
        # The user confirmed no active facade lease. Stop just this restart loop;
        # no daemon restart, no ML update, no source/model/data removal.
        m.docker_step(docker, 'stop_restarting_worker', 'stop', '--time', '30', rows[WORKER]['Id'], timeout=45)
        m.docker_step(docker, 'replace_worker_health_gate', 'compose', '-f', folder / 'facade-worker.json',
                      'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'facade-worker', timeout=120)
    rows, networks = inspect_all()
    if rows[WORKER]['Image'] != progress['image']:
        raise ValueError('STARTUP_NEW_WORKER_IMAGE_REQUIRED')
    progress.update(phase='replaced', new_container_id=rows[WORKER]['Id'])
    storage.write_private_json(checkpoint, progress)
    print(json.dumps({'stage': 'wait_worker_real_startup', 'status': 'started'}), flush=True)
    wait_ready(docker, progress['new_container_id'])
    print(json.dumps({'stage': 'wait_worker_real_startup', 'status': 'passed'}), flush=True)
    rows, networks = inspect_all()
    validate_endpoints(rows[WORKER], networks)
    for name, row in rows.items():
        if m.resource_snapshot(row) != m.resource_snapshot(receipt['before'][name]):
            raise ValueError('STARTUP_FINAL_RESOURCES_CHANGED')
    m.docker_step(docker, 'verify_worker_to_ml', 'exec', WORKER, 'python', '-c', helper.ML_CHECK, timeout=30)
    m.docker_step(docker, 'verify_worker_aliyun_identity', 'exec', WORKER, 'python', '-c', helper.IDENTITY_CHECK, timeout=60)
    if receipt['phase'] == 'prepared': complete_receipt(state, receipt, rows, progress, storage)
    result = m.verify(state, docker, COMMIT, 'worker')
    return {'status': 'component_worker_startup_recovered_real_photo_test_pending',
            'original_receipt_verified': result['status'], 'other_services_unchanged': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        if sys.platform != 'linux' or os.geteuid() == 0: raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        sys.dont_write_bytecode = True
        os.umask(0o077)
        helper_path = BASE / 'operators/component-network-recovery-669b474.py'
        if any(p.is_symlink() for p in (helper_path, *helper_path.parents)) or digest(helper_path.read_bytes()) != NETWORK_HELPER_SHA:
            raise ValueError('PINNED_NETWORK_RECOVERY_HELPER_REQUIRED')
        spec = importlib.util.spec_from_file_location('pinned_network_recovery', helper_path)
        helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
        state = BASE / 'state' / COMMIT[:12]
        m = helper.load_observed_operator(state)
        source = BASE / 'releases' / ('village-components-' + COMMIT[:12])
        if m.source_context(source) != COMMIT: raise ValueError('ORIGINAL_COMPONENT_SOURCE_REQUIRED')
        import business_storage_copy as storage
        from autonomous_operator import Docker, operation_lock
        paths = m.worker_paths(source, COMMIT, Path.home())
        storage.private_path(state, directory=True)
        with operation_lock(paths['lock']):
            result = recover(state, Docker(state, temporary=paths['temporary']), m, storage, helper, apply=args.apply)
        print(json.dumps(result));return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, subprocess.SubprocessError) as error:
        code = str(error) if re.fullmatch('[A-Z_]{1,100}', str(error)) else type(error).__name__
        print('STOP: COMPONENT_STARTUP_RECOVERY ' + code + '. Preserve original receipt and private logs.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
