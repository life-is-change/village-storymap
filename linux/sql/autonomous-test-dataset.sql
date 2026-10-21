-- Synthetic baseline only. No source or ordinary business rows are changed.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $test_dataset$
DECLARE s public.planning_spaces; p public.teaching_projects; v public.villages; d public.village_datasets;
BEGIN
 IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'AUTONOMOUS_TARGET_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(183627,20191019);
 SELECT * INTO STRICT s FROM public.planning_spaces WHERE id='unified-test-autonomous-20261021' FOR UPDATE;
 SELECT * INTO STRICT p FROM public.teaching_projects WHERE id='c4a00000-0000-4000-8000-000000000002';
 SELECT * INTO STRICT v FROM public.villages WHERE id='c4a00000-0000-4000-8000-000000000001';
 IF s.title IS DISTINCT FROM 'Autonomous TEST space' OR s.course_id IS DISTINCT FROM 'autonomous-test-20261021'
 OR s.teaching_project_id IS DISTINCT FROM p.id OR s.village_id IS DISTINCT FROM v.id
 OR s.group_id IS DISTINCT FROM 'autonomous-test-group-20261021' OR s.space_type IS DISTINCT FROM 'practice_shared'
 OR s.readonly IS DISTINCT FROM false OR s.edit_enabled IS DISTINCT FROM true
 OR p.name IS DISTINCT FROM 'Autonomous TEST project' OR p.course_id IS DISTINCT FROM s.course_id OR p.stage IS DISTINCT FROM 'completed'
 OR p.practice_village_id IS DISTINCT FROM v.id OR p.created_by IS DISTINCT FROM '__ADMIN_ID__'::uuid
 OR v.name IS DISTINCT FROM 'Autonomous TEST village' OR v.is_practice IS DISTINCT FROM true OR v.created_by IS DISTINCT FROM p.created_by
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p.created_by AND role='admin' AND disabled_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.courses WHERE id=s.course_id AND title='Autonomous TEST course' AND village_id=v.id::text)
 OR NOT EXISTS(SELECT 1 FROM public.group_memberships m JOIN public.profiles u ON u.student_id=m.student_id
  WHERE m.course_id=s.course_id AND m.group_id=s.group_id AND u.id='__MEMBER_ID__'::uuid AND u.role='student')
 THEN RAISE EXCEPTION 'AUTONOMOUS_TEST_SCOPE_REQUIRED';END IF;
 IF (s.base_dataset_id IS NOT NULL AND s.base_dataset_id<>'c4a00000-0000-4000-8000-000000000003'::uuid)
 OR EXISTS(SELECT 1 FROM public.village_datasets WHERE village_id=v.id AND id<>'c4a00000-0000-4000-8000-000000000003'::uuid)
 THEN RAISE EXCEPTION 'AUTONOMOUS_TEST_DATASET_COLLISION';END IF;
 SELECT * INTO d FROM public.village_datasets WHERE id='c4a00000-0000-4000-8000-000000000003';
 IF FOUND THEN
  IF d.village_id IS DISTINCT FROM v.id OR d.version_number IS DISTINCT FROM 1 OR d.version_label IS DISTINCT FROM 'Autonomous TEST baseline'
  OR d.source_kind IS DISTINCT FROM 'uploaded_bundle' OR d.status IS DISTINCT FROM 'ready' OR d.created_by IS DISTINCT FROM p.created_by
  OR d.imagery_config IS NOT NULL OR d.layer_manifest IS DISTINCT FROM '{}'::jsonb
  OR d.validation_summary IS DISTINCT FROM '{"synthetic":true,"purpose":"autonomous-acceptance"}'::jsonb
  THEN RAISE EXCEPTION 'AUTONOMOUS_TEST_DATASET_COLLISION';END IF;
 ELSE
  INSERT INTO public.village_datasets(id,village_id,version_number,version_label,source_kind,status,created_by,layer_manifest,validation_summary)
  VALUES('c4a00000-0000-4000-8000-000000000003',v.id,1,'Autonomous TEST baseline','uploaded_bundle','ready',p.created_by,'{}','{"synthetic":true,"purpose":"autonomous-acceptance"}');
 END IF;
 UPDATE public.planning_spaces SET base_dataset_id='c4a00000-0000-4000-8000-000000000003'
 WHERE id='unified-test-autonomous-20261021' AND base_dataset_id IS NULL;
END;
$test_dataset$;
SELECT json_build_object('status','test_baseline_ready');
COMMIT;
