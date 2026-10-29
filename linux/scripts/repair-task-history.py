#!/usr/bin/env python3
"""Keep inaccessible historical tasks out of list results without evaluating their grant key."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path

STATE=Path('/home/admin/village-autonomous/files/task-history-20261029-v1')
SIGNATURE='api_private.task_execute(text,jsonb,text)'
OLD="WHERE api_private.context_accessible((r.context->>'teachingProjectId')::uuid,(r.context->>'villageId')::uuid,r.context->>'spaceId') AND api_private.task_grant_key(r.context)=r.grant_key;RETURN result;"
NEW="WHERE CASE WHEN api_private.context_accessible((r.context->>'teachingProjectId')::uuid,(r.context->>'villageId')::uuid,r.context->>'spaceId') THEN api_private.task_grant_key(r.context)=r.grant_key ELSE false END;RETURN result;"
def sql(statement):
    result=subprocess.run(['docker','exec','-i','village-autonomous-postgres','psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-U','village_restore_admin','-d','village_unified_candidate'],input=statement,text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError('TASK_HISTORY_SQL_FAILED: '+result.stderr[:1500])
    return result.stdout
def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');args=p.parse_args()
    original=sql("SELECT pg_get_functiondef('"+SIGNATURE+"'::regprocedure);").strip()
    if original.count(NEW)==1 and OLD not in original:
        print(json.dumps({'status':'task_history_verified'}));return
    assert original.count(OLD)==1 and NEW not in original,'UNKNOWN_TASK_FUNCTION_BASELINE'
    assert original.index(OLD)>original.index("IF a='tasks.list' THEN"),'WRONG_TASK_BRANCH'
    if not args.apply:
        print(json.dumps({'status':'task_history_preflight_passed','function':SIGNATURE}));return
    os.umask(0o077);STATE.mkdir(parents=True,exist_ok=True)
    backup=STATE/'original-task-execute.sql'
    if backup.exists():assert backup.read_text()==original,'BACKUP_CHANGED'
    else:backup.write_text(original);backup.chmod(0o600)
    assert sql("SELECT pg_get_functiondef('"+SIGNATURE+"'::regprocedure);").strip()==original,'TASK_FUNCTION_CHANGED'
    expected=hashlib.md5((original+'\n').encode()).hexdigest()
    # PostgreSQL pg_get_functiondef ends in a newline; compare the exact body in the transaction.
    guard="DO $guard$ BEGIN IF md5(pg_get_functiondef('"+SIGNATURE+"'::regprocedure))<>'"+expected+"' THEN RAISE EXCEPTION 'TASK_FUNCTION_CHANGED'; END IF; END $guard$;"
    updated=original.replace(OLD,NEW,1)
    sql("BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';SELECT pg_advisory_xact_lock(hashtextextended('task-history-20261029',0));"+guard+updated+";COMMIT;")
    actual=sql("SELECT pg_get_functiondef('"+SIGNATURE+"'::regprocedure);").strip()
    assert actual==updated,'TASK_FUNCTION_VERIFICATION_FAILED'
    (STATE/'receipt.json').write_text(json.dumps({'status':'complete','before':hashlib.sha256(original.encode()).hexdigest(),'after':hashlib.sha256(updated.encode()).hexdigest()}))
    print(json.dumps({'status':'task_history_updated','permissions_changed':False,'task_rows_changed':False}))
if __name__=='__main__':main()
