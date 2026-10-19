-- Transactional invalidations only. Install in the isolated unified database.
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED';END IF;END$$;
CREATE TABLE api_private.event_log(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 kind text NOT NULL CHECK(kind IN('catalog','survey','planning','community','photos','models','scene','personal','tasks')),
 context jsonb,targets uuid[]
);
CREATE INDEX event_log_created_idx ON api_private.event_log(created_at);
-- Serialize cursor allocation until commit; a late commit cannot fall behind an
-- already delivered cursor. Rolled-back events and their business writes vanish together.
CREATE FUNCTION api_private.event_record(k text,c jsonb,t uuid[] DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,pg_temp AS $$BEGIN
 PERFORM pg_advisory_xact_lock(728190,7);
 DELETE FROM api_private.event_log WHERE created_at<clock_timestamp()-interval '24 hours';
 INSERT INTO api_private.event_log(kind,context,targets) VALUES(k,c,t);
END$$;
CREATE FUNCTION api_private.event_append(k text,c jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,pg_temp AS $$BEGIN
 PERFORM api_private.assert_context(c);PERFORM api_private.event_record(k,c);
END$$;
CREATE FUNCTION api_private.event_read(contexts jsonb,cursor bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,api_private,auth,pg_temp AS $$
DECLARE c jsonb;latest bigint;first_id bigint;result jsonb;refresh boolean;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 IF jsonb_typeof(contexts)<>'array' OR jsonb_array_length(contexts) NOT BETWEEN 1 AND 8 OR cursor<0 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(contexts) LOOP PERFORM api_private.assert_context(c);END LOOP;
 SELECT coalesce(max(id),0),min(id) FILTER(WHERE created_at>=now()-interval '24 hours') INTO latest,first_id FROM api_private.event_log;
 refresh:=cursor IS NULL OR cursor>latest OR (cursor<latest AND (first_id IS NULL OR cursor<first_id-1));
 IF refresh THEN RETURN jsonb_build_object('refresh',true,'cursor',latest::text,'events','[]'::jsonb);END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('cursor',id::text,'kind',kind,'context',context) ORDER BY id),'[]') INTO result FROM (
  SELECT id,kind,context FROM api_private.event_log e WHERE id>cursor AND created_at>=now()-interval '24 hours'
   AND (targets IS NULL OR auth.uid()=ANY(targets))
   AND (context IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(contexts) x WHERE x=e.context))
  ORDER BY id LIMIT 101
 ) q;
 -- More than a bounded batch is recovered by a fresh authorized read, never a
 -- partial replay followed by silently advancing past omitted events.
 IF jsonb_array_length(result)>100 THEN RETURN jsonb_build_object('refresh',true,'cursor',latest::text,'events','[]'::jsonb);END IF;
 RETURN jsonb_build_object('refresh',false,'cursor',latest::text,'events',result);
END$$;
CREATE FUNCTION api_private.event_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
DECLARE r jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;c jsonb;sid text;targets uuid[];pid uuid;vid uuid;BEGIN
 sid:=r->>'space_id';
 IF TG_TABLE_NAME='planning_spaces' THEN sid:=r->>'id';END IF;
 IF sid IS NOT NULL THEN SELECT teaching_project_id,village_id INTO pid,vid FROM public.planning_spaces WHERE id=sid;END IF;
 pid:=coalesce((r->>'teaching_project_id')::uuid,pid);vid:=coalesce((r->>'village_id')::uuid,vid);
 IF pid IS NOT NULL AND vid IS NOT NULL AND sid IS NOT NULL THEN
  c:=jsonb_build_object('teachingProjectId',pid,'villageId',vid,'spaceId',sid);
 ELSE
  -- Unscoped legacy rows never become a global broadcast. Only public catalog
  -- lifecycle changes are global; personal/administrative changes target UUIDs.
  IF TG_TABLE_NAME NOT IN('courses','villages','teaching_projects','village_datasets','village_reality_models') THEN
   SELECT array_agg(DISTINCT id) INTO targets FROM public.profiles WHERE id=auth.uid()
    OR (TG_TABLE_NAME='profiles' AND id=(r->>'id')::uuid)
    OR (r->>'owner_id'=id::text) OR (r->>'student_key'=student_id||'::'||display_name);
   IF targets IS NULL THEN RETURN NULL;END IF;
  END IF;
 END IF;
 PERFORM api_private.event_record(TG_ARGV[0],c,targets);RETURN NULL;
END$$;
DO $$DECLARE item text[];BEGIN
 FOREACH item SLICE 1 IN ARRAY ARRAY[
  ['planning_features','planning'],['planning_spaces','catalog'],['feature_edit_locks','survey'],['survey_feature_reviews','survey'],
  ['object_attribute_edits','survey'],['object_comments','survey'],['object_photos','photos'],['community_tasks','community'],
  ['group_baseline_updates','planning'],['group_baseline_conflicts','planning'],['planning_snapshots','planning'],
  ['personal_layer_versions','personal'],['personal_space_layer_selections','personal'],['personal_space_features','personal'],
  ['courses','catalog'],['course_groups','catalog'],['group_memberships','catalog'],['profiles','catalog'],
  ['villages','catalog'],['teaching_projects','catalog'],['village_datasets','catalog'],['village_reality_models','catalog'],
  ['scene_drafts','scene'],['scene_versions','scene'],['scene_assets','scene'],['group_models','models']
 ] LOOP
  IF to_regclass('public.'||item[1]) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER unified_invalidation AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION api_private.event_changed(%L)',item[1],item[2]);
  END IF;
 END LOOP;
END$$;
REVOKE ALL ON ALL TABLES IN SCHEMA api_private FROM PUBLIC,anon,authenticated,village_unified_login;
REVOKE ALL ON FUNCTION api_private.event_record(text,jsonb,uuid[]),api_private.event_changed(),api_private.event_append(text,jsonb),api_private.event_read(jsonb,bigint) FROM PUBLIC,anon,authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.event_read(jsonb,bigint),api_private.event_append(text,jsonb) TO authenticated;
