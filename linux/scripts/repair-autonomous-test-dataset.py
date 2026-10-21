#!/usr/bin/env python3
"""Bind a synthetic baseline to the already created autonomous acceptance space."""
import json
import os
from pathlib import Path
import re
import sys
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_extract import tree_digest
from autonomous_operator import operation_lock, verified_runtime


def repair_sql():
    return (storage.source_checkout() / 'linux/sql/autonomous-test-dataset.sql').read_text(encoding='utf-8')


def repair(state, *, docker=None):
    state = storage.private_path(state, directory=True)
    with operation_lock(state):
        if (state / 'public-switch.json').exists() or (state / 'acceptance.json').exists():
            raise ValueError('PRE_SWITCH_TEST_REPAIR_ONLY')
        deploy = load_script('deploy-autonomous')
        docker = docker or deploy.DeployDocker(state)
        meta, _ = verified_runtime(docker, state)
        if tree_digest(state / 'control') != meta['control_sha256']:
            raise ValueError('FROZEN_CONTROL_CHANGED')
        release = state / 'releases' / meta['releaseId']
        for name, key in [('control','control_sha256'),('schema','schema_sha256'),('web','static_sha256')]:
            if tree_digest(release / name) != meta[key]:
                raise ValueError('FROZEN_RELEASE_CHANGED')
        proof = storage.read_private_json(state / 'business-probe-state.json')
        expected = {'teachingProjectId':'c4a00000-0000-4000-8000-000000000002',
                    'villageId':'c4a00000-0000-4000-8000-000000000001',
                    'courseId':'autonomous-test-20261021','groupId':'autonomous-test-group-20261021',
                    'spaceId':'unified-test-autonomous-20261021'}
        actors = proof.get('actors', {})
        if (proof.get('releaseId') != meta['releaseId'] or proof.get('context') != expected
                or set(actors) != {'admin','member'} or actors['admin'] == actors['member']
                or any(not re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',v) for v in actors.values())):
            raise ValueError('EXISTING_TEST_PROBE_CONTEXT_REQUIRED')
        sql = repair_sql().replace('__ADMIN_ID__',actors['admin']).replace('__MEMBER_ID__',actors['member'])
        if json.loads(docker.sql(sql)) != {'status':'test_baseline_ready'}:
            raise ValueError('TEST_BASELINE_RECEIPT_REQUIRED')


def main():
    try:
        if sys.platform != 'linux' or os.geteuid() == 0:
            raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        repair(Path.home() / 'village-autonomous')
        print('AUTONOMOUS_TEST_BASELINE_READY_BUSINESS_ROWS_RETAINED')
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        print('STOP: AUTONOMOUS_TEST_BASELINE_REPAIR_FAILED. Retain TEST state and private logs; do not reset data.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
