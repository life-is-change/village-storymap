#!/usr/bin/env python3
"""Explicit approved C2a-only synthetic context for existing website student 25213040."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import sys
S=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('c2a_fixture_deploy',S/'deploy-scene-files-validation.py');deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
COURSE='c2a-test-20261019'

def boundary():
    # Synthetic square, no copied village geometry or datasets.
    points=[(112.999,22.999),(113.001,22.999),(113.001,23.001),(112.999,23.001),(112.999,22.999)]
    ewkt='SRID=4326;MULTIPOLYGON((('+','.join(f'{x} {y}' for x,y in points)+')))'
    return ewkt

def context_sql(*,create=False):
    if type(create) is not bool:raise ValueError('INVALID_CONTEXT_MODE')
    sql=(S.parent/'sql/scene-files-test-context.sql').read_text(encoding='utf-8')
    if not create:sql=re.sub(r'-- CREATE ONLY BEGIN[\s\S]*?-- CREATE ONLY END','',sql)
    return sql.replace('__BEGIN__','BEGIN;' if create else 'BEGIN READ ONLY;').replace('__BOUNDARY_EWKT__',boundary()).lstrip()

def parse_result(raw):
    rows=[json.loads(line) for line in raw.splitlines() if line.strip().startswith('{')]
    if len(rows)!=1 or rows[0].get('course_id')!=COURSE or rows[0].get('status') not in ('empty','ready'):raise ValueError('INVALID_CONTEXT_REPORT')
    return rows[0]

def prepare(docker,*,create=False):
    deploy.validate_runtime(docker)
    docker.phase='files-test-context-check';report=parse_result(docker.sql(context_sql(create=False),deploy.DATABASE))
    if not create:return report
    # Clear old acceptance before any candidate data mutation, retaining evidence.
    for name in ('acceptance.json','verification.json'):
        p=deploy.STATE/name
        if p.exists():deploy.copy.private_path(p).rename(deploy.STATE/(name+'.before-test-context-'+secrets.token_hex(8)))
    docker.phase='files-test-context-create';report=parse_result(docker.sql(context_sql(create=True),deploy.DATABASE))
    if report['status']!='ready' or report.get('test_memberships')!=1:raise ValueError('TEST_CONTEXT_NOT_READY')
    # Recheck all exact rows in a separate read-only transaction after commit.
    checked=parse_result(docker.sql(context_sql(create=False),deploy.DATABASE))
    if checked!=report:raise ValueError('TEST_CONTEXT_CHANGED')
    deploy.copy.write_private_json(deploy.STATE/'test-context.json',{'version':1,'database':deploy.DATABASE,'course_id':COURSE,'uploader_student_id':'25213040','status':'ready'})
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group(required=True);g.add_argument('--check',action='store_true');g.add_argument('--create',action='store_true');a=p.parse_args();os.umask(0o077);docker=None
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('NORMAL_ADMIN_LINUX_REQUIRED')
        docker=deploy.deploy.rd.LocalDocker(deploy.STATE,target=deploy.deploy.TARGET)
        report=prepare(docker,create=a.create);print(json.dumps(report));print('SCENE_FILES_TEST_CONTEXT_READY_NOT_ACCEPTED' if a.create else 'SCENE_FILES_TEST_CONTEXT_CHECK_OK');return 0
    except (ValueError,RuntimeError,OSError,KeyError,TypeError) as e:
        code=str(e) if re.fullmatch('[A-Z][A-Z0-9_]{2,80}',str(e)) else 'TEST_CONTEXT_CHECK_FAILED'
        print('STOP: SCENE_FILES_TEST_CONTEXT_FAILED phase='+getattr(docker,'phase','preflight')+' category='+code+'. Keep private data/logs; do not reset or paste business rows.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
