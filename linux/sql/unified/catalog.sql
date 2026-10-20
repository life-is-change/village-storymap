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
CREATE FUNCTION api_private.context_accessible(pid uuid,vid uuid,sid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
 SELECT api_private.profile_status()='active' AND public.context_space_accessible(pid,vid,sid)
$$;
CREATE FUNCTION api_private.assert_context(p jsonb) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,api_private,pg_temp AS $$BEGIN
 IF NOT api_private.context_accessible((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
END$$;
CREATE FUNCTION api_private.context_mutable(pid uuid,vid uuid,sid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
 SELECT api_private.profile_status()='active' AND public.context_space_mutable(pid,vid,sid)
$$;
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
 WHEN 'catalog.listSpaces' THEN SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') INTO result FROM (SELECT * FROM public.planning_spaces s WHERE s.teaching_project_id=(p->>'teachingProjectId')::uuid AND s.village_id=(p->>'villageId')::uuid AND api_private.context_accessible(s.teaching_project_id,s.village_id,s.id) ORDER BY s.id LIMIT 200)s;
 WHEN 'catalog.getSpace' THEN PERFORM api_private.assert_context(p);SELECT to_jsonb(s) INTO result FROM public.planning_spaces s WHERE s.id=p->>'spaceId';
 WHEN 'admin.listPhotos' THEN
 IF api_private.current_role()<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'object_code',x.object_code,'object_type',x.object_type,'fileId',x.file_id,'uploaded_by',x.uploaded_by,'created_at',x.created_at,'space_id',x.space_id,'village_id',x.village_id,'teaching_project_id',x.teaching_project_id)),'[]') INTO result FROM (SELECT * FROM public.object_photos WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500)x;
 WHEN 'admin.listMessages' THEN
 IF api_private.current_role()<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t)-'local_actor_id'),'[]') INTO result FROM (SELECT * FROM public.community_tasks WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000)t;
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
 'spaces',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT * FROM public.planning_spaces s WHERE api_private.context_accessible(s.teaching_project_id,s.village_id,s.id) LIMIT 200)s),'[]'));
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_private FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION api_private.student_key(),api_private.staff(),api_private.assert_context(jsonb),api_private.context_accessible(uuid,uuid,text),api_private.context_mutable(uuid,uuid,text),api_private.catalog_read(text,jsonb),api_private.catalog_write(text,jsonb),api_private.catalog_bootstrap() FROM authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.catalog_read(text,jsonb),api_private.catalog_write(text,jsonb),api_private.catalog_bootstrap() TO authenticated;

-- MC configuration stays local and must be explicitly mapped to the canonical village UUID.
CREATE TABLE IF NOT EXISTS public.mc_sync_config(
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,village_id text UNIQUE NOT NULL,crs text DEFAULT 'EPSG:4326',
 min_lon double precision,min_lat double precision,max_lon double precision,max_lat double precision,
 mc_origin_x integer,mc_origin_y integer,mc_origin_z integer,mc_width integer,mc_depth integer,rotation_deg double precision DEFAULT 0,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mc_building_state(
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,village_id text NOT NULL,space_id text NOT NULL,object_code text NOT NULL,object_name text,source text DEFAULT 'web',
 footprint_blocks jsonb,bbox jsonb,base_y integer,height_blocks integer,block_type text,geom jsonb,props jsonb,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(village_id,space_id,object_code)
);
REVOKE ALL ON public.mc_sync_config,public.mc_building_state FROM PUBLIC,anon,authenticated,village_unified_login;
CREATE FUNCTION api_private.mc_context(p jsonb,include_features boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE cfg jsonb;features jsonb:='[]';BEGIN
 PERFORM api_private.assert_context(p);
 IF include_features AND NOT api_private.context_mutable((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT jsonb_build_object('min_lon',min_lon,'max_lon',max_lon,'min_lat',min_lat,'max_lat',max_lat,'mc_origin_x',mc_origin_x,'mc_origin_y',mc_origin_y,'mc_origin_z',mc_origin_z,'mc_width',mc_width,'mc_depth',mc_depth,'rotation_deg',rotation_deg) INTO cfg FROM public.mc_sync_config WHERE village_id=p->>'villageId';
 IF cfg IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF include_features THEN features:=api_private.planning_read('planning.listFeatures',p||jsonb_build_object('layerKey','building'));END IF;
 RETURN jsonb_build_object('config',cfg,'features',features);
END$$;
CREATE FUNCTION api_private.mc_export(p jsonb,items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE prior jsonb;item jsonb;result jsonb;BEGIN
 PERFORM api_private.assert_context(p);
 IF NOT api_private.context_mutable((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 prior:=api_private.begin_operation('mc.exportBuildings',p);IF prior IS NOT NULL THEN RETURN prior->'result';END IF;
 IF jsonb_typeof(items)<>'array' OR jsonb_array_length(items)>1000 OR octet_length(items::text)>2097152 THEN RAISE EXCEPTION 'PAYLOAD_TOO_LARGE';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
 INSERT INTO public.mc_building_state(village_id,space_id,object_code,object_name,source,footprint_blocks,bbox,base_y,height_blocks,block_type,geom,props)
 VALUES(p->>'villageId',p->>'spaceId',item->>'object_code',item->>'object_name','web',item->'footprint_blocks',item->'bbox',(item->>'base_y')::integer,(item->>'height_blocks')::integer,'minecraft:white_concrete',item->'geom',item->'props')
 ON CONFLICT(village_id,space_id,object_code) DO UPDATE SET object_name=excluded.object_name,footprint_blocks=excluded.footprint_blocks,bbox=excluded.bbox,base_y=excluded.base_y,height_blocks=excluded.height_blocks,block_type=excluded.block_type,geom=excluded.geom,props=excluded.props,updated_at=now();
 END LOOP;
 result:=jsonb_build_object('count',jsonb_array_length(items));
 INSERT INTO api_private.operation_receipts VALUES(auth.uid(),(p->>'requestId')::uuid,'mc.exportBuildings',p,result,now());RETURN result;
END$$;
REVOKE ALL ON FUNCTION api_private.mc_context(jsonb,boolean),api_private.mc_export(jsonb,jsonb) FROM PUBLIC,anon,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.mc_context(jsonb,boolean),api_private.mc_export(jsonb,jsonb) TO authenticated;
