-- Private ordinary bytes and authoritative registrations. Never apply upstream.
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED';END IF;END$$;
-- The restored context predicate covers shared/group/legacy planning spaces;
-- modern course-personal spaces have their own UUID table and owner boundary.
CREATE OR REPLACE FUNCTION api_private.context_accessible(pid uuid,vid uuid,sid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$SELECT api_private.profile_status()='active' AND (
 public.context_space_accessible(pid,vid,sid) OR EXISTS(SELECT 1 FROM public.course_personal_spaces s JOIN public.teaching_projects t ON t.id=s.teaching_project_id
 WHERE s.id::text=sid AND s.owner_id=auth.uid() AND s.teaching_project_id=pid AND s.course_id=t.course_id AND s.village_id::text=vid::text AND t.stage<>'archived'))$$;
CREATE OR REPLACE FUNCTION api_private.context_mutable(pid uuid,vid uuid,sid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$SELECT api_private.profile_status()='active' AND (
 public.context_space_mutable(pid,vid,sid) OR EXISTS(SELECT 1 FROM public.course_personal_spaces s JOIN public.teaching_projects t ON t.id=s.teaching_project_id
 WHERE s.id::text=sid AND s.owner_id=auth.uid() AND s.teaching_project_id=pid AND s.course_id=t.course_id AND s.village_id::text=vid::text AND t.stage<>'archived'))$$;
ALTER TABLE public.group_model_assets ADD COLUMN local_metadata jsonb NOT NULL DEFAULT '{}',ADD COLUMN archived_at timestamptz;
CREATE TABLE api_private.file_sessions(
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES profiles(id),request_id uuid NOT NULL,digest text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('photo','group-model','dataset')),context jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','ready','committed','aborted')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',created_at timestamptz NOT NULL DEFAULT now(),
 commit_digest text,result jsonb,UNIQUE(actor_id,request_id)
);
CREATE TABLE api_private.business_files(
 id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES api_private.file_sessions(id),role text NOT NULL,
 size bigint NOT NULL CHECK(size>0 AND size<=52428800),mime text NOT NULL,extension text NOT NULL,
 logical_path text UNIQUE NOT NULL,sha256 text CHECK(sha256~'^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','uploading','ready','failed')),archived_at timestamptz,
 UNIQUE(session_id,role)
);
CREATE FUNCTION api_private.file_guard(purpose text,c jsonb,writing boolean DEFAULT false) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE personal boolean;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 IF purpose='dataset' THEN
  IF NOT api_private.staff() OR NOT EXISTS(SELECT 1 FROM public.villages WHERE id=(c->>'villageId')::uuid AND status<>'archived') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;RETURN;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.course_personal_spaces s JOIN public.teaching_projects t ON t.id=s.teaching_project_id
  WHERE s.id::text=c->>'spaceId' AND s.owner_id=auth.uid() AND s.teaching_project_id=(c->>'teachingProjectId')::uuid
   AND s.course_id=t.course_id AND s.village_id::text=c->>'villageId' AND t.stage<>'archived') INTO personal;
 IF NOT personal THEN
  PERFORM api_private.assert_context(c);
  IF writing AND NOT api_private.context_mutable((c->>'teachingProjectId')::uuid,(c->>'villageId')::uuid,c->>'spaceId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 END IF;
 IF writing AND purpose='group-model' AND EXISTS(SELECT 1 FROM public.planning_spaces WHERE id=c->>'spaceId' AND space_type IN('practice_shared','formal_shared')) AND api_private.current_role()<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
END$$;
CREATE FUNCTION api_private.file_session(sid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,auth,pg_temp AS $$DECLARE s api_private.file_sessions;BEGIN
 SELECT * INTO s FROM api_private.file_sessions WHERE id=sid AND actor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM api_private.file_guard(s.purpose,s.context,s.state<>'committed');
 IF s.state='aborted' THEN RAISE EXCEPTION 'UPLOAD_EXPIRED';END IF;
 RETURN to_jsonb(s)||jsonb_build_object('files',(SELECT jsonb_agg(to_jsonb(f) ORDER BY role) FROM api_private.business_files f WHERE session_id=sid));
END$$;
CREATE FUNCTION api_private.file_existing(rid uuid,d text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,auth,pg_temp AS $$DECLARE s api_private.file_sessions;BEGIN
 SELECT * INTO s FROM api_private.file_sessions WHERE request_id=rid AND actor_id=auth.uid();IF NOT FOUND THEN RETURN NULL;END IF;
 IF s.digest<>d THEN RAISE EXCEPTION 'UPLOAD_CONFLICT';END IF;RETURN api_private.file_session(s.id);
END$$;
CREATE FUNCTION api_private.file_budget() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,api_private,auth,pg_temp AS $$DECLARE old jsonb:='{}';result jsonb;BEGIN
 IF to_regprocedure('scene_files.pending_budget()') IS NOT NULL THEN SELECT scene_files.pending_budget() INTO old;END IF;
 SELECT jsonb_build_object('global',count(*)+coalesce((old->>'global')::bigint,0),'own',count(*) FILTER(WHERE s.actor_id=auth.uid())+coalesce((old->>'own')::bigint,0),'bytes',coalesce(sum((SELECT sum(size) FROM api_private.business_files f WHERE f.session_id=s.id)),0)+coalesce((old->>'bytes')::bigint,0)) INTO result FROM api_private.file_sessions s WHERE state IN('pending','ready') AND expires_at>now();RETURN result;
END$$;
CREATE FUNCTION api_private.file_begin(sid uuid,d text,spec jsonb,files jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,auth,pg_temp AS $$DECLARE previous jsonb;budget jsonb;f jsonb;prefix text;BEGIN
 PERFORM pg_advisory_xact_lock(728190,8);
 previous:=api_private.file_existing((spec->>'requestId')::uuid,d);IF previous IS NOT NULL THEN RETURN previous;END IF;
 PERFORM api_private.file_guard(spec->>'purpose',spec->'context',true);budget:=api_private.file_budget();
 IF (budget->>'global')::integer>=32 OR (budget->>'own')::integer>=4 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED';END IF;
 INSERT INTO api_private.file_sessions(id,actor_id,request_id,digest,purpose,context) VALUES(sid,auth.uid(),(spec->>'requestId')::uuid,d,spec->>'purpose',spec->'context');
 prefix:='ordinary/'||sid::text||'/';
 FOR f IN SELECT value FROM jsonb_array_elements(files) LOOP
  INSERT INTO api_private.business_files(id,session_id,role,size,mime,extension,logical_path) VALUES((f->>'id')::uuid,sid,f->>'role',(f->>'size')::bigint,f->>'mime',f->>'extension',prefix||(f->>'role')||CASE WHEN spec->>'purpose'='dataset' THEN '' ELSE '.'||(f->>'extension') END);
 END LOOP;RETURN api_private.file_session(sid);
END$$;
CREATE FUNCTION api_private.file_claim(sid uuid,r text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,pg_temp AS $$DECLARE s jsonb;f api_private.business_files;BEGIN
 s:=api_private.file_session(sid);SELECT * INTO f FROM api_private.business_files WHERE session_id=sid AND role=r FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF f.state='ready' THEN RETURN to_jsonb(f);END IF;
 IF s->>'state'='committed' OR (s->>'expires_at')::timestamptz<=now() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED';END IF;
 IF f.state<>'pending' THEN RAISE EXCEPTION 'UPLOAD_CONFLICT';END IF;
 UPDATE api_private.business_files SET state='uploading' WHERE id=f.id;RETURN to_jsonb(f);
END$$;
CREATE FUNCTION api_private.file_finish(sid uuid,fid uuid,digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,pg_temp AS $$DECLARE s jsonb;BEGIN
 s:=api_private.file_session(sid);IF s->>'state'='committed' OR (s->>'expires_at')::timestamptz<=now() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED';END IF;
 UPDATE api_private.business_files SET state='ready',sha256=digest WHERE id=fid AND session_id=sid AND state='uploading';IF NOT FOUND THEN RAISE EXCEPTION 'UPLOAD_CONFLICT';END IF;
 IF NOT EXISTS(SELECT 1 FROM api_private.business_files WHERE session_id=sid AND state<>'ready') THEN UPDATE api_private.file_sessions SET state='ready' WHERE id=sid;END IF;RETURN api_private.file_session(sid);
END$$;
CREATE FUNCTION api_private.file_fail(sid uuid,fid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,auth,pg_temp AS $$BEGIN
 UPDATE api_private.business_files f SET state='failed' FROM api_private.file_sessions s WHERE f.id=fid AND f.session_id=sid AND s.id=sid AND s.actor_id=auth.uid() AND s.state<>'committed' AND f.state='uploading';
END$$;
CREATE FUNCTION api_private.file_commit(sid uuid,d text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
DECLARE s jsonb;f api_private.business_files;c jsonb;result jsonb;space public.planning_spaces;personal public.course_personal_spaces;metadata jsonb;scope text;asset uuid;BEGIN
 s:=api_private.file_session(sid);IF s->>'state'='committed' THEN IF s->>'commit_digest'<>d THEN RAISE EXCEPTION 'UPLOAD_CONFLICT';END IF;RETURN s->'result';END IF;
 IF s->>'state'<>'ready' OR (s->>'expires_at')::timestamptz<=now() THEN RAISE EXCEPTION 'FILES_NOT_READY';END IF;c:=s->'context';
 IF EXISTS(SELECT 1 FROM api_private.business_files WHERE session_id=sid AND state<>'ready') THEN RAISE EXCEPTION 'FILES_NOT_READY';END IF;
 IF s->>'purpose'='photo' THEN
  IF EXISTS(SELECT 1 FROM public.planning_spaces WHERE id=c->>'spaceId') THEN PERFORM api_private.survey_gate(c||p,p->>'surveyLayerKey');END IF;
  SELECT * INTO f FROM api_private.business_files WHERE session_id=sid AND role='photo';
  INSERT INTO public.object_photos(object_code,object_type,photo_url,photo_path,uploaded_by,survey_layer_key,teaching_project_id,village_id,space_id,file_id,local_actor_id)
   VALUES(p->>'objectCode',p->>'objectType','local-file:'||f.id,f.logical_path,public.current_profile_display_name(),p->>'surveyLayerKey',(c->>'teachingProjectId')::uuid,(c->>'villageId')::uuid,c->>'spaceId',f.id,auth.uid()) RETURNING to_jsonb(object_photos)||jsonb_build_object('fileId',f.id) INTO result;
 ELSIF s->>'purpose'='group-model' THEN
  SELECT * INTO f FROM api_private.business_files WHERE session_id=sid AND role='display';
  SELECT * INTO space FROM public.planning_spaces WHERE id=c->>'spaceId';
  SELECT * INTO personal FROM public.course_personal_spaces WHERE id::text=c->>'spaceId' AND owner_id=auth.uid();
  scope:=CASE WHEN personal.id IS NOT NULL THEN 'personal' WHEN space.space_type IN('practice_shared','formal_shared') THEN 'shared' WHEN space.group_id IS NOT NULL THEN 'group' ELSE NULL END;
  IF scope IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;asset:=gen_random_uuid();
  result:=to_jsonb(public.register_group_model(asset,p->>'name',f.logical_path,f.size,scope,space.group_id,coalesce(personal.course_id,space.course_id),c->>'spaceId'));
  metadata:=coalesce(p->'metadata','{}')||(SELECT coalesce(jsonb_object_agg(CASE role WHEN 'original' THEN 'originalStoragePath' WHEN 'low' THEN 'lowStoragePath' END,logical_path) FILTER(WHERE role IN('original','low')),'{}') FROM api_private.business_files WHERE session_id=sid);
  UPDATE public.group_model_assets SET local_metadata=metadata WHERE id=asset;result:=result||jsonb_build_object('normalization',metadata,'local_metadata',metadata);
 ELSIF s->>'purpose'='dataset' THEN
  PERFORM 1 FROM public.villages WHERE id=(c->>'villageId')::uuid AND name=p->>'villageName' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  result:=to_jsonb(public.save_village_dataset_draft((c->>'villageId')::uuid,'uploaded_bundle',p->'imageryConfig',p->'layerManifest',p->'validationSummary','ready',NULL,p->>'versionLabel'));
 ELSE RAISE EXCEPTION 'INVALID_INPUT';END IF;
 UPDATE api_private.file_sessions SET state='committed',commit_digest=d,result=file_commit.result WHERE id=sid;RETURN result;
END$$;
CREATE FUNCTION api_private.model_can_read(a public.group_model_assets) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$SELECT api_private.profile_status()='active' AND (
  (a.scope_kind='personal' AND a.owner_id=auth.uid()) OR
  (a.source_space_id IS NOT NULL AND api_private.context_accessible((SELECT teaching_project_id FROM public.planning_spaces WHERE id=a.source_space_id),(SELECT village_id FROM public.planning_spaces WHERE id=a.source_space_id),a.source_space_id) AND public.can_access_model_scope(a.scope_kind,a.group_id,a.owner_id))
 )$$;
CREATE FUNCTION api_private.models_execute(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$
DECLARE result jsonb;previous jsonb;asset public.group_model_assets;transform jsonb;space public.planning_spaces;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 IF a='models.delete' THEN
  SELECT * INTO asset FROM public.group_model_assets WHERE id=(p->>'assetId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT api_private.model_can_read(asset) OR (asset.scope_kind='shared' AND api_private.current_role()<>'admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSE PERFORM api_private.file_guard('group-model',p,a NOT IN('models.list','models.bindings'));END IF;
 IF a IN('models.place','models.restoreWhiteModel','models.delete') THEN previous:=api_private.begin_operation(a,p);IF previous IS NOT NULL THEN RETURN previous;END IF;END IF;
 CASE a
 WHEN 'models.list' THEN SELECT coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('normalization',x.local_metadata) ORDER BY x.created_at DESC),'[]') INTO result FROM public.group_model_assets x WHERE archived_at IS NULL AND api_private.model_can_read(x) AND (x.source_space_id=p->>'spaceId' OR x.scope_kind='group' AND x.group_id=(SELECT group_id FROM public.planning_spaces WHERE id=p->>'spaceId'));
 WHEN 'models.bindings' THEN SELECT coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('group_model_assets',to_jsonb(x)||jsonb_build_object('normalization',x.local_metadata))),'[]') INTO result FROM public.building_model_bindings b JOIN public.group_model_assets x ON x.id=b.asset_id WHERE b.space_id=p->>'spaceId' AND api_private.model_can_read(x);
 WHEN 'models.place' THEN
  SELECT * INTO asset FROM public.group_model_assets WHERE id=(p->>'assetId')::uuid FOR UPDATE;
  IF NOT FOUND OR asset.archived_at IS NOT NULL OR NOT api_private.model_can_read(asset) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_personal_spaces WHERE id::text=p->>'spaceId' AND owner_id=auth.uid()) THEN PERFORM api_private.survey_gate(p,'building');END IF;
  transform:=coalesce(p->'transform','{}')-'lowStoragePath';
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(transform) k WHERE k~*'(url|uri|path|storage|owner|fileId|assetId)') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF asset.local_metadata ? 'lowStoragePath' THEN transform:=transform||jsonb_build_object('lowStoragePath',asset.local_metadata->'lowStoragePath');END IF;
  result:=to_jsonb(public.place_group_model(asset.id,p->>'spaceId',p->>'objectCode',transform));
 WHEN 'models.restoreWhiteModel' THEN result:=public.restore_building_white_model(p->>'spaceId',p->>'objectCode');
 WHEN 'models.delete' THEN
  IF EXISTS(SELECT 1 FROM public.building_model_bindings WHERE asset_id=asset.id) THEN RAISE EXCEPTION 'FILE_IN_USE';END IF;
  UPDATE public.group_model_assets SET archived_at=coalesce(archived_at,now()) WHERE id=asset.id;
  INSERT INTO public.model_operation_events(actor_id,actor_name,action,scope_kind,course_id,group_id,owner_id,space_id,asset_id,asset_name,metadata) VALUES(auth.uid(),public.current_profile_display_name(),'delete',asset.scope_kind,asset.course_id,asset.group_id,asset.owner_id,asset.source_space_id,asset.id,asset.name,'{"archived":true,"retainedForHistory":true}');
  result:=jsonb_build_object('deleted',true,'retainedForHistory',true);
 ELSE RAISE EXCEPTION 'NOT_FOUND';END CASE;
 IF a IN('models.place','models.restoreWhiteModel','models.delete') THEN RETURN api_private.finish_operation(a,p,result);END IF;RETURN result;
END$$;
CREATE FUNCTION api_private.file_legacy(fid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,storage,api_private,auth,pg_temp AS $$DECLARE o storage.objects;allowed boolean:=false;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED';END IF;
 SELECT * INTO o FROM storage.objects WHERE id=fid;IF NOT FOUND THEN RETURN NULL;END IF;
 CASE o.bucket_id
 WHEN 'house-photos' THEN SELECT EXISTS(SELECT 1 FROM public.object_photos x WHERE (x.photo_path=o.name OR x.photo_url='https://rzmbmwauomzwiyenafha.supabase.co/storage/v1/object/public/house-photos/'||o.name) AND api_private.context_accessible(x.teaching_project_id,x.village_id,x.space_id)) INTO allowed;
 WHEN 'group-models' THEN SELECT EXISTS(SELECT 1 FROM public.group_model_assets a WHERE api_private.model_can_read(a) AND (a.storage_path=o.name OR regexp_replace(a.storage_path,'\.glb$','.original.glb')=o.name OR regexp_replace(a.storage_path,'\.glb$','.low.glb')=o.name)) INTO allowed;
 WHEN 'village-datasets' THEN allowed:=public.can_read_village_dataset_object(o.name);
 WHEN 'scene-assets' THEN SELECT EXISTS(SELECT 1 FROM public.scene_edit_assets a WHERE a.storage_path=o.name AND public.can_read_scene_edit_asset(a.scope_kind,a.course_id,a.group_id,a.owner_id)) INTO allowed;
 WHEN 'scene-version-previews' THEN SELECT EXISTS(SELECT 1 FROM public.scene_edit_versions v WHERE v.preview_path=o.name AND public.can_read_scene_edit_project(v.project_id)) INTO allowed;
 ELSE allowed:=false;END CASE;
 IF NOT allowed THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('legacy',true,'id',o.id,'bucket',o.bucket_id,'name',o.name,'snapshot_updated_at',to_char(o.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'declared_size',o.metadata->'size','snapshot_etag',o.metadata->>'eTag','snapshot_version',to_jsonb(o)->>'version');
END$$;
CREATE FUNCTION api_private.file_authorize(fid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE f api_private.business_files;s api_private.file_sessions;BEGIN
 SELECT * INTO f FROM api_private.business_files WHERE id=fid;IF NOT FOUND THEN RETURN api_private.file_legacy(fid);END IF;
 SELECT * INTO s FROM api_private.file_sessions WHERE id=f.session_id;
 IF s.state<>'committed' OR f.state<>'ready' OR f.archived_at IS NOT NULL THEN RETURN NULL;END IF;
 IF s.purpose='dataset' THEN
  IF NOT api_private.staff() AND NOT EXISTS(SELECT 1 FROM public.village_datasets d WHERE d.id=(s.result->>'id')::uuid AND d.status='published') THEN RETURN NULL;END IF;
 ELSE PERFORM api_private.file_guard(s.purpose,s.context,false);END IF;
 RETURN to_jsonb(f);
END$$;
CREATE FUNCTION api_private.file_resolve_path(bucket text,path text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,storage,pg_temp AS $$DECLARE fid uuid;f jsonb;BEGIN
 SELECT b.id INTO fid FROM api_private.business_files b JOIN api_private.file_sessions s ON s.id=b.session_id WHERE b.logical_path=path AND s.purpose=CASE bucket WHEN 'group-models' THEN 'group-model' WHEN 'house-photos' THEN 'photo' WHEN 'village-datasets' THEN 'dataset' END;
 IF fid IS NULL THEN SELECT id INTO fid FROM storage.objects WHERE bucket_id=bucket AND name=path;END IF;
 f:=api_private.file_authorize(fid);IF f IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;RETURN jsonb_build_object('fileId',fid);
END$$;
CREATE FUNCTION api_private.file_archive(fid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,auth,pg_temp AS $$DECLARE s api_private.file_sessions;BEGIN
 SELECT s0.* INTO s FROM api_private.file_sessions s0 JOIN api_private.business_files f ON f.session_id=s0.id WHERE f.id=fid AND s0.actor_id=auth.uid() FOR UPDATE OF s0;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF s.state='committed' THEN RAISE EXCEPTION 'FILE_IN_USE';END IF;
 UPDATE api_private.file_sessions SET state='aborted' WHERE id=s.id;RETURN jsonb_build_object('archived',true);
END$$;
CREATE FUNCTION api_private.file_cleanup(dry boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,api_private,pg_temp AS $$SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]') FROM (SELECT f.id,f.size FROM api_private.business_files f JOIN api_private.file_sessions s ON s.id=f.session_id WHERE s.state<>'committed' AND (s.state='aborted' OR s.expires_at<now()) ORDER BY s.created_at LIMIT 100)f$$;
CREATE FUNCTION api_private.file_cleanup_done(fid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,api_private,pg_temp AS $$BEGIN DELETE FROM api_private.business_files f USING api_private.file_sessions s WHERE f.id=fid AND s.id=f.session_id AND s.state<>'committed' AND (s.state='aborted' OR s.expires_at<now());END$$;
-- Existing photos retain their Storage object identity instead of exposing URLs.
UPDATE public.object_photos p SET file_id=o.id FROM storage.objects o WHERE p.file_id IS NULL AND o.bucket_id='house-photos' AND (p.photo_path=o.name OR p.photo_url='https://rzmbmwauomzwiyenafha.supabase.co/storage/v1/object/public/house-photos/'||o.name);
UPDATE public.object_photos p SET local_actor_id=names.id FROM (SELECT min(id::text)::uuid id,display_name FROM public.profiles GROUP BY display_name HAVING count(*)=1)names WHERE p.local_actor_id IS NULL AND p.uploaded_by=names.display_name;
REVOKE ALL ON ALL TABLES IN SCHEMA api_private FROM PUBLIC,anon,authenticated,village_unified_login;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA api_private FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION api_private.file_session(uuid),api_private.file_existing(uuid,text),api_private.file_budget(),api_private.file_begin(uuid,text,jsonb,jsonb),api_private.file_claim(uuid,text),api_private.file_finish(uuid,uuid,text),api_private.file_fail(uuid,uuid),api_private.file_commit(uuid,text,jsonb),api_private.file_authorize(uuid),api_private.file_resolve_path(text,text),api_private.file_archive(uuid),api_private.models_execute(text,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION api_private.file_cleanup(boolean),api_private.file_cleanup_done(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION api_private.file_cleanup(boolean),api_private.file_cleanup_done(uuid) TO village_unified_login;
