"""Disposable-only shared-access and explicit personal-result application checks."""
import json
import os
import time
import uuid
from autonomous_operator import WEB
from autonomous_extract import tree_digest
from single_personal_policy import patch_sql,replacements

PID='a0000000-0000-4000-8000-000000000001'
VID='b0000000-0000-4000-8000-000000000001'
UID='20000000-0000-4000-8000-000000000002'


def wait_auth(api):
    if os.environ.get('GITHUB_ACTIONS')!='true':raise ValueError('DISPOSABLE_AUTH_WAIT_REQUIRED')
    for attempt in range(16):
        try:api.request(api.base+'/auth/v1/health');return
        except RuntimeError as error:
            if getattr(error,'code',None)!='AUTH_UNAVAILABLE' or getattr(error,'status',None) not in (None,502,503) or attempt==15:raise
            time.sleep(1)


def verify_single_personal(state,repo,d,load,api,original_run):
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('VILLAGE_TEST_AUTONOMOUS_RUNTIME')!='1':raise ValueError('DISPOSABLE_SINGLE_PERSONAL_REQUIRED')
    repair=load('repair-autonomous-single-personal');repair.load_script=load
    d.sql("BEGIN;SELECT set_config('request.jwt.claim.sub','"+UID+"',true);DELETE FROM public.group_memberships WHERE student_key=public.current_profile_student_key();DO $$BEGIN IF public.context_space_accessible('"+PID+"','"+VID+"','A') THEN RAISE EXCEPTION 'LEGACY_READ_REJECTION_NOT_REPRODUCED';END IF;END$$;COMMIT;")
    print('SINGLE_PERSONAL_LEGACY_UNGROUPED_READ_REJECTION_REPRODUCED',flush=True)
    signature='public.context_space_mutable(uuid,uuid,text)'
    definition=d.sql("SELECT pg_get_functiondef('"+signature+"'::regprocedure);")
    before=dict((name,old) for name,old,_ in replacements(repo))[signature]
    d.sql(definition.replace(before,before+'\n-- unknown fixture\n'))
    try:
        try:d.sql(patch_sql(repo))
        except RuntimeError:pass
        else:raise ValueError('UNKNOWN_SHARED_POLICY_REPLACED')
    finally:d.sql(definition)
    if d.sql("SELECT count(1) FROM pg_attribute WHERE attrelid='public.planning_spaces'::regclass AND attname='applied_result_versions' AND NOT attisdropped;").strip()!='0':raise ValueError('SINGLE_PERSONAL_REPAIR_NOT_ATOMIC')
    old_trees={p.name:tree_digest(p/'web') for p in (state/'files').iterdir() if (p/'overlay-proof.json').exists()}
    repair.repair(state,repo,docker=d)
    if (state/'files'/repair.PATCH).exists():raise ValueError('SINGLE_PERSONAL_PREFLIGHT_WROTE_STATE')
    for interruption in ('stop','remove'):
        def interrupted(*args,**kwargs):
            if args[0]=='compose' and 'up' in args:
                original_run('stop',WEB) if interruption=='stop' else original_run('rm',WEB)
                raise RuntimeError('SYNTHETIC_SINGLE_PERSONAL_INTERRUPTION')
            return original_run(*args,**kwargs)
        d.run=interrupted
        try:
            try:repair.repair(state,repo,apply=True,docker=d)
            except RuntimeError as error:
                if str(error)!='SYNTHETIC_SINGLE_PERSONAL_INTERRUPTION':raise
            else:raise ValueError('SINGLE_PERSONAL_INTERRUPTION_REQUIRED')
        finally:d.run=original_run
    result=repair.repair(state,repo,apply=True,docker=d)
    if result['status']!='single_personal_and_shared_access_repaired_browser_check_required':raise ValueError('SINGLE_PERSONAL_STATUS_DIFFERS')
    repair.repair(state,repo,apply=True,docker=d)
    if old_trees!={p:tree_digest(state/'files'/p/'web') for p in old_trees}:raise ValueError('SINGLE_PERSONAL_CHANGED_OLD_OVERLAYS')
    wait_auth(api)
    other=api.login(('other','synthetic-ci-password-0001'));admin=api.login(('332','synthetic-ci-password-0001'))
    def call(action,body,actor=other):
        route=api.routes[action];return api.request(api.base+route['path'],actor,method=route['method'],data=body)['data']
    def forbidden(action,body,actor=other):
        try:call(action,body,actor)
        except RuntimeError as error:
            if getattr(error,'code',None)!='FORBIDDEN':raise
        else:raise ValueError('UNGROUPED_SHARED_WRITE_ALLOWED')
    context={'teachingProjectId':PID,'villageId':VID,'spaceId':'A'}
    target={**context,'layerKey':'building','objectCode':'B1'}
    spaces=call('catalog.listSpaces',{'teachingProjectId':PID,'villageId':VID})
    if next(s for s in spaces if s['id']=='A')['readonly'] is not True:raise ValueError('READONLY_CATALOG_REQUIRED')
    if not call('catalog.getSpace',context)['readonly']:raise ValueError('READONLY_SINGLE_SPACE_REQUIRED')
    if not call('planning.listFeatures',{**context,'layerKey':'building'}):raise ValueError('UNGROUPED_SHARED_READ_FAILED')
    bootstrap=call('identity.bootstrap',{})
    if not next(s for s in bootstrap['spaces'] if s['id']=='A')['readonly']:raise ValueError('READONLY_BOOTSTRAP_REQUIRED')
    call('survey.listPhotos',{**context,'objectType':'building','objectCode':'B1'})
    call('survey.listComments',{**context,'objectType':'building','objectCode':'B1'})
    forbidden('planning.acquireLock',target)
    forbidden('survey.saveAttributes',{**context,'objectType':'building','objectCode':'B1','data':{},'requestId':str(uuid.uuid4())})
    if call('catalog.getSpace',context,admin)['readonly']:raise ValueError('ADMIN_SHARED_WRITE_REJECTED')
    lease=call('planning.acquireLock',target,admin);call('planning.releaseLock',{**target,'lockToken':lease['lockToken']},admin)
    # A real group in another course does not grant writes in this project.
    d.sql("INSERT INTO public.courses(id,title,village_id) VALUES('foreign-course','Foreign','village');INSERT INTO public.course_groups(id,course_id,name,join_code,space_id) VALUES('foreign-group','foreign-course','Foreign','FOREIGN','foreign-space');INSERT INTO public.group_memberships(course_id,group_id,student_key) SELECT 'foreign-course','foreign-group',student_id||'::'||display_name FROM public.profiles WHERE id='"+UID+"';")
    forbidden('planning.acquireLock',target)
    d.sql("INSERT INTO public.group_memberships(course_id,group_id,student_key) SELECT 'course','group-a',student_id||'::'||display_name FROM public.profiles WHERE id='"+UID+"';")
    if call('catalog.getSpace',context)['readonly']:raise ValueError('GROUP_MEMBER_REMAINS_READONLY')
    lease=call('planning.acquireLock',target);call('planning.releaseLock',{**target,'lockToken':lease['lockToken']})
    d.sql("BEGIN;SELECT set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);DO $$BEGIN IF public.context_space_mutable('"+PID+"','"+VID+"','A') THEN RAISE EXCEPTION 'NON_ADMIN_STAFF_BYPASSED_GROUP';END IF;END$$;ROLLBACK;")
    # Explicit application uses the canonical personal planning space.
    personal=call('personal.ensure',{'courseId':'course','teachingProjectId':PID,'villageId':VID,'spaceType':'formal_personal','requestId':str(uuid.uuid4())})
    own={**context,'spaceId':personal['experience_space_id']}
    forbidden('catalog.getSpace',own,api.login(('student','synthetic-ci-password-0001')))
    shape={'type':'Polygon','coordinates':[[[113,23],[113.001,23],[113.001,23.001],[113,23]]]}
    road={'type':'LineString','coordinates':[[113,23],[113.001,23.001]]}
    call('planning.saveBatch',{**own,'changes':[{'action':'add','layerKey':'road','objectCode':'PreservedRoad','afterGeom':road,'afterProps':{}}],'requestId':str(uuid.uuid4())})
    bundle=str(uuid.uuid4());version=str(uuid.uuid4());contour=str(uuid.uuid4())
    d.sql("INSERT INTO public.personal_result_bundles(id,space_id,source_run_id) VALUES('"+bundle+"','"+personal['id']+"','f0000000-0000-4000-8000-000000000001');INSERT INTO public.personal_layer_versions(id,space_id,bundle_id,layer_key,version_number,source_run_id,feature_count) VALUES('"+version+"','"+personal['id']+"','"+bundle+"','building',1,'f0000000-0000-4000-8000-000000000001',1),('"+contour+"','"+personal['id']+"','"+bundle+"','contours',1,'f0000000-0000-4000-8000-000000000001',0);INSERT INTO public.personal_layer_features(space_id,layer_version_id,layer_key,object_code,object_name,geom) VALUES('"+personal['id']+"','"+version+"','building','52','Generated 52','"+json.dumps(shape)+"');")
    # Merely generating/previewing internal rows does not change experience data.
    if call('planning.listFeatures',{**own,'layerKey':'building'}):raise ValueError('UNAPPLIED_RESULT_BECAME_VISIBLE')
    select=lambda v,k='building':call('personal.setVersion',{'spaceId':personal['id'],'layerKey':k,'versionId':v,'requestId':str(uuid.uuid4())})
    select(bundle,'bundle')
    rows=call('planning.listFeatures',{**own,'layerKey':'building'})
    if len(rows)!=1 or rows[0]['object_code']=='52':raise ValueError('PERSONAL_RESULT_NOT_MATERIALIZED')
    if len(call('planning.listFeatures',{**own,'layerKey':'road'}))!=1:raise ValueError('UNRELATED_PERSONAL_LAYER_CHANGED')
    space=call('catalog.getSpace',own)
    if space['applied_result_versions']!={'building':version,'contours':contour}:raise ValueError('APPLIED_LAYER_MARKERS_REQUIRED')
    target={**own,'layerKey':'building','objectCode':rows[0]['object_code']}
    manual={'type':'Polygon','coordinates':[[[113,23],[113.002,23],[113.002,23.002],[113,23]]]}
    lease=call('planning.acquireLock',target)
    call('planning.saveBatch',{**own,'changes':[{'action':'update','layerKey':'building','objectCode':target['objectCode'],'afterGeom':manual,'afterProps':{},'expectedRevision':1,'lockToken':lease['lockToken']}],'requestId':str(uuid.uuid4())})
    call('planning.releaseLock',{**target,'lockToken':lease['lockToken']});select(version)
    if call('planning.listFeatures',{**own,'layerKey':'building'})[0]['geom']!=manual:raise ValueError('DUPLICATE_APPLY_OVERWROTE_MANUAL_EDIT')
    # A second saved bundle is applied only when selected. Acquire an
    # uncommitted lease in another native session to exercise the table fence.
    second_bundle=str(uuid.uuid4());second_version=str(uuid.uuid4())
    d.sql("INSERT INTO public.personal_result_bundles(id,space_id,source_run_id) VALUES('"+second_bundle+"','"+personal['id']+"',NULL);INSERT INTO public.personal_layer_versions(id,space_id,bundle_id,layer_key,version_number,source_run_id,feature_count) VALUES('"+second_version+"','"+personal['id']+"','"+second_bundle+"','building',2,NULL,1);INSERT INTO public.personal_layer_features(space_id,layer_version_id,layer_key,object_code,geom) VALUES('"+personal['id']+"','"+second_version+"','building','52','"+json.dumps(shape)+"');")
    import subprocess
    from autonomous_operator import PG,ADMIN,DATABASE
    lease_process=subprocess.Popen(['docker','--context','default','exec','--env','PGAPPNAME=single-personal-lease-ci','-i',PG,'psql','-X','-q','-w','-A','-t','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-U',ADMIN,'-d',DATABASE],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    script="BEGIN;SELECT set_config('request.jwt.claim.sub','"+UID+"',true);SELECT public.acquire_feature_edit_lock('"+own['spaceId']+"','"+PID+"','"+VID+"','building','"+target['objectCode']+"','B',90);SELECT pg_sleep(3);COMMIT;"
    lease_process.stdin.write(script.encode());lease_process.stdin.close()
    try:
        for attempt in range(20):
            if d.sql("SELECT count(1) FROM pg_stat_activity WHERE application_name='single-personal-lease-ci' AND wait_event='PgSleep';").strip()=='1':break
            if lease_process.poll() is not None:raise ValueError('UNCOMMITTED_LEASE_FIXTURE_NOT_READY')
            time.sleep(.1)
        else:raise ValueError('UNCOMMITTED_LEASE_FIXTURE_NOT_READY')
        try:select(second_bundle,'bundle')
        except RuntimeError:pass
        else:raise ValueError('APPLICATION_RACED_UNCOMMITTED_FEATURE_LEASE')
    finally:
        lease_process.wait(timeout=15)
        if lease_process.returncode:raise ValueError('NATIVE_LEASE_FIXTURE_FAILED')
        d.sql("DELETE FROM public.feature_edit_locks WHERE space_id='"+own['spaceId']+"' AND object_code='"+target['objectCode']+"';")
    if call('planning.listFeatures',{**own,'layerKey':'building'})[0]['geom']!=manual:raise ValueError('FAILED_APPLICATION_CHANGED_MANUAL_EDIT')
    select(second_bundle,'bundle');select(bundle,'bundle')
    if call('catalog.getSpace',own)['applied_result_versions']['building']!=version:raise ValueError('HISTORICAL_BUNDLE_NOT_APPLIED')
    if len(call('planning.listFeatures',{**own,'layerKey':'road'}))!=1:raise ValueError('BUNDLE_APPLIED_UNRELATED_HISTORICAL_LAYER')
    bad_bundle=str(uuid.uuid4());bad_building=str(uuid.uuid4());bad_road=str(uuid.uuid4())
    d.sql("INSERT INTO public.personal_result_bundles(id,space_id,source_run_id) VALUES('"+bad_bundle+"','"+personal['id']+"',NULL);INSERT INTO public.personal_layer_versions(id,space_id,bundle_id,layer_key,version_number,source_run_id,feature_count) VALUES('"+bad_building+"','"+personal['id']+"','"+bad_bundle+"','building',3,NULL,0),('"+bad_road+"','"+personal['id']+"','"+bad_bundle+"','road',1,NULL,99);")
    try:select(bad_bundle,'bundle')
    except RuntimeError:pass
    else:raise ValueError('INCOMPLETE_BUNDLE_APPLIED')
    if call('catalog.getSpace',own)['applied_result_versions']['building']!=version or len(call('planning.listFeatures',{**own,'layerKey':'building'}))!=1:raise ValueError('BUNDLE_APPLICATION_NOT_ATOMIC')
    forbidden('personal.setVersion',{'spaceId':personal['id'],'layerKey':'building','versionId':version,'requestId':str(uuid.uuid4())},admin)
    # Membership removal takes effect server-side, even with a cached session.
    d.sql("DELETE FROM public.group_memberships WHERE course_id='course' AND student_key=(SELECT student_id||'::'||display_name FROM public.profiles WHERE id='"+UID+"');")
    forbidden('planning.acquireLock',context|{'layerKey':'building','objectCode':'B1'})
    d.sql("BEGIN;SELECT set_config('request.jwt.claim.sub','',true);DO $$BEGIN IF public.context_space_accessible('"+PID+"','"+VID+"','A') THEN RAISE EXCEPTION 'ANONYMOUS_SHARED_ACCESS_ALLOWED';END IF;END$$;ROLLBACK;")
    d.sql("UPDATE public.profiles SET disabled_at=now() WHERE id='"+UID+"';")
    try:
        try:call('catalog.getSpace',context)
        except RuntimeError as error:
            if getattr(error,'code',None)!='PROFILE_DISABLED':raise
        else:raise ValueError('DISABLED_PROFILE_SHARED_ACCESS_ALLOWED')
    finally:d.sql("UPDATE public.profiles SET disabled_at=NULL WHERE id='"+UID+"';")
    print('SINGLE_PERSONAL_SHARED_READ_MEMBER_WRITE_ADMIN_SCOPE_EXPLICIT_APPLY_AND_RECOVERY_VERIFIED',flush=True)
