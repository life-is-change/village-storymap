-- Candidate-only planning protocol, using audited restored transactions.
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED';END IF;END$$;
CREATE FUNCTION api_private.planning_changes(p jsonb,personal boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,extensions,pg_temp AS $$
DECLARE item jsonb;result jsonb:='[]';previous public.planning_features;baseline public.feature_snapshot_items;space public.planning_spaces;geometry extensions.geometry;BEGIN
 IF jsonb_typeof(p->'changes')<>'array' OR jsonb_array_length(p->'changes') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF NOT personal THEN SELECT * INTO space FROM public.planning_spaces WHERE id=p->>'spaceId';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p->'changes') LOOP
  IF item->>'layerKey' NOT IN ('building','road','water','cropland','openSpace') OR (personal AND item->>'layerKey' NOT IN ('building','road','water')) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF item->>'action'<>'delete' THEN
   BEGIN geometry:=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON((item->'afterGeom')::text),4326);
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_INPUT';END;
   IF geometry IS NULL OR extensions.ST_IsEmpty(geometry) OR NOT extensions.ST_IsValid(geometry)
    OR extensions.ST_XMin(geometry::extensions.box3d)< -180 OR extensions.ST_XMax(geometry::extensions.box3d)>180
    OR extensions.ST_YMin(geometry::extensions.box3d)< -90 OR extensions.ST_YMax(geometry::extensions.box3d)>90
    OR (item->>'layerKey'='road' AND extensions.GeometryType(geometry) NOT IN ('LINESTRING','MULTILINESTRING'))
    OR (item->>'layerKey'<>'road' AND extensions.GeometryType(geometry) NOT IN ('POLYGON','MULTIPOLYGON')) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  END IF;
  IF NOT personal THEN
   -- Caller-supplied before states are not evidence; resolve the actual version.
   SELECT * INTO previous FROM public.planning_features WHERE space_id=space.id AND layer_key=item->>'layerKey' AND object_code=item->>'objectCode' FOR UPDATE;
   IF FOUND THEN item:=item||jsonb_build_object('beforeGeom',previous.geom,'beforeProps',previous.props);
   ELSIF space.space_type='group_plan' THEN
    SELECT * INTO baseline FROM public.feature_snapshot_items WHERE snapshot_id=space.base_snapshot_id AND layer_key=item->>'layerKey' AND object_code=coalesce(item->>'baseObjectCode',item->>'objectCode');
    item:=item||jsonb_build_object('beforeGeom',baseline.geom,'beforeProps',coalesce(baseline.props,'{}'));
   ELSE item:=item||jsonb_build_object('beforeGeom',NULL,'beforeProps','{}'::jsonb);END IF;
  END IF;
  result:=result||jsonb_build_array(item);
 END LOOP;RETURN result;
END$$;
CREATE FUNCTION api_private.planning_read(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE result jsonb;sid uuid;target jsonb;kind text;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 IF a LIKE 'personal.%' THEN
  IF p ? 'spaceId' THEN sid:=(p->>'spaceId')::uuid;ELSE SELECT space_id INTO sid FROM public.personal_layer_versions WHERE id=(p->>'versionId')::uuid;END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_personal_spaces WHERE id=sid AND (owner_id=auth.uid() OR api_private.staff())) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSIF a='planning.snapshotItems' THEN
  SELECT jsonb_build_object('teachingProjectId',teaching_project_id,'villageId',village_id,'spaceId',space_id) INTO target FROM public.feature_snapshots WHERE id=(p->>'snapshotId')::uuid;IF target IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;PERFORM api_private.assert_context(target);
 ELSE PERFORM api_private.assert_context(p);END IF;
 CASE a
 WHEN 'planning.listFeatures' THEN
  SELECT space_type INTO kind FROM public.planning_spaces WHERE id=p->>'spaceId';
  IF kind='group_plan' THEN SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM public.resolve_group_plan_features((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'layerKey')x;
  ELSE SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.object_code),'[]') INTO result FROM public.planning_features f WHERE f.teaching_project_id=(p->>'teachingProjectId')::uuid AND f.village_id=(p->>'villageId')::uuid AND f.space_id=p->>'spaceId' AND f.layer_key=p->>'layerKey' AND (coalesce((p->>'includeDeleted')::boolean,false) OR NOT f.is_deleted);END IF;
 WHEN 'planning.versions' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO result FROM (SELECT * FROM public.feature_change_batches WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' ORDER BY created_at DESC LIMIT least(coalesce((p->>'limit')::integer,100),200))v;
 WHEN 'planning.snapshots' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO result FROM (SELECT * FROM public.feature_snapshots WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' ORDER BY created_at DESC LIMIT 200)v;
 WHEN 'planning.snapshotItems' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO result FROM public.feature_snapshot_items v WHERE snapshot_id=(p->>'snapshotId')::uuid AND NOT is_deleted;
 WHEN 'planning.baselineState' THEN result:=public.get_group_plan_baseline_state((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId');
 WHEN 'planning.previewBaseline' THEN result:=public.preview_group_baseline_update((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',(p->>'targetSnapshotId')::uuid);
 WHEN 'planning.conflicts' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO result FROM (SELECT * FROM public.group_baseline_conflicts WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND (coalesce((p->>'includeResolved')::boolean,false) OR resolution_status='unresolved') ORDER BY created_at DESC LIMIT 200)v;
 WHEN 'planning.restorePoints' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO result FROM (SELECT * FROM public.group_plan_restore_points WHERE teaching_project_id=(p->>'teachingProjectId')::uuid AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' ORDER BY created_at DESC LIMIT 200)v;
 WHEN 'personal.listVersions' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO result FROM (SELECT * FROM public.personal_layer_versions WHERE space_id=sid ORDER BY created_at DESC LIMIT 200)v;
 WHEN 'personal.listSelections' THEN SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO result FROM public.personal_layer_selections v WHERE space_id=sid;
 WHEN 'personal.listFeatures' THEN SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.object_code),'[]') INTO result FROM public.personal_layer_features v WHERE layer_version_id=(p->>'versionId')::uuid AND space_id=sid AND NOT is_deleted;
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;RETURN result;
END$$;
CREATE FUNCTION api_private.planning_write(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,extensions,pg_temp AS $$DECLARE result jsonb;prior jsonb;space public.planning_spaces;lease public.feature_edit_locks;sid uuid;version public.personal_layer_versions;changes jsonb;actor text;target jsonb;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 IF a NOT IN ('planning.acquireLock','planning.heartbeatLock','planning.releaseLock') THEN prior:=api_private.begin_operation(a,p);IF prior IS NOT NULL THEN RETURN prior->'result';END IF;END IF;
 SELECT display_name INTO actor FROM public.profiles WHERE id=auth.uid();
 IF a LIKE 'personal.%' AND a<>'personal.ensure' THEN
  IF p ? 'spaceId' THEN sid:=(p->>'spaceId')::uuid;
  ELSE SELECT * INTO version FROM public.personal_layer_versions WHERE id=(p->>'versionId')::uuid;sid:=version.space_id;END IF;
  PERFORM 1 FROM public.course_personal_spaces WHERE id=sid AND owner_id=auth.uid() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSIF a='planning.resolveConflict' THEN
  SELECT jsonb_build_object('teachingProjectId',teaching_project_id,'villageId',village_id,'spaceId',space_id) INTO target FROM public.group_baseline_conflicts WHERE id=(p->>'conflictId')::uuid FOR UPDATE;
  IF target IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;PERFORM api_private.assert_context(target);
 ELSIF a='planning.restorePoint' THEN
  IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  SELECT jsonb_build_object('teachingProjectId',teaching_project_id,'villageId',village_id,'spaceId',space_id) INTO target FROM public.group_plan_restore_points WHERE id=(p->>'restorePointId')::uuid FOR UPDATE;
  IF target IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;PERFORM api_private.assert_context(target);
 ELSIF a LIKE 'planning.%' THEN
  PERFORM api_private.assert_context(p);
  IF NOT api_private.context_mutable((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  SELECT * INTO space FROM public.planning_spaces WHERE id=p->>'spaceId';
 END IF;
 CASE a
 WHEN 'planning.acquireLock' THEN result:=public.acquire_feature_edit_lock(space.id,space.teaching_project_id,space.village_id,p->>'layerKey',p->>'objectCode',actor,90);
 WHEN 'planning.heartbeatLock' THEN
  SELECT * INTO lease FROM public.feature_edit_locks WHERE teaching_project_id=space.teaching_project_id AND village_id=space.village_id AND space_id=space.id AND layer_key=p->>'layerKey' AND object_code=p->>'objectCode' FOR UPDATE;
  IF NOT FOUND OR lease.editor_user_id<>auth.uid() OR lease.lock_token<>(p->>'lockToken')::uuid OR lease.expires_at<=now() THEN RETURN jsonb_build_object('success',false);END IF;
  result:=public.heartbeat_feature_edit_lock(space.id,space.teaching_project_id,space.village_id,p->>'layerKey',p->>'objectCode',actor,(p->>'lockToken')::uuid,90);
 WHEN 'planning.releaseLock' THEN result:=public.release_feature_edit_lock(space.id,space.teaching_project_id,space.village_id,p->>'layerKey',p->>'objectCode',actor,(p->>'lockToken')::uuid);
 WHEN 'planning.saveBatch' THEN
  changes:=api_private.planning_changes(p);
  IF space.space_type='group_plan' THEN result:=public.save_group_plan_edit_batch(space.teaching_project_id,space.village_id,space.id,actor,coalesce(p->>'summary',''),changes);
  ELSE result:=to_jsonb(public.save_feature_edit_batch(space.id,space.teaching_project_id,space.village_id,actor,coalesce(p->>'summary',''),coalesce(p->>'note',''),changes));END IF;
 WHEN 'planning.freezeSnapshot' THEN
  IF NOT api_private.staff() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF space.space_type='formal_shared' THEN result:=public.freeze_shared_survey_snapshot(space.teaching_project_id,space.village_id,space.id,p->>'label',coalesce(p->>'description',''),true);
  ELSE result:=to_jsonb(public.freeze_feature_snapshot(space.id,space.teaching_project_id,space.village_id,p->>'label',coalesce(p->>'description',''),actor,coalesce(p->>'versionType','published'),NULL));END IF;
 WHEN 'planning.applyBaseline' THEN result:=public.apply_group_baseline_update(space.teaching_project_id,space.village_id,space.id,(p->>'targetSnapshotId')::uuid,(p->>'expectedBaseSnapshotId')::uuid);
 WHEN 'planning.resolveConflict' THEN
  IF p->>'resolution'='manual_merge' THEN
   IF NOT (p->'payload' ? 'geom') OR NOT (p->'payload' ? 'props') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
   PERFORM api_private.planning_changes(target||jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('action','update','layerKey',(SELECT layer_key FROM public.group_baseline_conflicts WHERE id=(p->>'conflictId')::uuid),'objectCode',(SELECT object_code FROM public.group_baseline_conflicts WHERE id=(p->>'conflictId')::uuid),'afterGeom',p->'payload'->'geom','afterProps',p->'payload'->'props'))));
  END IF;
  result:=public.resolve_group_baseline_conflict((p->>'conflictId')::uuid,p->>'resolution',coalesce(p->'payload','{}'));
 WHEN 'planning.restorePoint' THEN result:=public.restore_group_plan_restore_point((p->>'restorePointId')::uuid);
 WHEN 'personal.ensure' THEN result:=to_jsonb(public.ensure_course_personal_space(p->>'courseId',(p->>'teachingProjectId')::uuid,p->>'villageId',p->>'spaceType',p->>'title'));
 WHEN 'personal.saveBatch' THEN changes:=api_private.planning_changes(p,true);result:=to_jsonb(public.save_personal_feature_edit_batch(sid,changes));
 WHEN 'personal.deleteFeature' THEN
  IF version.layer_key='contours' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  result:=to_jsonb(public.save_personal_feature_edit_batch(sid,jsonb_build_array(jsonb_build_object('action','delete','layerKey',version.layer_key,'objectCode',p->>'objectCode','layerVersionId',version.id))));
 WHEN 'personal.setVersion' THEN result:=to_jsonb(public.set_personal_layer_version(sid,p->>'layerKey',(p->>'versionId')::uuid));
 WHEN 'personal.deleteVersion' THEN result:=to_jsonb(public.delete_personal_layer_version((p->>'versionId')::uuid));
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;
 IF a IN ('planning.acquireLock','planning.heartbeatLock','planning.releaseLock') THEN RETURN result;END IF;
 RETURN api_private.finish_operation(a,p,result);
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_private FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION api_private.planning_changes(jsonb,boolean) FROM authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.planning_read(text,jsonb),api_private.planning_write(text,jsonb) TO authenticated;
