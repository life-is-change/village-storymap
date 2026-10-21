#!/usr/bin/env python3
"""Add the missing legacy personal context prerequisite at the pending files step."""
import hashlib
import json
import os
from pathlib import Path
import sys
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_extract import tree_digest
from autonomous_operator import operation_lock, Checkpoints, PG

REQUIRED = {'release', 'old-candidates-stopped', 'postgres', 'roles', 'database', 'restore',
            'auth-owners', 'auth-migrations', 'schema-control', 'schema-identity',
            'schema-catalog', 'schema-survey', 'schema-planning', 'schema-events'}


def validate_steps(steps):
    if (set(steps) != REQUIRED | {'schema-files'}
            or any(steps[n].get('status') != 'done' for n in REQUIRED)
            or steps['schema-files'].get('status') != 'pending'):
        raise ValueError('EXACT_PENDING_FILES_PHASE_REQUIRED')


def compatibility_sql():
    return (storage.source_checkout() / 'linux/sql/autonomous-personal-context-compat.sql').read_text(encoding='utf-8').replace('\r\n', '\n')


def repair(state, *, docker=None):
    state = storage.private_path(state, directory=True)
    with operation_lock(state):
        if any((state / n).exists() for n in ('release.json', 'public-switch.json')):
            raise ValueError('PENDING_FILES_INSTALL_ONLY')
        doc = storage.read_private_json(state / 'autonomous-checkpoints.json')
        validate_steps(doc['steps'])
        deploy = load_script('deploy-autonomous');meta = deploy.read_meta()
        wanted = {'web': meta['static_sha256'], 'schema': meta['schema_sha256'], 'control': meta['control_sha256']}
        release = state / 'releases' / meta['releaseId']
        if (doc['steps']['release']['receipt'] != wanted
                or tree_digest(state / 'control') != wanted['control']
                or any(tree_digest(release / n) != digest for n, digest in wanted.items())):
            raise ValueError('FROZEN_RELEASE_CHANGED')
        identity = doc['identity']
        if identity.get('releaseId') != meta['releaseId'] or identity.get('archive_sha256') != meta['archive_sha256']:
            raise ValueError('CHECKPOINT_RELEASE_CHANGED')
        gate = Checkpoints(state, identity)
        docker = docker or deploy.DeployDocker(state)
        docker.own_container(PG, meta['releaseId'])
        if doc['steps']['database']['receipt'] != deploy.db_identity(docker, doc['nonce']):
            raise ValueError('DATABASE_IDENTITY_CHANGED')
        if doc['steps']['postgres']['receipt'] != {'system': docker.sql('SELECT system_identifier FROM pg_control_system();', 'postgres').strip()}:
            raise ValueError('POSTGRES_IDENTITY_CHANGED')
        for n in ('identity','catalog','survey','planning','events'):
            expected = {'sha256': deploy.schema.step_hash((release / 'schema' / (n+'.sql')).read_text(encoding='utf-8'))}
            if doc['steps']['schema-'+n]['receipt'] != expected or deploy.read_schema_receipt(docker,n+'.sql') != expected:
                raise ValueError('COMPLETED_SCHEMA_CHANGED')
        if deploy.read_schema_receipt(docker,'files.sql') is not None:
            raise ValueError('FILES_ALREADY_INSTALLED')
        before = gate.path.read_bytes()
        sql = compatibility_sql();digest = hashlib.sha256(sql.encode()).hexdigest()
        query = "SELECT to_regclass('autonomous_control.personal_context_compat') IS NOT NULL;"
        if docker.sql(query).strip() != 't':
            docker.sql(sql.replace('__SQL_SHA256__', digest))
        proof = json.loads(docker.sql("SELECT json_build_object('sha256',sql_sha256,'function_matches',function_sha256=md5(pg_get_functiondef('public.ensure_course_personal_space(text,uuid,text,text,text)'::regprocedure)),'columns_match',(SELECT count(*)=2 FROM pg_attribute WHERE attrelid='public.course_personal_spaces'::regclass AND ((attname='teaching_project_id' AND atttypid='uuid'::regtype) OR (attname='context_space_type' AND atttypid='text'::regtype)) AND NOT attisdropped)) FROM autonomous_control.personal_context_compat;"))
        if proof != {'sha256': digest, 'function_matches': True, 'columns_match': True}:
            raise ValueError('PERSONAL_COMPATIBILITY_RECEIPT_CHANGED')
        if gate.path.read_bytes() != before:
            raise ValueError('CHECKPOINT_WAS_CHANGED')


def main():
    try:
        if sys.platform != 'linux' or os.geteuid() == 0:
            raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077)
        repair(Path.home() / 'village-autonomous')
        print('PERSONAL_CONTEXT_PREREQUISITE_REPAIRED_EXISTING_ROWS_RETAINED')
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        print('STOP: PERSONAL_CONTEXT_REPAIR_FAILED. Retain database, checkpoints and private logs; do not reset data.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
