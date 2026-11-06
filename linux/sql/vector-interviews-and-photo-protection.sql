BEGIN;
SET LOCAL lock_timeout=3000;
CREATE TABLE api_private.object_interviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 teaching_project_id uuid NOT NULL REFERENCES public.teaching_projects(id),
 village_id uuid NOT NULL REFERENCES public.villages(id),
 space_id text NOT NULL REFERENCES public.planning_spaces(id),
 layer_key text NOT NULL CHECK(layer_key IN ('building','road','water','cropland','openSpace')),
 object_code text NOT NULL CHECK(length(trim(object_code)) BETWEEN 1 AND 200),
 interviewed_at timestamptz NOT NULL,
 interviewee text NOT NULL CHECK(length(trim(interviewee)) BETWEEN 1 AND 100),
 content text NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 5000),
 author_id uuid NOT NULL REFERENCES public.profiles(id),
 author_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE INDEX object_interviews_target_idx ON api_private.object_interviews
 (teaching_project_id,village_id,space_id,layer_key,object_code,created_at DESC) WHERE deleted_at IS NULL;
REVOKE ALL ON api_private.object_interviews FROM PUBLIC,anon,authenticated;

CREATE FUNCTION api_private.vector_has_photos(pid uuid,vid uuid,layer text,code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.object_photos p
 WHERE p.teaching_project_id=pid AND p.village_id=vid AND p.object_code=code AND p.deleted_at IS NULL
  AND coalesce(p.survey_layer_key,regexp_replace(split_part(p.object_type,'__',1),'_3d$',''))=layer)
$$;
CREATE TABLE api_private.deleted_photo_vectors (
 teaching_project_id uuid NOT NULL, village_id uuid NOT NULL, space_id text NOT NULL,
 layer_key text NOT NULL, object_code text NOT NULL,
 PRIMARY KEY(teaching_project_id,village_id,space_id,layer_key,object_code)
);
REVOKE ALL ON api_private.deleted_photo_vectors FROM PUBLIC,anon,authenticated;

CREATE FUNCTION api_private.protect_photographed_vector() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,pg_temp AS $$
DECLARE previous jsonb; current_row jsonb; target jsonb; pid uuid; vid uuid; sid text; layer text; code text; base_code text; removing boolean;
BEGIN
 IF TG_OP='DELETE' THEN previous:=to_jsonb(old);current_row:=NULL;
 ELSIF TG_OP='INSERT' THEN current_row:=to_jsonb(new);previous:=NULL;
 ELSE previous:=to_jsonb(old);current_row:=to_jsonb(new);END IF;
 target:=coalesce(previous,current_row);
 sid:=target->>'space_id';layer:=target->>'layer_key';code:=target->>'object_code';base_code:=coalesce(target->>'base_object_code',code);
 pid:=(target->>'teaching_project_id')::uuid;vid:=(target->>'village_id')::uuid;
 IF pid IS NULL OR vid IS NULL THEN
  SELECT s.teaching_project_id,s.village_id INTO pid,vid FROM public.planning_spaces s WHERE s.id=sid;
 END IF;
 IF pid IS NULL OR vid IS NULL THEN
  SELECT s.teaching_project_id,s.village_id::uuid INTO pid,vid FROM public.course_personal_spaces s WHERE s.id::text=sid;
 END IF;
 IF pid IS NULL OR vid IS NULL OR layer IS NULL OR code IS NULL THEN
  IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','photo-vector',pid,vid,layer,code),0));
 removing:=TG_OP='DELETE' OR coalesce((current_row->>'is_deleted')::boolean,false)
  OR current_row->>'geometry_status'='deleted'
  OR previous IS NOT NULL AND (current_row->>'object_code' IS DISTINCT FROM code
   OR current_row->>'layer_key' IS DISTINCT FROM layer OR current_row->>'space_id' IS DISTINCT FROM sid);
 IF coalesce(removing,false) THEN
  IF api_private.vector_has_photos(pid,vid,layer,code) OR api_private.vector_has_photos(pid,vid,layer,base_code) THEN
   RAISE EXCEPTION 'FILE_IN_USE';
  END IF;
  INSERT INTO api_private.deleted_photo_vectors VALUES(pid,vid,sid,layer,code) ON CONFLICT DO NOTHING;
 ELSE
  DELETE FROM api_private.deleted_photo_vectors WHERE teaching_project_id=pid AND village_id=vid AND space_id=sid AND layer_key=layer AND object_code=code;
 END IF;
 IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;
END$$;
CREATE TRIGGER protect_photographed_vector BEFORE INSERT OR UPDATE OR DELETE ON public.planning_features
 FOR EACH ROW EXECUTE FUNCTION api_private.protect_photographed_vector();
CREATE TRIGGER protect_photographed_vector BEFORE INSERT OR UPDATE OR DELETE ON public.survey_feature_reviews
 FOR EACH ROW EXECUTE FUNCTION api_private.protect_photographed_vector();
CREATE TRIGGER protect_photographed_vector BEFORE INSERT OR UPDATE OR DELETE ON public.personal_layer_features
 FOR EACH ROW EXECUTE FUNCTION api_private.protect_photographed_vector();

CREATE FUNCTION api_private.protect_photo_vector_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,pg_temp AS $$
DECLARE layer text;
BEGIN
 IF new.deleted_at IS NOT NULL OR new.teaching_project_id IS NULL OR new.village_id IS NULL THEN RETURN new;END IF;
 layer:=coalesce(new.survey_layer_key,regexp_replace(split_part(new.object_type,'__',1),'_3d$',''));
 PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','photo-vector',new.teaching_project_id,new.village_id,layer,new.object_code),0));
 IF EXISTS(SELECT 1 FROM api_private.deleted_photo_vectors d WHERE d.teaching_project_id=new.teaching_project_id
  AND d.village_id=new.village_id AND d.space_id=new.space_id AND d.layer_key=layer AND d.object_code=new.object_code)
 OR EXISTS(SELECT 1 FROM public.planning_features f WHERE f.teaching_project_id=new.teaching_project_id
  AND f.village_id=new.village_id AND f.space_id=new.space_id AND f.layer_key=layer AND f.object_code=new.object_code AND f.is_deleted)
 OR EXISTS(SELECT 1 FROM public.survey_feature_reviews r WHERE r.teaching_project_id=new.teaching_project_id
  AND r.village_id=new.village_id AND r.space_id=new.space_id AND r.layer_key=layer AND r.object_code=new.object_code AND r.is_deleted)
 THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN new;
END$$;
CREATE TRIGGER protect_photo_vector_link BEFORE INSERT OR UPDATE ON public.object_photos
 FOR EACH ROW EXECUTE FUNCTION api_private.protect_photo_vector_link();

DO $patch$
DECLARE body text; injected text;
BEGIN
 body:=pg_get_functiondef('api_private.survey_read(text,jsonb)'::regprocedure);
 injected:=$read$ CASE a
 WHEN 'survey.listInterviews' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(i)-'author_id' ORDER BY i.interviewed_at DESC,i.created_at DESC),'[]') INTO result
  FROM (SELECT * FROM api_private.object_interviews WHERE teaching_project_id=(p->>'teachingProjectId')::uuid
   AND village_id=(p->>'villageId')::uuid AND space_id=p->>'spaceId' AND layer_key=p->>'layerKey'
   AND object_code=p->>'objectCode' AND deleted_at IS NULL ORDER BY interviewed_at DESC,created_at DESC LIMIT 200)i;
 WHEN 'survey.featurePhotoState' THEN
  result:=jsonb_build_object('hasPhotos',api_private.vector_has_photos((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'layerKey',p->>'objectCode'));
$read$;
 IF (length(body)-length(replace(body,' CASE a','')))/length(' CASE a')<>1 THEN RAISE EXCEPTION 'SURVEY_READ_CHANGED';END IF;
 EXECUTE replace(body,' CASE a',injected);
 body:=pg_get_functiondef('api_private.survey_write(text,jsonb)'::regprocedure);
 injected:=$write$ CASE a
 WHEN 'survey.addInterview' THEN
  PERFORM api_private.survey_gate(p||jsonb_build_object('surveyLayerKey',p->>'layerKey'));
  INSERT INTO api_private.object_interviews(teaching_project_id,village_id,space_id,layer_key,object_code,interviewed_at,interviewee,content,author_id,author_name)
   VALUES((p->>'teachingProjectId')::uuid,(p->>'villageId')::uuid,p->>'spaceId',p->>'layerKey',p->>'objectCode',
    (p->>'interviewedAt')::timestamptz,trim(p->>'interviewee'),trim(p->>'content'),auth.uid(),actor)
   RETURNING to_jsonb(object_interviews)-'author_id' INTO result;
$write$;
 IF (length(body)-length(replace(body,' CASE a','')))/length(' CASE a')<>1 THEN RAISE EXCEPTION 'SURVEY_WRITE_CHANGED';END IF;
 EXECUTE replace(body,' CASE a',injected);
END $patch$;
REVOKE ALL ON FUNCTION api_private.vector_has_photos(uuid,uuid,text,text),api_private.protect_photographed_vector(),api_private.protect_photo_vector_link() FROM PUBLIC,anon,authenticated;
COMMIT;
