"""Semester isolation acceptance, only in the disposable autonomous CI runtime."""
import json
import os
import uuid
from semester_group_policy import patch_sql

PID='a0000000-0000-4000-8000-000000000001'
NEXT='a0000000-0000-4000-8000-000000000081'
VID='b0000000-0000-4000-8000-000000000001'
PRACTICE='b0000000-0000-4000-8000-000000000082'
STUDENT='10000000-0000-4000-8000-000000000001'
LAB='20000000-0000-4000-8000-000000000002'
ADMIN='40000000-0000-4000-8000-000000000004'
GID='cf5a8891-7505-4fd1-a782-6ca1a2d16456'


def verify_semester_groups(repo,d):
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('VILLAGE_TEST_AUTONOMOUS_RUNTIME')!='1':
        raise ValueError('DISPOSABLE_SEMESTER_GROUPS_REQUIRED')
    q=lambda s:"'"+s.replace("'","''")+"'"
    expecting=None
    def actor(uid,expression):
        if expecting:
            # Verify the intended application error inside SQL; permission errors,
            # syntax failures and missing functions cannot count as successful rejection.
            accepted="'FORBIDDEN','INVALID_INPUT','STAFF_REQUIRED','GROUP_MEMBERSHIP_REQUIRED','FORMAL_VILLAGE_PROJECT_REQUIRED','PRACTICE_GROUP_SPACE_FORBIDDEN','SCENE_EDIT_FORBIDDEN'"
            return d.sql('BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='+q(uid)+
                '; DO $negative$ DECLARE failed boolean:=false; BEGIN BEGIN PERFORM '+expression+
                '; EXCEPTION WHEN SQLSTATE \'P0001\' THEN IF SQLERRM NOT IN ('+accepted+') THEN RAISE; END IF; failed:=true; END; IF NOT failed THEN RAISE EXCEPTION '+q(expecting)+
                '; END IF; END $negative$; COMMIT;') or 'null'
        return d.sql('BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='+q(uid)+'; SELECT '+expression+'; COMMIT;').strip()
    def call(action,body,uid=ADMIN):
        data={'courseId':'course','teachingProjectId':PID,**body}
        if action in ('createGroup','joinGroup','setProgress','lockGroup'):
            data['requestId']=data.get('requestId',str(uuid.uuid4()))
        fn='write' if 'requestId' in data else 'read'
        return json.loads(actor(uid,'api_private.catalog_'+fn+'('+q('catalog.'+action)+','+q(json.dumps(data))+'::jsonb)'))
    def reject(operation,label):
        nonlocal expecting
        expecting=label
        try:operation()
        finally:expecting=None
    # The preflight must not accept a drifted function or create any columns.
    signature='public.ensure_group_plan_space(uuid,uuid,text,uuid)'
    definition=d.sql('SELECT pg_get_functiondef('+q(signature)+'::regprocedure);')
    body=d.sql('SELECT prosrc FROM pg_proc WHERE oid='+q(signature)+'::regprocedure;')
    # pg_get_functiondef formats header only; append inside its known dollar body.
    drift=definition.replace(body,body+'\n-- unknown semester fixture\n')
    if drift==definition:raise ValueError('SEMESTER_DRIFT_FIXTURE_REQUIRED')
    d.sql(drift)
    try:
        try:d.sql(patch_sql(repo,apply=False))
        except RuntimeError:
            log=max(d.state.glob('operator-*.log'),key=lambda p:p.stat().st_mtime)
            if 'SEMESTER_GROUP_FUNCTION_CHANGED' not in log.read_text():raise
        else:raise ValueError('SEMESTER_UNKNOWN_FUNCTION_ACCEPTED')
    finally:d.sql(definition)
    d.sql(patch_sql(repo,apply=False))
    if d.sql("SELECT count(*) FROM pg_attribute WHERE attrelid='public.course_groups'::regclass AND attname='scope_kind' AND NOT attisdropped;").strip()!='0':
        raise ValueError('SEMESTER_PREFLIGHT_WROTE_SCHEMA')
    before_profiles=d.sql('SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM public.profiles p;')
    before_members=d.sql('SELECT count(*) FROM public.group_memberships;')
    d.sql(patch_sql(repo))
    d.sql(patch_sql(repo))
    helper='public.project_group_eligible(text,uuid)'
    helper_def=d.sql('SELECT pg_get_functiondef('+q(helper)+'::regprocedure);')
    helper_body=d.sql('SELECT prosrc FROM pg_proc WHERE oid='+q(helper)+'::regprocedure;').strip()
    d.sql(helper_def.replace(helper_body,'SELECT true'))
    try:
        try:d.sql(patch_sql(repo,apply=False))
        except RuntimeError:
            log=max(d.state.glob('operator-*.log'),key=lambda p:p.stat().st_mtime)
            if 'SEMESTER_GROUP_HELPER_CHANGED' not in log.read_text():raise
        else:raise ValueError('SEMESTER_ELIGIBILITY_DRIFT_ACCEPTED')
    finally:d.sql(helper_def)
    if d.sql('SELECT count(*) FROM public.group_memberships;')!=before_members:raise ValueError('SEMESTER_MEMBERS_REMOVED')
    if d.sql('SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM public.profiles p;')!=before_profiles:raise ValueError('SEMESTER_PROFILE_ROLE_CHANGED')
    d.sql("INSERT INTO public.course_groups(id,course_id,name,join_code,scope_kind) VALUES('"+GID+"','foreign-course','332 实验室协作组','332','lab') ON CONFLICT(id) DO NOTHING;")
    g1=call('createGroup',{'name':'Semester one','code':'FIRST101'})
    if g1['teaching_project_id']!=PID or g1['formal_village_id']!=VID:raise ValueError('SEMESTER_GROUP_SCOPE_MISSING')
    call('joinGroup',{'code':g1['join_code']},STUDENT)
    call('joinGroup',{'code':'332'},LAB)
    call('setProgress',{'taskId':'learning-ready','complete':True},STUDENT)
    reject(lambda:call('createGroup',{'name':'Forged lab','code':'332'}),'SEMESTER_RESERVED_CODE_ALLOWED')
    reject(lambda:call('createGroup',{'name':'Student create'},LAB),'LAB_MEMBER_BECAME_STAFF')
    reject(lambda:call('groupRoster',{},LAB),'SEMESTER_ROSTER_LEAK')
    retry={'name':'Idempotent','requestId':str(uuid.uuid4())}
    if call('createGroup',retry)!=call('createGroup',retry):raise ValueError('SEMESTER_CREATE_NOT_IDEMPOTENT')
    # Freeze a real shared snapshot; it must not create any practice plan.
    def freeze(pid,sid):
        payload={'teachingProjectId':pid,'villageId':VID,'spaceId':sid,'label':'Semester baseline','recommendedForGroups':True,'requestId':str(uuid.uuid4())}
        return json.loads(actor(ADMIN,"api_private.survey_write('survey.freezeSnapshot',"+q(json.dumps(payload))+"::jsonb)"))
    def ensure(pid,vid,gid,uid=ADMIN):
        payload={'teachingProjectId':pid,'villageId':vid,'groupId':gid,'requestId':str(uuid.uuid4())}
        return json.loads(actor(uid,"api_private.catalog_write('admin.ensureGroupSpace',"+q(json.dumps(payload))+"::jsonb)"))
    def planning(name,payload,uid=STUDENT):
        data={**payload,'requestId':str(uuid.uuid4())}
        return json.loads(actor(uid,"api_private.planning_write("+q(name)+","+q(json.dumps(data))+"::jsonb)"))
    def personal(pid):
        return planning('personal.ensure',{'courseId':'course','teachingProjectId':pid,'villageId':VID,'spaceType':'formal_personal'})
    freeze(PID,'A')
    ctx=call('getCourseContext',{},LAB)
    first_space=ctx['group']['space_id']
    if not first_space:raise ValueError('LAB_FIRST_SPACE_MISSING')
    if call('getCourseContext',{},STUDENT)['group']['id']!=g1['id']:raise ValueError('STUDENT_GROUP_CONTEXT_WRONG')
    reject(lambda:ensure(PID,VID,GID,STUDENT),'STUDENT_ENTERED_LAB_GROUP')
    old_personal=personal(PID)
    old_student=call('getCourseContext',{},STUDENT)['group']['space_id']
    def scene_create(pid,sid,gid,uid):
        return json.loads(actor(uid,"public.scene_edit_create_project('"+pid+"','"+VID+"','"+sid+"','"+gid+"','Semester scene',0,NULL,'group')"))
    lab_scene=scene_create(PID,first_space,GID,LAB)
    if json.loads(actor(LAB,"public.scene_edit_load_project('"+lab_scene['id']+"')"))['groupId']!=GID:raise ValueError('LAB_CROSS_COURSE_SCENE_UNREADABLE')
    student_scene=scene_create(PID,old_student,g1['id'],STUDENT)
    student_document=json.loads(actor(STUDENT,"public.scene_edit_load_project('"+student_scene['id']+"')"))
    update_id,conflict_id,restore_id=(str(uuid.uuid4()) for _ in range(3))
    d.sql("INSERT INTO public.group_baseline_updates(id,teaching_project_id,village_id,space_id,group_id,from_snapshot_id,to_snapshot_id,status,created_by) SELECT '"+update_id+"',teaching_project_id,village_id,id,group_id,base_snapshot_id,base_snapshot_id,'completed','"+ADMIN+"' FROM public.planning_spaces WHERE id='"+old_student+"'; INSERT INTO public.group_baseline_conflicts(id,update_id,teaching_project_id,village_id,space_id,group_id,layer_key,object_code,conflict_type) SELECT '"+conflict_id+"','"+update_id+"',teaching_project_id,village_id,id,group_id,'building','ArchivedObject','both_changed' FROM public.planning_spaces WHERE id='"+old_student+"'; INSERT INTO public.group_plan_restore_points(id,teaching_project_id,village_id,space_id,group_id,baseline_snapshot_id,created_by) SELECT '"+restore_id+"',teaching_project_id,village_id,id,group_id,base_snapshot_id,'"+ADMIN+"' FROM public.planning_spaces WHERE id='"+old_student+"';")
    conflict_before=d.sql("SELECT md5(to_jsonb(c)::text) FROM public.group_baseline_conflicts c WHERE id='"+conflict_id+"';")
    # Same formal village, new semester: group codes/members/progress must be independent.
    d.sql("INSERT INTO public.villages(id,name,boundary,status,is_practice) SELECT '"+PRACTICE+"','Scope practice',boundary,'published',true FROM public.villages WHERE id='"+VID+"'; UPDATE public.teaching_projects SET stage='archived' WHERE id='"+PID+"'; INSERT INTO public.teaching_projects(id,course_id,name,stage,practice_village_id,formal_village_id,formal_project_open) SELECT '"+NEXT+"',course_id,'Next semester','preparing','"+PRACTICE+"',formal_village_id,true FROM public.teaching_projects WHERE id='"+PID+"';")
    reject(lambda:planning('planning.resolveConflict',{'conflictId':conflict_id,'resolution':'keep_group'}),'ARCHIVED_CONFLICT_CHANGED')
    reject(lambda:planning('planning.restorePoint',{'restorePointId':restore_id},ADMIN),'ARCHIVED_RESTORE_CHANGED')
    reject(lambda:actor(STUDENT,"public.scene_edit_save_draft('"+student_scene['id']+"',0,"+q(json.dumps(student_document))+"::jsonb)"),'ARCHIVED_SCENE_DRAFT_CHANGED')
    reject(lambda:actor(STUDENT,"public.scene_edit_create_version('"+student_scene['id']+"',0,'Archived version','',NULL)"),'ARCHIVED_SCENE_VERSION_CHANGED')
    if d.sql("SELECT revision FROM public.scene_edit_projects WHERE id='"+student_scene['id']+"';").strip()!='0':raise ValueError('ARCHIVED_SCENE_WAS_MUTATED')
    if d.sql("SELECT md5(to_jsonb(c)::text) FROM public.group_baseline_conflicts c WHERE id='"+conflict_id+"';")!=conflict_before:raise ValueError('ARCHIVED_CONFLICT_MUTATED')
    if personal(NEXT)['id']==old_personal['id']:raise ValueError('PERSONAL_RESULT_SPACE_REUSED_NEXT_SEMESTER')
    # Fixture setup alone uses the DB owner; permission tests use only API wrappers.
    shared=d.sql("BEGIN;SET LOCAL request.jwt.claim.sub='"+ADMIN+"'; SELECT (public.ensure_context_space('"+NEXT+"','"+VID+"','formal_shared','Next shared',NULL)).id; COMMIT;").strip()
    call_next=lambda name,body={},uid=ADMIN:call(name,{'teachingProjectId':NEXT,**body},uid)
    if not call_next('getSpace',{'villageId':VID,'spaceId':shared},STUDENT)['readonly']:raise ValueError('PREVIOUS_MEMBERSHIP_GRANTED_SHARED_WRITE')
    listed=call_next('listGroups')
    if [g['id'] for g in listed]!=[GID]:raise ValueError('PREVIOUS_SEMESTER_GROUP_LEAK')
    reject(lambda:call_next('joinGroup',{'code':g1['join_code']},STUDENT),'PREVIOUS_CODE_JOINED_NEXT_SEMESTER')
    g2=call_next('createGroup',{'name':'Semester two','code':'SECOND101'})
    call_next('joinGroup',{'code':g2['join_code']},STUDENT)
    if call_next('getProgress',{},STUDENT)['completedTaskIds']:raise ValueError('PREVIOUS_PROGRESS_LEAK')
    call_next('setProgress',{'taskId':'learning-ready','complete':True},STUDENT)
    if d.sql("SELECT count(*) FROM public.task_progress WHERE student_key=(SELECT student_id||'::'||display_name FROM public.profiles WHERE id='"+STUDENT+"') AND task_id='learning-ready' AND teaching_project_id IN('"+PID+"','"+NEXT+"');").strip()!='2':raise ValueError('SEMESTER_PROGRESS_OVERWROTE_HISTORY')
    if call_next('getCourseContext',{},LAB)['group']['id']!=GID:raise ValueError('LAB_MEMBERSHIP_NOT_PERSISTENT')
    waiting=ensure(NEXT,VID,g2['id'])
    if waiting.get('status')!='waiting_for_snapshot':raise ValueError('SEMESTER_FALSE_SPACE_CREATED')
    freeze(NEXT,shared)
    next_lab=call_next('getCourseContext',{},LAB)['group']['space_id']
    if not next_lab or next_lab==first_space:raise ValueError('LAB_REUSED_PREVIOUS_SEMESTER_SPACE')
    if call_next('getSpace',{'villageId':VID,'spaceId':next_lab},LAB)['id']!=next_lab:raise ValueError('LAB_OWN_SPACE_UNREADABLE')
    reject(lambda:call_next('getSpace',{'villageId':VID,'spaceId':next_lab},STUDENT),'LAB_SPACE_LEAKED_TO_STUDENT')
    # Different formal village and practice village are rejected by the DB, including staff calls.
    practice=d.sql('SELECT practice_village_id FROM public.teaching_projects WHERE id='+q(NEXT)+';').strip()
    reject(lambda:ensure(NEXT,practice,GID),'PRACTICE_GROUP_PLAN_ALLOWED')
    reject(lambda:ensure(NEXT,VID,g1['id']),'PREVIOUS_GROUP_PLAN_IN_NEXT_SEMESTER')
    reject(lambda:call('createGroup',{'name':'Archived write'}),'ARCHIVED_SEMESTER_WRITE_ALLOWED')
    if call_next('groupRoster')['memberships']==[]:raise ValueError('SEMESTER_ROSTER_EMPTY')
    if d.sql('SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM public.profiles p;')!=before_profiles:raise ValueError('SEMESTER_ROLE_CHANGED')
    print('SEMESTER_GROUPS_OLD_CODE_MEMBERSHIP_PROGRESS_LAB_BASELINE_AND_PRACTICE_ISOLATION_VERIFIED',flush=True)


def verify_semester_rollout(state,repo,d,load,original_run):
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('VILLAGE_TEST_AUTONOMOUS_RUNTIME')!='1':raise ValueError('DISPOSABLE_SEMESTER_ROLLOUT_REQUIRED')
    from autonomous_operator import API
    repair=load('repair-autonomous-semester-groups');repair.load_script=load
    original_prepare=repair.prepare_files
    def partial(original,root,updates,contract):
        stage=root/'web-preparing';stage.mkdir(parents=True,exist_ok=True)
        name=next(iter(updates));path=stage/name;path.parent.mkdir(parents=True,exist_ok=True)
        part=path.with_name(path.name+'.semester-part');part.write_bytes(updates[name][:16])
        raise RuntimeError('SYNTHETIC_SEMESTER_PREPARATION_INTERRUPTION')
    repair.prepare_files=partial
    try:
        try:repair.repair(state,repo,apply=True,docker=d)
        except RuntimeError as error:
            if str(error)!='SYNTHETIC_SEMESTER_PREPARATION_INTERRUPTION':raise
        else:raise ValueError('SEMESTER_PREPARATION_INTERRUPTION_NOT_REACHED')
    finally:repair.prepare_files=original_prepare
    for interruption in ('stop','remove'):
        def interrupted(*args,**kwargs):
            if args[0]=='compose' and 'up' in args:
                original_run('stop',API) if interruption=='stop' else original_run('rm','--force',API)
                raise RuntimeError('SYNTHETIC_SEMESTER_API_INTERRUPTION')
            return original_run(*args,**kwargs)
        d.run=interrupted
        try:
            try:repair.repair(state,repo,apply=True,docker=d)
            except RuntimeError as error:
                if str(error)!='SYNTHETIC_SEMESTER_API_INTERRUPTION':raise
            else:raise ValueError('SEMESTER_API_INTERRUPTION_NOT_REACHED')
        finally:d.run=original_run
    result=repair.repair(state,repo,apply=True,docker=d)
    if result['status']!='semester_groups_deployed_browser_acceptance_required':raise ValueError('SEMESTER_ROLLOUT_NOT_COMPLETE')
    repair.repair(state,repo,apply=True,docker=d)
    print('SEMESTER_PREPARATION_STOPPED_AND_REMOVED_API_RECOVERY_VERIFIED',flush=True)
