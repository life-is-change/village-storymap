-- Install after identity.sql, in the isolated candidate database only.
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED'; END IF;END$$;
CREATE TABLE api_private.operation_receipts(
 actor_id uuid NOT NULL,request_id uuid NOT NULL,action text NOT NULL,input jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,request_id)
);
CREATE FUNCTION api_private.student_key() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,auth,pg_temp AS $$SELECT student_id||'::'||display_name FROM public.profiles WHERE id=auth.uid()$$;
CREATE FUNCTION api_private.staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,api_private,pg_temp AS $$SELECT coalesce(api_private.current_role() IN ('teacher','admin'),false)$$;
CREATE FUNCTION api_private.assert_context(p jsonb) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.planning_spaces s WHERE s.id=p->>'spaceId'
   AND s.teaching_project_id=(p->>'teachingProjectId')::uuid AND s.village_id=(p->>'villageId')::uuid
   AND (api_private.staff() OR s.owner_id=auth.uid() OR s.space_type IN ('practice_shared','formal_shared')
     OR EXISTS(SELECT 1 FROM public.group_memberships m WHERE m.group_id=s.group_id AND m.student_key=api_private.student_key()))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
END$$;
CREATE FUNCTION api_private.catalog_read(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,extensions,pg_temp AS $$DECLARE result jsonb; BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 CASE a
 WHEN 'catalog.listCourses' THEN SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') INTO result FROM (SELECT * FROM public.courses ORDER BY id LIMIT 200)c;
 WHEN 'catalog.listGroups' THEN SELECT coalesce(jsonb_agg(CASE WHEN api_private.staff() OR EXISTS(SELECT 1 FROM public.group_memberships m WHERE m.group_id=g.id AND m.student_key=api_private.student_key()) THEN to_jsonb(g) ELSE to_jsonb(g)-'join_code' END),'[]') INTO result FROM (SELECT * FROM public.course_groups WHERE course_id=p->>'courseId' ORDER BY created_at LIMIT 200)g;
 WHEN 'catalog.getProgress' THEN SELECT jsonb_build_object('completedTaskIds',coalesce(jsonb_agg(task_id) FILTER(WHERE completed),'[]')) INTO result FROM public.task_progress WHERE course_id=p->>'courseId' AND student_key=api_private.student_key();
 WHEN 'catalog.getCourseContext' THEN
 SELECT jsonb_build_object('course',to_jsonb(c),'membership',(SELECT to_jsonb(m) FROM public.group_memberships m WHERE m.course_id=c.id AND m.student_key=api_private.student_key()),'group',(SELECT to_jsonb(g) FROM public.course_groups g JOIN public.group_memberships m ON m.group_id=g.id WHERE m.course_id=c.id AND m.student_key=api_private.student_key()),'progress',api_private.catalog_read('catalog.getProgress',p)) INTO result FROM public.courses c WHERE c.id=p->>'courseId';
 WHEN 'catalog.listActivity' THEN
 IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') INTO result FROM (SELECT * FROM public.activity_events WHERE course_id=p->>'courseId' ORDER BY occurred_at DESC LIMIT least(coalesce((p->>'limit')::integer,100),200))e;
 WHEN 'catalog.getActiveContext' THEN result:=public.get_active_project_context();
 WHEN 'catalog.listVillages' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('village_datasets',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.village_datasets d WHERE d.village_id=v.id AND (api_private.staff() OR d.status='published')),'[]'),'village_reality_models',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.village_reality_models r WHERE r.village_id=v.id AND (api_private.staff() OR r.status='published')),'[]'))),'[]') INTO result FROM (SELECT * FROM public.villages WHERE status='published' OR api_private.staff() ORDER BY name LIMIT 200)v;
 WHEN 'catalog.listSpaces' THEN SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') INTO result FROM (SELECT * FROM public.planning_spaces s WHERE s.teaching_project_id=(p->>'teachingProjectId')::uuid AND s.village_id=(p->>'villageId')::uuid AND (api_private.staff() OR s.owner_id=auth.uid() OR s.space_type IN ('practice_shared','formal_shared') OR EXISTS(SELECT 1 FROM public.group_memberships m WHERE m.group_id=s.group_id AND m.student_key=api_private.student_key())) ORDER BY s.id LIMIT 200)s;
 WHEN 'catalog.getSpace' THEN PERFORM api_private.assert_context(p);SELECT to_jsonb(s) INTO result FROM public.planning_spaces s WHERE s.id=p->>'spaceId';
 WHEN 'admin.listUsers' THEN IF api_private.current_role()<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;SELECT coalesce(jsonb_agg(to_jsonb(u)),'[]') INTO result FROM (SELECT id,student_id,display_name,role,gender,class_name,grade,disabled_at FROM public.profiles ORDER BY student_id LIMIT 500)u;
 WHEN 'admin.previewVillageRemoval' THEN IF api_private.current_role()<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;result:=public.get_village_removal_preview((p->>'villageId')::uuid);
 WHEN 'admin.groupDashboard' THEN IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM public.get_group_plan_admin_dashboard((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid)x;
 WHEN 'admin.groupContext' THEN IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;result:=public.get_group_plan_admin_context((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,(SELECT group_id FROM public.planning_spaces WHERE id=p->>'spaceId'),p->>'spaceId');
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;
 RETURN result;
END$$;
CREATE FUNCTION api_private.catalog_write(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,extensions,pg_temp AS $$DECLARE result jsonb; receipt api_private.operation_receipts; g public.course_groups; profile public.profiles; member public.group_memberships; rid uuid:=(p->>'requestId')::uuid; BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||rid::text,0));
 SELECT * INTO receipt FROM api_private.operation_receipts WHERE actor_id=auth.uid() AND request_id=rid;
 IF FOUND THEN IF receipt.action<>a OR receipt.input<>p THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;RETURN receipt.result;END IF;
 SELECT * INTO profile FROM public.profiles WHERE id=auth.uid();
 IF a LIKE 'admin.%' AND NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF a LIKE 'admin.%' AND a NOT IN ('admin.ensureGroupSpace') AND profile.role<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 CASE a
 WHEN 'catalog.createGroup' THEN
 IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 INSERT INTO public.course_groups(id,course_id,name,join_code,space_id,created_by)
 VALUES(gen_random_uuid()::text,p->>'courseId',p->>'name',upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),NULL,profile.display_name) RETURNING * INTO g;
 UPDATE public.course_groups SET space_id='group-space-'||id WHERE id=g.id RETURNING * INTO g;result:=to_jsonb(g);
 WHEN 'catalog.joinGroup' THEN
 SELECT * INTO g FROM public.course_groups WHERE course_id=p->>'courseId' AND join_code=upper(p->>'code') FOR UPDATE;
 IF NOT FOUND OR g.locked THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||g.course_id,0));
 SELECT * INTO member FROM public.group_memberships WHERE course_id=g.course_id AND student_key=api_private.student_key();
 IF FOUND THEN IF member.group_id<>g.id THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF; ELSE
 INSERT INTO public.group_memberships(course_id,group_id,student_key,student_name,student_id) VALUES(g.course_id,g.id,api_private.student_key(),profile.display_name,profile.student_id) RETURNING * INTO member;END IF;result:=to_jsonb(member);
 WHEN 'catalog.lockGroup' THEN
 IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 UPDATE public.course_groups SET locked=(p->>'locked')::boolean,updated_at=now() WHERE id=p->>'groupId' RETURNING to_jsonb(course_groups) INTO result;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 WHEN 'catalog.setProgress' THEN
 IF NOT EXISTS(SELECT 1 FROM public.courses WHERE id=p->>'courseId') THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 INSERT INTO public.task_progress(course_id,student_key,group_id,task_id,completed,completed_at) VALUES(p->>'courseId',api_private.student_key(),(SELECT group_id FROM public.group_memberships WHERE course_id=p->>'courseId' AND student_key=api_private.student_key()),p->>'taskId',(p->>'complete')::boolean,CASE WHEN (p->>'complete')::boolean THEN now() END)
 ON CONFLICT(course_id,student_key,task_id) DO UPDATE SET completed=excluded.completed,completed_at=excluded.completed_at,updated_at=now() RETURNING to_jsonb(task_progress) INTO result;
 WHEN 'catalog.recordActivity' THEN PERFORM api_private.assert_context(p);
 INSERT INTO public.activity_events(event_id,client_event_id,student_key,student_name,course_id,group_id,task_id,space_id,teaching_project_id,village_id,action,target_type,target_id,view_mode,metadata)
 VALUES(rid::text,rid::text,api_private.student_key(),profile.display_name,p->>'courseId',(SELECT group_id FROM public.group_memberships WHERE course_id=p->>'courseId' AND student_key=api_private.student_key()),p->>'taskId',p->>'spaceId',(p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'action',p->>'targetType',p->>'targetId',p->>'viewMode',coalesce(p->'metadata','{}')) RETURNING to_jsonb(activity_events) INTO result;
 WHEN 'catalog.ensureSpace' THEN result:=to_jsonb(public.ensure_context_space((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceType',p->>'title',NULL));
 WHEN 'admin.disableUser' THEN result:=api_private.disable_profile((p->>'userId')::uuid);
 WHEN 'admin.createVillage' THEN result:=to_jsonb(public.create_village_draft(p->>'name',coalesce((p->>'isPractice')::boolean,false),p->'boundary',coalesce(p->>'defaultCrs','EPSG:4326')));
 WHEN 'admin.createTeachingProject' THEN result:=to_jsonb(public.create_teaching_project(p->>'name',p->>'courseId',(p->>'practiceVillageId')::uuid));
 WHEN 'admin.archiveTeachingProject' THEN result:=to_jsonb(public.archive_teaching_project((p->>'teachingProjectId')::uuid));
 WHEN 'admin.archiveVillage' THEN result:=to_jsonb(public.archive_village((p->>'villageId')::uuid));
 WHEN 'admin.restoreVillage' THEN result:=to_jsonb(public.restore_village((p->>'villageId')::uuid));
 WHEN 'admin.deleteVillage' THEN result:=to_jsonb(public.delete_unused_village((p->>'villageId')::uuid));
 WHEN 'admin.saveDataset' THEN result:=to_jsonb(public.save_village_dataset_draft((p->>'villageId')::uuid,p->>'sourceKind',p->'imageryConfig',p->'layerManifest',coalesce(p->'validationSummary','{}'),coalesce(p->>'status','draft'),(p->>'datasetId')::uuid,p->>'versionLabel'));
 WHEN 'admin.publishDataset' THEN result:=to_jsonb(public.publish_village_dataset((p->>'datasetId')::uuid));
 WHEN 'admin.bindFormalVillage' THEN result:=to_jsonb(public.bind_formal_village((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid));
 WHEN 'admin.saveRealityModel' THEN result:=to_jsonb(public.save_village_reality_model_draft((p->>'villageId')::uuid,(p->>'ionAssetId')::bigint,p->>'title',coalesce((p->>'heightOffset')::double precision,0),coalesce((p->>'terrainEnabled')::boolean,true),coalesce(p->>'status','draft'),(p->>'modelId')::uuid));
 WHEN 'admin.publishRealityModel' THEN result:=to_jsonb(public.publish_village_reality_model((p->>'modelId')::uuid));
 WHEN 'admin.ensureGroupSpace' THEN result:=to_jsonb(public.ensure_group_plan_space((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'groupId',(p->>'snapshotId')::uuid));
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;
 INSERT INTO api_private.operation_receipts VALUES(auth.uid(),rid,a,p,coalesce(result,'null'),now());RETURN result;
END$$;
CREATE FUNCTION api_private.catalog_bootstrap() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 RETURN jsonb_build_object('profile',api_private.profile_self(),'courses',api_private.catalog_read('catalog.listCourses','{}'),
 'memberships',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT * FROM public.group_memberships WHERE student_key=api_private.student_key() LIMIT 200)m),'[]'),
 'spaces',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT * FROM public.planning_spaces s WHERE api_private.staff() OR s.owner_id=auth.uid() OR s.space_type IN ('practice_shared','formal_shared') OR EXISTS(SELECT 1 FROM public.group_memberships m WHERE m.group_id=s.group_id AND m.student_key=api_private.student_key()) LIMIT 200)s),'[]'));
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_private FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION api_private.student_key(),api_private.staff(),api_private.assert_context(jsonb),api_private.catalog_read(text,jsonb),api_private.catalog_write(text,jsonb),api_private.catalog_bootstrap() FROM authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.catalog_read(text,jsonb),api_private.catalog_write(text,jsonb),api_private.catalog_bootstrap() TO authenticated;
