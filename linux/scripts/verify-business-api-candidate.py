#!/usr/bin/env python3
"""Validate actual candidate permissions and restart; never print business rows."""
import argparse
import importlib.util
import json
import os
import secrets
from pathlib import Path
import sys
import time
import urllib.request

SCRIPTS=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('deploy_api',SCRIPTS/'deploy-business-api-validation.py')
deploy=importlib.util.module_from_spec(s);s.loader.exec_module(deploy)
rd=deploy.rd
COLUMNS={'profiles':['id','student_id','display_name','role','gender','class_name','grade'],
 'courses':['id','title','village_id'],'planning_spaces':['id','title','course_id','group_id','space_type','teaching_project_id','village_id'],
 'course_personal_spaces':['id','title','owner_id','course_id','village_id','space_type'],'group_memberships':['group_id','student_key']}
def contract_sql():
    values=','.join("('"+t+"','"+c+"')" for t,cols in COLUMNS.items() for c in cols)
    return """SELECT json_build_object(
 'safe_role',(SELECT count(*)=2 AND bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) FROM pg_roles WHERE rolname IN ('village_api_login','authenticated')),
 'safe_membership',(SELECT count(*)=1 AND bool_and(r.rolname='authenticated' AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='village_api_login'::regrole),
 'rls_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('profiles','courses','planning_spaces','course_personal_spaces','group_memberships') AND c.relrowsecurity),
 'required_columns',(SELECT count(*) FROM (VALUES """+values+""") v(t,c) JOIN information_schema.columns a ON a.table_schema='public' AND a.table_name=v.t AND a.column_name=v.c));"""
def validate_contract(value):
    if value!={'safe_role':True,'safe_membership':True,'rls_tables':5,'required_columns':25}:
        raise ValueError('Candidate role, RLS or column contract differs; inspect privately before exposing API.')

PERMISSION_SQL=(SCRIPTS.parent/'sql/business-api-permission-check.sql').read_text(encoding='utf-8')
def verify_permissions(docker):
    validate_contract(json.loads(docker.sql(contract_sql())))
    docker.phase='candidate-permission-test'
    docker.sql(PERMISSION_SQL)

def write_attempt(state,attempt):
    path=state/'verification-attempt.json'
    if path.exists():deploy.private_file(path)
    temp=state/('verification-attempt-'+secrets.token_hex(8)+'.partial')
    with os.fdopen(os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w',encoding='utf-8') as stream:json.dump(attempt,stream,indent=2)
    temp.replace(path)

def start_attempt(state):
    state=deploy.no_links(state)
    for name in ('candidate-verification.json','api-acceptance.json','verification-attempt.json'):
        path=state/name
        if path.exists():
            deploy.private_file(path)
            path.rename(state/(path.stem+'.previous-'+secrets.token_hex(8)+'.json'))
    attempt={'attempt_id':secrets.token_hex(16),'status':'running','started_at':time.time()}
    write_attempt(state,attempt)
    return attempt

def verify(backup,state):
    attempt=start_attempt(state)
    try:
        verify_current_attempt(backup,state,attempt)
    except BaseException:
        write_attempt(state,{**attempt,'status':'failed'})
        raise

def verify_current_attempt(backup,state,attempt):
    docker=rd.LocalDocker(state,target=deploy.TARGET)
    deploy.validate_runtime(docker,state,backup)
    deploy.verify_api_database_connection(docker)
    checkpoint=json.loads(deploy.private_file(state/'deployment-checkpoint.json').read_text())
    expected=json.loads(deploy.private_file(state/'db/archive-snapshot-counts.json').read_text())
    docker.phase='candidate-before-permissions'
    rd.compare_snapshot(expected,rd.actual_snapshot(docker,expected))
    verify_permissions(docker)
    # Also detects unexpected sequence side effects from target-specific insert triggers.
    rd.compare_snapshot(expected,rd.actual_snapshot(docker,expected))
    docker.phase='candidate-restart'
    config=state/'runtime-compose.json'
    docker.run(['compose','-f',str(config),'restart','db','api']);docker.ready()
    for _ in range(45):
        info=json.loads(docker.run(['inspect',deploy.API]))[0]
        if info['State'].get('Health',{}).get('Status')=='healthy':break
        time.sleep(2)
    else:raise ValueError('API did not become healthy after restart.')
    rd.compare_snapshot(expected,rd.actual_snapshot(docker,expected));deploy.validate_runtime(docker,state,backup)
    deploy.verify_api_database_connection(docker)
    with urllib.request.urlopen('http://127.0.0.1:18080/healthz',timeout=5) as response:
        if json.load(response)!={'status':'ok'}:raise ValueError('API health response differs.')
    result={'status':'permissions_restart_verified','source_archive_sha256':checkpoint['source_archive_sha256'],
            'api_image_id':checkpoint['api_image_id'],'attempt_id':attempt['attempt_id'],
            'runtime_fingerprint':deploy.runtime_fingerprint(docker,state,backup)}
    (state/'candidate-verification.json').write_text(json.dumps(result,indent=2)+'\n')
    write_attempt(state,{**attempt,'status':'passed'})
    print('CANDIDATE_PERMISSIONS_RESTART_VERIFIED - website login probe still required.')
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--backup-dir',type=Path,required=True);a=p.parse_args();os.umask(0o077)
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('Run as admin in Aliyun Linux terminal.')
        verify(deploy.no_links(a.backup_dir),Path.home()/'village-api-validation');return 0
    except (ValueError,RuntimeError,OSError,KeyError):
        print('STOP: candidate verification failed; private phase logs retained. No business cutover or success report.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
