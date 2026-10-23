"""Disposable-only native checks for the workspace consistency repair."""
import json
import os
import uuid
from pathlib import Path
import business_storage_copy as storage
from autonomous_extract import tree_digest
from autonomous_operator import WEB
from workspace_context import patch_sql,SIGNATURE

PROJECT='a0000000-0000-4000-8000-000000000001'
VILLAGE='b0000000-0000-4000-8000-000000000001'
SECOND='b0000000-0000-4000-8000-000000000009'
OWNER='10000000-0000-4000-8000-000000000001'


def verify_workspace_repair(state,repo,d,load,api,actor,local_call,original_run):
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('VILLAGE_TEST_AUTONOMOUS_RUNTIME')!='1':
        raise ValueError('DISPOSABLE_WORKSPACE_FIXTURE_REQUIRED')
    repair=load('repair-autonomous-workspace');repair.load_script=load
    legacy=(repo/'linux/sql/autonomous-personal-context-compat.sql').read_text()
    fixed=(repo/'linux/sql/workspace-personal-context.sql').read_text()
    setup="SELECT set_config('request.jwt.claim.sub','"+OWNER+"',true);INSERT INTO public.villages(id,name,status,is_practice,boundary) SELECT '"+SECOND+"','Second published practice','published',true,boundary FROM public.villages WHERE id='"+VILLAGE+"';"
    call="public.ensure_course_personal_space('course','"+PROJECT+"'::uuid,'"+SECOND+"','practice_personal','Second practice')"
    red="BEGIN;"+setup+"DO $$BEGIN BEGIN PERFORM "+call+";RAISE EXCEPTION 'LEGACY_SECOND_PRACTICE_FAILURE_NOT_REPRODUCED';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'PERSONAL_SPACE_CONTEXT_MISMATCH' THEN RAISE;END IF;END;END$$;ROLLBACK;"
    d.sql(red)
    print('WORKSPACE_LEGACY_PERSONAL_CONTEXT_FAILURE_REPRODUCED',flush=True)
    definition=d.sql("SELECT pg_get_functiondef('"+SIGNATURE+"'::regprocedure);")
    d.sql(definition.replace('begin','begin\n-- unknown synthetic body',1))
    try:
        try:d.sql(patch_sql(legacy,fixed))
        except RuntimeError:pass
        else:raise ValueError('UNKNOWN_PERSONAL_FUNCTION_REPLACED')
    finally:d.sql(definition)
    function_metadata="SELECT md5(row(proowner,proacl,prosecdef,proconfig)::text) FROM pg_proc WHERE oid='"+SIGNATURE+"'::regprocedure;"
    identity_before=d.sql(function_metadata)
    others_sql="SELECT md5(string_agg(pg_get_functiondef(oid),'' ORDER BY oid)) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'api_private'::regnamespace) AND prokind='f' AND oid<>'"+SIGNATURE+"'::regprocedure;"
    other_functions=d.sql(others_sql)
    trees={p.name:tree_digest(p/'web') for p in (state/'files').iterdir() if (p/'overlay-proof.json').exists()}
    repair.repair(state,repo,docker=d)
    if (state/'files'/repair.PATCH).exists():raise ValueError('WORKSPACE_PREFLIGHT_WROTE_STATE')
    for interruption in ('stop','remove'):
        def interrupted(*args,**kwargs):
            if args[0]=='compose' and 'up' in args:
                original_run('stop',WEB) if interruption=='stop' else original_run('rm',WEB)
                raise RuntimeError('SYNTHETIC_WORKSPACE_WEB_INTERRUPTION')
            return original_run(*args,**kwargs)
        d.run=interrupted
        try:
            try:repair.repair(state,repo,apply=True,docker=d)
            except RuntimeError as error:
                if str(error)!='SYNTHETIC_WORKSPACE_WEB_INTERRUPTION':raise
            else:raise ValueError('WORKSPACE_INTERRUPTION_FIXTURE_REQUIRED')
        finally:d.run=original_run
    result=repair.repair(state,repo,apply=True,docker=d)
    if result['status']!='workspace_edit_consistency_repaired_browser_check_required':raise ValueError('WORKSPACE_REPAIR_STATUS_DIFFERS')
    repair.repair(state,repo,apply=True,docker=d)
    if identity_before!=d.sql(function_metadata) or other_functions!=d.sql(others_sql):raise ValueError('WORKSPACE_REPAIR_CHANGED_OTHER_AUTHORITY')
    if trees!={p:tree_digest(state/'files'/p/'web') for p in trees}:raise ValueError('WORKSPACE_REPAIR_CHANGED_OLD_OVERLAY')
    # All data below rolls back, including conflict and closed/unpublished cases.
    green='BEGIN;'+setup+"DO $$DECLARE x public.course_personal_spaces;y public.course_personal_spaces;BEGIN x:="+call+";y:="+call+";IF x.owner_id<>auth.uid() OR x.id<>y.id THEN RAISE EXCEPTION 'PERSONAL_OWNER_OR_RETRY_CHANGED';END IF;END$$;"
    deny=lambda expr,code:"DO $$BEGIN BEGIN PERFORM "+expr+";RAISE EXCEPTION 'EXPECTED_PERSONAL_REJECTION';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'"+code+"' THEN RAISE;END IF;END;END$$;"
    green+="UPDATE public.villages SET status='draft' WHERE id='"+SECOND+"';"+deny(call,'PERSONAL_SPACE_CONTEXT_MISMATCH')
    green+="UPDATE public.villages SET status='published' WHERE id='"+SECOND+"';UPDATE public.teaching_projects SET formal_project_open=false WHERE id='"+PROJECT+"';"
    formal=call.replace('practice_personal','formal_personal')
    green+=deny(formal,'PERSONAL_SPACE_CONTEXT_MISMATCH')
    green+="UPDATE public.teaching_projects SET formal_project_open=true WHERE id='"+PROJECT+"';"+deny(formal,'PERSONAL_SPACE_CONTEXT_MISMATCH')
    green+="INSERT INTO public.teaching_projects(id,course_id,name,stage,practice_village_id) VALUES('a0000000-0000-4000-8000-000000000009','course','Other project','completed','"+SECOND+"');"
    green+=deny(call.replace(PROJECT,'a0000000-0000-4000-8000-000000000009'),'PERSONAL_SPACE_PROJECT_CONFLICT')
    green+="SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);DO $$DECLARE x public.course_personal_spaces;BEGIN x:="+call+";IF x.owner_id<>auth.uid() THEN RAISE EXCEPTION 'OTHER_PERSONAL_OWNER_REUSED';END IF;END$$;ROLLBACK;"
    d.sql(green)
    # Real authenticated HTTP: ordinary experience geometry uses planning, not
    # personal_layer_versions, and does not send a null optional UUID.
    context={'teachingProjectId':PROJECT,'villageId':VILLAGE}
    own=local_call('catalog.ensureSpace',{**context,'spaceType':'formal_personal','requestId':str(uuid.uuid4())})
    context['spaceId']=own['id']
    shape={'type':'Polygon','coordinates':[[[113,23],[113.001,23],[113.001,23.001],[113,23]]]}
    local_call('planning.saveBatch',{**context,'changes':[{'action':'add','layerKey':'building','objectCode':'52','objectName':'52','afterGeom':shape,'afterProps':{},'expectedRevision':0}],'requestId':str(uuid.uuid4())})
    rows=local_call('planning.listFeatures',{**context,'layerKey':'building'})
    if not any(r['object_code']=='52' for r in rows):raise ValueError('ORDINARY_PERSONAL_ADD_NOT_PERSISTED')
    lease=local_call('planning.acquireLock',{**context,'layerKey':'building','objectCode':'52'})
    local_call('planning.saveBatch',{**context,'changes':[{'action':'delete','layerKey':'building','objectCode':'52','expectedRevision':1,'lockToken':lease['lockToken']}],'requestId':str(uuid.uuid4())})
    local_call('planning.releaseLock',{**context,'layerKey':'building','objectCode':'52','lockToken':lease['lockToken']})
    rows=local_call('planning.listFeatures',{**context,'layerKey':'building'})
    if any(r['object_code']=='52' for r in rows):raise ValueError('ORDINARY_PERSONAL_DELETE_NOT_PERSISTED')
    print('WORKSPACE_PERSONAL_CONTEXT_OWNER_SCOPE_HTTP_GEOMETRY_RECOVERY_AND_REPEAT_VERIFIED',flush=True)
