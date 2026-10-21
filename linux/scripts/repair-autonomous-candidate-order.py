#!/usr/bin/env python3
"""Prove legacy mount ordering and finish only the pre-database stop checkpoint."""
import hashlib
import os
from pathlib import Path
import sys
import time
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_extract import tree_digest
from autonomous_operator import Docker, Checkpoints, OLD_CANDIDATES, PG, operation_lock


def repair(state, *, docker=None):
    state = storage.private_path(state, directory=True)
    with operation_lock(state):
        if any((state / name).exists() for name in ('release.json', 'public-switch.json')):
            raise ValueError('PRE_DATABASE_STOP_CHECKPOINT_ONLY')
        doc = storage.read_private_json(state / 'autonomous-checkpoints.json')
        steps = doc.get('steps', {})
        if (set(steps) != {'release', 'old-candidates-stopped'}
                or steps['release'].get('status') != 'done'
                or steps['old-candidates-stopped'].get('status') != 'pending'):
            raise ValueError('PRE_DATABASE_STOP_CHECKPOINT_ONLY')
        if any(storage.private_path(state / 'data', directory=True).iterdir()):
            raise ValueError('DATABASE_DATA_ALREADY_PRESENT')
        deploy = load_script('deploy-autonomous')
        meta = deploy.read_meta()
        wanted = {'web': meta['static_sha256'], 'schema': meta['schema_sha256'], 'control': meta['control_sha256']}
        release = state / 'releases' / meta['releaseId']
        if (steps['release'].get('receipt') != wanted
                or tree_digest(state / 'control') != wanted['control']
                or any(tree_digest(release / name) != digest for name, digest in wanted.items())):
            raise ValueError('FROZEN_CONTROL_RELEASE_DIFFERS')
        inputs = storage.read_private_json(state / 'inputs.json')
        preflight = deploy.check(meta, inputs['archive'], inputs['backup'], inputs['storage'], state=state)
        identity = {key: preflight[key] for key in ('source_archive_sha256', 'storage_inventory_sha256')}
        identity.update(releaseId=meta['releaseId'], archive_sha256=meta['archive_sha256'])
        gate = Checkpoints(state, identity)
        baseline_path = state / 'initial-baseline.json'
        baseline_bytes = storage.private_path(baseline_path).read_bytes()
        baseline = storage.read_private_json(baseline_path)
        receipts = baseline['candidates']
        if (len(receipts) != len(OLD_CANDIDATES)
                or {row['name'] for row in receipts} != set(OLD_CANDIDATES)
                or any(type(row.get('was_running')) is not bool for row in receipts)
                or preflight['baseline'] != baseline):
            raise ValueError('EXACT_OLD_CANDIDATE_SET_REQUIRED')
        docker = docker or Docker(state)
        if docker.run('ps', '-aq', '--filter', 'name=^/' + PG + '$').strip():
            raise ValueError('DATABASE_CONTAINER_ALREADY_PRESENT')
        # Original receipt, identities, mounts and RW flags must all match.
        # The bounded compatibility proof accepts only mount-order changes.
        gate.step('old-candidates-stopped', lambda: deploy.stop_old_candidates(docker, receipts),
                  lambda row: row == receipts and all(not docker.inspect(r['name'])['State']['Running'] for r in receipts),
                  recover=lambda: deploy.stop_old_candidates(docker, receipts))
        if baseline_path.read_bytes() != baseline_bytes:
            raise ValueError('ORIGINAL_BASELINE_CHANGED')
        storage.write_private_json(state / 'candidate-order-repair.json', {
            'status': 'old_candidates_stopped_database_not_created',
            'releaseId': meta['releaseId'], 'baseline_sha256': hashlib.sha256(baseline_bytes).hexdigest(),
            'verified_at': time.time()})


def main():
    try:
        if sys.platform != 'linux' or os.geteuid() == 0:
            raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        repair(Path.home() / 'village-autonomous')
        print('OLD_CANDIDATE_ORDER_REPAIR_VERIFIED_DATABASE_NOT_CREATED')
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        print('STOP: OLD_CANDIDATE_ORDER_REPAIR_FAILED. Retain baseline, checkpoints and private logs; do not reset data.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
