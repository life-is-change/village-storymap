-- User-approved 2026-10-19: synthetic rows only in the C2a candidate.
__BEGIN__
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $fixture$
DECLARE owner_row public.profiles; member_row public.profiles; reserved bigint; ready boolean;
BEGIN
 IF current_database()<>'village_scene_files_validation' THEN RAISE EXCEPTION 'WRONG_CANDIDATE_DATABASE';END IF;
 SELECT * INTO STRICT owner_row FROM public.profiles WHERE student_id='332' AND role='admin';
 SELECT * INTO STRICT member_row FROM public.profiles WHERE student_id='25213040' AND role='student';
 IF owner_row.display_name IS NULL OR member_row.display_name IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=owner_row.id) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=member_row.id) THEN RAISE EXCEPTION 'C2A_TEST_PROFILES_REQUIRED';END IF;
 -- CREATE ONLY BEGIN
 PERFORM pg_advisory_xact_lock(183627,20191019);
 -- CREATE ONLY END
 SELECT
  (SELECT count(*) FROM public.courses WHERE id='c2a-test-20261019')+
  (SELECT count(*) FROM public.villages WHERE id='c2a00000-0000-4000-8000-000000000001')+
  (SELECT count(*) FROM public.teaching_projects WHERE id='c2a00000-0000-4000-8000-000000000002')+
  (SELECT count(*) FROM public.course_groups WHERE id='c2a-test-group-20261019' OR course_id='c2a-test-20261019')+
  (SELECT count(*) FROM public.planning_spaces WHERE id='c2a-test-space-20261019' OR course_id='c2a-test-20261019')+
  (SELECT count(*) FROM public.group_memberships WHERE course_id='c2a-test-20261019' OR group_id='c2a-test-group-20261019') INTO reserved;
 SELECT reserved=6
  AND EXISTS(SELECT 1 FROM public.courses WHERE id='c2a-test-20261019' AND title='C2a TEST course' AND village_id='c2a00000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.villages WHERE id='c2a00000-0000-4000-8000-000000000001' AND name='C2a TEST village' AND is_practice AND created_by=owner_row.id AND boundary::text=('__BOUNDARY_EWKT__'::extensions.geometry)::text)
  AND EXISTS(SELECT 1 FROM public.teaching_projects WHERE id='c2a00000-0000-4000-8000-000000000002' AND name='C2a TEST project' AND course_id='c2a-test-20261019' AND practice_village_id='c2a00000-0000-4000-8000-000000000001' AND created_by=owner_row.id)
  AND EXISTS(SELECT 1 FROM public.course_groups WHERE id='c2a-test-group-20261019' AND course_id='c2a-test-20261019' AND name='C2a TEST group' AND space_id='c2a-test-space-20261019' AND created_by=owner_row.student_id||'::'||owner_row.display_name)
  AND EXISTS(SELECT 1 FROM public.planning_spaces WHERE id='c2a-test-space-20261019' AND title='C2a TEST space' AND course_id='c2a-test-20261019' AND group_id='c2a-test-group-20261019' AND space_type='group_plan' AND teaching_project_id='c2a00000-0000-4000-8000-000000000002' AND village_id='c2a00000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.group_memberships WHERE course_id='c2a-test-20261019' AND group_id='c2a-test-group-20261019' AND student_key=member_row.student_id||'::'||member_row.display_name AND student_id=member_row.student_id AND student_name=member_row.display_name AND role='member') INTO ready;
 IF reserved>0 AND NOT ready THEN RAISE EXCEPTION 'C2A_TEST_CONTEXT_COLLISION';END IF;
 -- CREATE ONLY BEGIN
 IF reserved=0 THEN
  INSERT INTO public.villages(id,name,is_practice,boundary,status,created_by) VALUES('c2a00000-0000-4000-8000-000000000001','C2a TEST village',true,'__BOUNDARY_EWKT__'::extensions.geometry,'draft',owner_row.id);
  INSERT INTO public.courses(id,title,village_id) VALUES('c2a-test-20261019','C2a TEST course','c2a00000-0000-4000-8000-000000000001');
  INSERT INTO public.teaching_projects(id,course_id,name,practice_village_id,stage,created_by) VALUES('c2a00000-0000-4000-8000-000000000002','c2a-test-20261019','C2a TEST project','c2a00000-0000-4000-8000-000000000001','design',owner_row.id);
  INSERT INTO public.course_groups(id,course_id,name,join_code,created_by,space_id) VALUES('c2a-test-group-20261019','c2a-test-20261019','C2a TEST group','C2A-TEST-'||replace(gen_random_uuid()::text,'-',''),owner_row.student_id||'::'||owner_row.display_name,'c2a-test-space-20261019');
  INSERT INTO public.planning_spaces(id,title,course_id,group_id,space_type,teaching_project_id,village_id,creator_name,readonly,edit_enabled) VALUES('c2a-test-space-20261019','C2a TEST space','c2a-test-20261019','c2a-test-group-20261019','group_plan','c2a00000-0000-4000-8000-000000000002','c2a00000-0000-4000-8000-000000000001','C2a TEST',false,true);
  INSERT INTO public.group_memberships(course_id,group_id,student_key,student_name,student_id,role) VALUES('c2a-test-20261019','c2a-test-group-20261019',member_row.student_id||'::'||member_row.display_name,member_row.display_name,member_row.student_id,'member');
 END IF;
 -- CREATE ONLY END
END;
$fixture$;
SELECT json_build_object('status',CASE WHEN EXISTS(SELECT 1 FROM public.courses WHERE id='c2a-test-20261019') THEN 'ready' ELSE 'empty' END,'course_id','c2a-test-20261019','test_memberships',(SELECT count(*) FROM public.group_memberships WHERE course_id='c2a-test-20261019')) AS data;
COMMIT;
