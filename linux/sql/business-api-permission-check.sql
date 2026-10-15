BEGIN;
SET LOCAL statement_timeout='15s';
DO $test$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); actor uuid;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,aud,role)
 VALUES(a,'vapi-'||a||'@example.invalid',jsonb_build_object('student_id','vapi_'||left(replace(a::text,'-',''),12),'display_name','API Test A','role','admin'),'{}','authenticated','authenticated'),
       (b,'vapi-'||b||'@example.invalid',jsonb_build_object('student_id','vapi_'||left(replace(b::text,'-',''),12),'display_name','API Test B','role','admin'),'{}','authenticated','authenticated');
 IF (SELECT count(*) FROM public.profiles WHERE id IN (a,b) AND role='student')<>2 THEN RAISE EXCEPTION 'AUTH_PROFILE_TRIGGER_CONTRACT'; END IF;
 FOREACH actor IN ARRAY ARRAY[a,b] LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text,true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.uid()<>actor OR public.current_profile_role()<>'student' THEN RAISE EXCEPTION 'VERIFIED_IDENTITY_CONTRACT'; END IF;
  IF (SELECT count(*) FROM public.profiles WHERE id=actor)<>1 OR EXISTS(SELECT 1 FROM public.profiles WHERE id<>actor) THEN RAISE EXCEPTION 'CROSS_USER_PROFILE_LEAK'; END IF;
  IF EXISTS(SELECT 1 FROM public.course_personal_spaces WHERE owner_id<>actor) THEN RAISE EXCEPTION 'CROSS_USER_PERSONAL_SPACE_LEAK'; END IF;
  IF EXISTS(SELECT 1 FROM public.planning_spaces s WHERE s.space_type IN ('course_group','group_plan') AND NOT EXISTS(SELECT 1 FROM public.group_memberships m WHERE m.group_id=s.group_id AND m.student_key=public.current_profile_student_key())) THEN RAISE EXCEPTION 'NON_MEMBER_GROUP_SPACE_LEAK'; END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 UPDATE public.profiles SET role='teacher' WHERE id=a;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF public.current_profile_role()<>'teacher' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=b) THEN RAISE EXCEPTION 'STAFF_SCOPE_CONTRACT'; END IF;
 EXECUTE 'RESET ROLE';
 UPDATE public.profiles SET role='admin' WHERE id=a;
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF public.current_profile_role()<>'admin' THEN RAISE EXCEPTION 'ADMIN_SCOPE_CONTRACT'; END IF;
 EXECUTE 'RESET ROLE';
END $test$;
ROLLBACK;
