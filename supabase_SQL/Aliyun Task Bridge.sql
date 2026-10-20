-- SOURCE SUPABASE ONLY, reviewed manual installation. Candidate deployment must
-- never execute this file. No source profiles/courses/members/photos are copied
-- back from Aliyun. Run as a database administrator in one transaction.
BEGIN;
DO $$BEGIN
 IF to_regnamespace('api_private') IS NOT NULL OR to_regnamespace('aliyun_bridge') IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_BRIDGE_FRESH_INSTALL_REQUIRED';END IF;
 IF to_regclass('public.geoprocessing_runs') IS NULL OR to_regclass('public.facade_generation_runs') IS NULL OR to_regclass('public.cloud_facade_runs') IS NULL THEN RAISE EXCEPTION 'SOURCE_QUEUE_SCHEMA_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_aliyun_bridge') THEN RAISE EXCEPTION 'BRIDGE_ROLE_ALREADY_EXISTS';END IF;
END$$;
CREATE ROLE village_aliyun_bridge NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
DO $$BEGIN EXECUTE format('GRANT village_aliyun_bridge TO %I',current_user);END$$;
CREATE SCHEMA aliyun_bridge;
REVOKE ALL ON SCHEMA aliyun_bridge FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA aliyun_bridge TO village_aliyun_bridge;
CREATE TABLE aliyun_bridge.contexts(
 instance_id text NOT NULL CHECK(instance_id~'^aliyun-[a-zA-Z0-9_-]{1,92}$'),local_kind text NOT NULL CHECK(local_kind IN('profile','space','photo')),
 local_id text NOT NULL CHECK(length(local_id) BETWEEN 1 AND 200),version bigint NOT NULL CHECK(version>0),tombstone boolean NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(instance_id,local_kind,local_id)
);
CREATE TABLE aliyun_bridge.requests(
 instance_id text NOT NULL,owner_id uuid NOT NULL REFERENCES auth.users,request_id uuid NOT NULL,context_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('geo','facade','cloud-facade')),run_id uuid NOT NULL UNIQUE,digest text NOT NULL,request jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(instance_id,owner_id,request_id)
);
CREATE TABLE aliyun_bridge.run_origins(run_id uuid PRIMARY KEY,instance_id text NOT NULL,kind text NOT NULL,owner_id uuid NOT NULL,request_id uuid NOT NULL);
ALTER TABLE public.geoprocessing_runs ADD COLUMN origin_instance_id text NOT NULL DEFAULT 'supabase';
ALTER TABLE public.facade_generation_runs ADD COLUMN origin_instance_id text NOT NULL DEFAULT 'supabase',ADD COLUMN source_photo_bucket text NOT NULL DEFAULT 'house-photos',
 ADD COLUMN source_photo_sha256 text,ADD COLUMN source_photo_size bigint,ADD COLUMN source_photo_mime text;
ALTER TABLE public.cloud_facade_runs ADD COLUMN origin_instance_id text NOT NULL DEFAULT 'supabase',ADD COLUMN source_photo_bucket text NOT NULL DEFAULT 'house-photos',
 ADD COLUMN source_photo_path text,ADD COLUMN source_photo_sha256 text,ADD COLUMN source_photo_size bigint,ADD COLUMN source_photo_mime text;
ALTER TABLE public.cloud_facade_runs ALTER COLUMN photo_id DROP NOT NULL;
CREATE FUNCTION aliyun_bridge.assert_source_run(rid uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,aliyun_bridge,pg_temp AS $$BEGIN
 IF current_setting('role',true)='village_aliyun_bridge' THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM aliyun_bridge.run_origins WHERE run_id=rid) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
END$$;
CREATE FUNCTION aliyun_bridge.guard_source_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,aliyun_bridge,auth,pg_temp AS $$DECLARE r jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;BEGIN
 IF current_setting('role',true)='village_aliyun_bridge' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;END IF;
 IF current_setting('role',true) IN('authenticated','anon') OR auth.role() IN('authenticated','anon') THEN
  IF TG_OP<>'INSERT' THEN PERFORM aliyun_bridge.assert_source_run((to_jsonb(OLD)->>'id')::uuid);END IF;
  IF coalesce(r->>'origin_instance_id','supabase')<>'supabase' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 END IF;RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END$$;
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['geoprocessing_runs','facade_generation_runs','cloud_facade_runs'] LOOP
  EXECUTE format('CREATE POLICY source_origin_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated,anon USING(origin_instance_id=''supabase'') WITH CHECK(origin_instance_id=''supabase'')',t);
  -- Applies inside the existing SECURITY DEFINER user mutation RPCs too.
  EXECUTE format('CREATE TRIGGER source_origin_boundary BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION aliyun_bridge.guard_source_mutation()',t);
 END LOOP;
END$$;
CREATE POLICY source_origin_boundary ON public.geoprocessing_artifacts AS RESTRICTIVE FOR ALL TO authenticated,anon
 USING(EXISTS(SELECT 1 FROM public.geoprocessing_runs r WHERE r.id=run_id AND r.origin_instance_id='supabase'));
CREATE POLICY source_origin_boundary ON public.facade_generation_artifacts AS RESTRICTIVE FOR ALL TO authenticated,anon
 USING(EXISTS(SELECT 1 FROM public.facade_generation_runs r WHERE r.id=run_id AND r.origin_instance_id='supabase'));
CREATE FUNCTION aliyun_bridge.source_storage_allowed(bucket text,path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,aliyun_bridge,pg_temp AS $$SELECT bucket<>'aliyun-task-inputs' AND (
 bucket NOT IN('geoprocessing-results','facade-generation') OR NOT EXISTS(SELECT 1 FROM aliyun_bridge.run_origins r
 WHERE r.run_id::text IN(split_part(path,'/',2),CASE WHEN split_part(path,'/',2)='cloud' THEN split_part(path,'/',3) END)))$$;
CREATE POLICY source_origin_boundary ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated,anon
 USING(aliyun_bridge.source_storage_allowed(bucket_id,name)) WITH CHECK(aliyun_bridge.source_storage_allowed(bucket_id,name));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('aliyun-task-inputs','aliyun-task-inputs',false,10485760,ARRAY['image/jpeg','image/png']);
-- Only a trusted server/Worker uses the private bucket; no browser policy.
CREATE POLICY aliyun_inputs_service ON storage.objects FOR ALL TO service_role USING(bucket_id='aliyun-task-inputs') WITH CHECK(bucket_id='aliyun-task-inputs');
GRANT USAGE ON SCHEMA aliyun_bridge TO authenticated,anon;
GRANT EXECUTE ON FUNCTION aliyun_bridge.source_storage_allowed(text,text) TO authenticated,anon;
-- User RPCs read with a definer. Guard before reads as well as mutations,
-- including no-op paths which otherwise return false for another owner.
DO $$DECLARE def text;signature text;BEGIN
 FOREACH signature IN ARRAY ARRAY['public.import_geoprocessing_result(uuid,jsonb)',
  'public.request_geoprocessing_cancel(uuid)','public.teacher_cancel_geoprocessing_run(uuid)',
  'public.request_facade_cancel(uuid)','public.confirm_facade_crop(uuid,double precision,text,double precision,double precision)',
  'public.retry_failed_facade_run(uuid)'] LOOP
 IF to_regprocedure(signature) IS NOT NULL THEN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO def;
  IF def !~* '\mbegin\M' THEN RAISE EXCEPTION 'UNREVIEWED_IMPORT_RPC';END IF;
  def:=regexp_replace(def,'\mbegin\M','BEGIN PERFORM aliyun_bridge.assert_source_run(p_run_id);','i');EXECUTE def;
 END IF;
 END LOOP;
END$$;
-- The old per-owner active-job quota counts source jobs only, preserving the two
-- independently writable sites. Fixed reviewed definitions, no generic rewrite.
DO $$DECLARE r record;def text;patched text;BEGIN
 FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.proname IN('submit_geoprocessing_run','submit_facade_run') AND has_function_privilege('authenticated',p.oid,'EXECUTE') LOOP
  def:=pg_get_functiondef(r.oid);
  patched:=regexp_replace(def,'where\s+owner_id\s*=\s*auth.uid\(\)\s+and\s+status\s+in','where origin_instance_id=''supabase'' and owner_id=auth.uid() and status in','gi');
  IF patched=def THEN RAISE EXCEPTION 'UNREVIEWED_SOURCE_SUBMIT_RPC';END IF;EXECUTE patched;
 END LOOP;
END$$;
CREATE FUNCTION aliyun_bridge.authorize(i text,r jsonb) RETURNS aliyun_bridge.requests LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,aliyun_bridge,pg_temp AS $$DECLARE request aliyun_bridge.requests;c aliyun_bridge.contexts;p aliyun_bridge.contexts;photo aliyun_bridge.contexts;BEGIN
 SELECT * INTO request FROM aliyun_bridge.requests WHERE instance_id=i AND owner_id=(r->>'ownerId')::uuid AND request_id=(r->>'requestId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO c FROM aliyun_bridge.contexts WHERE instance_id=i AND local_kind='space' AND local_id=request.context_id;
 SELECT * INTO p FROM aliyun_bridge.contexts WHERE instance_id=i AND local_kind='profile' AND local_id=request.owner_id::text;
 IF c.tombstone IS DISTINCT FROM false OR p.tombstone IS DISTINCT FROM false OR NOT coalesce((p.payload->>'active')::boolean,false) OR NOT coalesce(c.payload->'members' ? request.owner_id::text,false) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF request.kind<>'geo' THEN
  SELECT * INTO photo FROM aliyun_bridge.contexts WHERE instance_id=i AND local_kind='photo' AND local_id=request.request->>'photoId';
  IF photo.tombstone IS DISTINCT FROM false OR photo.payload->>'contextId' IS DISTINCT FROM request.context_id THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 END IF;RETURN request;
END$$;
CREATE FUNCTION aliyun_bridge.cancel_run(k text,rid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF k='geo' THEN UPDATE public.geoprocessing_runs SET status=CASE WHEN status='queued' THEN 'canceled' ELSE 'cancel_requested' END,updated_at=now() WHERE id=rid AND status IN('queued','claimed','running');
 ELSIF k='facade' THEN UPDATE public.facade_generation_runs SET status=CASE WHEN status IN('queued_rectification','queued_generation','awaiting_crop') THEN 'canceled' ELSE 'cancel_requested' END,updated_at=now() WHERE id=rid AND status NOT IN('completed','failed','canceled');
 ELSE UPDATE public.cloud_facade_runs SET status='failed',error_code='CANCELED',updated_at=now() WHERE id=rid AND status IN('submitting','queued','running');END IF;RETURN FOUND;
END$$;
CREATE FUNCTION aliyun_bridge.bridge_v1_apply_context(p_instance_id text,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,aliyun_bridge,pg_temp AS $$DECLARE old aliyun_bridge.contexts;r aliyun_bridge.requests;k text:=p_request->>'localKind';lid text:=p_request->>'localId';v bigint:=(p_request->>'version')::bigint;gone boolean:=(p_request->>'tombstone')::boolean;payload jsonb:=p_request->'payload';BEGIN
 IF k NOT IN('profile','space','photo') OR v<1 OR gone IS NULL OR jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_instance_id||':'||k||':'||lid,10));
 SELECT * INTO old FROM aliyun_bridge.contexts WHERE instance_id=p_instance_id AND local_kind=k AND local_id=lid FOR UPDATE;
 IF FOUND THEN
  IF v<old.version OR old.tombstone AND NOT gone OR v=old.version AND (old.payload<>payload OR old.tombstone<>gone) THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
  IF v=old.version THEN RETURN jsonb_build_object('instanceId',p_instance_id,'version',v,'tombstone',gone);END IF;
 END IF;
 INSERT INTO aliyun_bridge.contexts(instance_id,local_kind,local_id,version,tombstone,payload) VALUES(p_instance_id,k,lid,v,gone,payload)
 ON CONFLICT(instance_id,local_kind,local_id) DO UPDATE SET version=excluded.version,tombstone=excluded.tombstone,payload=excluded.payload,updated_at=now();
 FOR r IN SELECT * FROM aliyun_bridge.requests WHERE instance_id=p_instance_id AND (
  (k='profile' AND owner_id::text=lid AND (gone OR NOT coalesce((payload->>'active')::boolean,false))) OR
  (k='space' AND context_id=lid AND (gone OR NOT coalesce(payload->'members' ? owner_id::text,false))) OR
  (k='photo' AND request->>'photoId'=lid AND gone)) LOOP PERFORM aliyun_bridge.cancel_run(r.kind,r.run_id);END LOOP;
 RETURN jsonb_build_object('instanceId',p_instance_id,'version',v,'tombstone',gone);
END$$;
CREATE FUNCTION aliyun_bridge.bridge_v1_enqueue(p_instance_id text,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,aliyun_bridge,auth,extensions,pg_temp AS $$
DECLARE owner uuid:=(p_request->>'ownerId')::uuid;rid uuid:=(p_request->>'requestId')::uuid;job_kind text:=p_request->>'kind';input jsonb:=p_request->'input';
 ctx aliyun_bridge.contexts;profile aliyun_bridge.contexts;photo aliyun_bridge.contexts;old aliyun_bridge.requests;run_id uuid:=gen_random_uuid();hash text;source record;geom extensions.geometry;bounds jsonb;steps text[];BEGIN
 IF p_instance_id!~'^aliyun-[a-zA-Z0-9_-]{1,92}$' OR job_kind NOT IN('geo','facade','cloud-facade') OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_instance_id||':'||owner::text,11));
 SELECT * INTO ctx FROM aliyun_bridge.contexts WHERE instance_id=p_instance_id AND local_kind='space' AND local_id=p_request->>'contextId' FOR SHARE;
 SELECT * INTO profile FROM aliyun_bridge.contexts WHERE instance_id=p_instance_id AND local_kind='profile' AND local_id=owner::text FOR SHARE;
 IF ctx.version IS DISTINCT FROM (p_request->>'contextVersion')::bigint OR profile.version IS DISTINCT FROM (p_request->>'profileVersion')::bigint THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 IF ctx.tombstone IS DISTINCT FROM false OR profile.tombstone IS DISTINCT FROM false OR NOT coalesce((profile.payload->>'active')::boolean,false) OR NOT coalesce(ctx.payload->'members' ? owner::text,false) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 hash:=encode(pg_catalog.sha256(convert_to(p_request::text,'UTF8')),'hex');
 SELECT * INTO old FROM aliyun_bridge.requests WHERE instance_id=p_instance_id AND owner_id=owner AND request_id=rid;
 IF FOUND THEN IF old.digest<>hash THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;RETURN jsonb_build_object('instanceId',p_instance_id,'runId',old.run_id);END IF;
 IF (SELECT count(*) FROM aliyun_bridge.requests r JOIN aliyun_bridge.run_origins o ON o.run_id=r.run_id WHERE r.instance_id=p_instance_id AND r.owner_id=owner AND r.kind=job_kind AND CASE WHEN job_kind='geo' THEN EXISTS(SELECT 1 FROM public.geoprocessing_runs g WHERE g.id=r.run_id AND status IN('queued','claimed','running','cancel_requested')) WHEN job_kind='facade' THEN EXISTS(SELECT 1 FROM public.facade_generation_runs f WHERE f.id=r.run_id AND status NOT IN('completed','failed','canceled')) ELSE EXISTS(SELECT 1 FROM public.cloud_facade_runs c WHERE c.id=r.run_id AND status IN('submitting','queued','running')) END)>=2 THEN RAISE EXCEPTION 'TOO_MANY_ACTIVE_RUNS';END IF;
 IF job_kind='geo' THEN
  IF NOT EXISTS(SELECT 1 FROM public.geoprocessing_villages WHERE village_id=ctx.payload->>'workerVillageId' AND active) THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
  SELECT * INTO source FROM public.get_geoprocessing_source_status(ctx.payload->>'workerVillageId');
  IF source.state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;bounds:=source.bounds;
  steps:=ARRAY(SELECT jsonb_array_elements_text(input->'requestedSteps'));IF cardinality(steps) NOT BETWEEN 1 AND 3 OR NOT steps<@ARRAY['buildings','roads_water','contours']::text[] OR input-'requestedSteps'-'aoi'-'parameters'<>'{}' OR coalesce(input->'parameters','{}')-ARRAY['building_threshold','contour_interval','contour_smoothing']::text[]<>'{}' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  geom:=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON((input->'aoi')::text),4326);
  IF geom IS NULL OR extensions.GeometryType(geom) NOT IN('POLYGON','MULTIPOLYGON') OR extensions.ST_NPoints(geom)>500 OR NOT extensions.ST_IsValid(geom)
   OR NOT extensions.ST_CoveredBy(geom,extensions.ST_MakeEnvelope((bounds->>0)::float8,(bounds->>1)::float8,(bounds->>2)::float8,(bounds->>3)::float8,4326))
   OR extensions.ST_Area(geom::extensions.geography)>least(source.max_aoi_sq_km,2)*1000000 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  INSERT INTO public.geoprocessing_runs(id,owner_id,course_id,village_id,teaching_project_id,dataset_id,input_manifest,requested_steps,aoi,parameters,origin_instance_id)
   VALUES(run_id,owner,p_instance_id||':'||(ctx.payload->>'courseId'),ctx.payload->>'workerVillageId',NULL,NULL,NULL,steps,input->'aoi',coalesce(input->'parameters','{}'),p_instance_id);
 ELSE
  SELECT * INTO photo FROM aliyun_bridge.contexts WHERE instance_id=p_instance_id AND local_kind='photo' AND local_id=p_request->>'photoId' FOR SHARE;
  IF photo.version IS DISTINCT FROM (p_request->>'photoVersion')::bigint OR photo.tombstone IS DISTINCT FROM false OR photo.payload->>'contextId' IS DISTINCT FROM ctx.local_id THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF NOT coalesce(photo.payload->>'sha256'~'^[a-f0-9]{64}$' AND photo.payload->>'mime' IN('image/jpeg','image/png') AND photo.payload->>'size'~'^[0-9]{1,8}$' AND photo.payload->>'path'~('^'||p_instance_id||'/photos/[a-f0-9-]{36}/'||(photo.payload->>'sha256')||CASE WHEN photo.payload->>'mime'='image/png' THEN '\.png$' ELSE '\.jpg$' END) AND input-'objectCode'='{}' AND length(input->>'objectCode') BETWEEN 1 AND 200,false) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF (photo.payload->>'size')::bigint NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF job_kind='facade' THEN INSERT INTO public.facade_generation_runs(id,owner_id,course_id,space_id,object_code,photo_id,source_photo_bucket,source_photo_path,source_photo_url,source_photo_sha256,source_photo_size,source_photo_mime,origin_instance_id)
   VALUES(run_id,owner,p_instance_id||':'||(ctx.payload->>'courseId'),p_instance_id||':'||ctx.local_id,input->>'objectCode',NULL,'aliyun-task-inputs',photo.payload->>'path',NULL,photo.payload->>'sha256',(photo.payload->>'size')::bigint,photo.payload->>'mime',p_instance_id);
  ELSE INSERT INTO public.cloud_facade_runs(id,owner_id,course_id,space_id,object_code,photo_id,model,origin_instance_id,source_photo_bucket,source_photo_path,source_photo_sha256,source_photo_size,source_photo_mime)
   VALUES(run_id,owner,p_instance_id||':'||(ctx.payload->>'courseId'),p_instance_id||':'||ctx.local_id,input->>'objectCode',NULL,'pending-bridge-provider',p_instance_id,'aliyun-task-inputs',photo.payload->>'path',photo.payload->>'sha256',(photo.payload->>'size')::bigint,photo.payload->>'mime');END IF;
 END IF;
 INSERT INTO aliyun_bridge.requests VALUES(p_instance_id,owner,rid,ctx.local_id,job_kind,run_id,hash,p_request,now());
 INSERT INTO aliyun_bridge.run_origins VALUES(run_id,p_instance_id,job_kind,owner,rid);
 RETURN jsonb_build_object('instanceId',p_instance_id,'runId',run_id);
END$$;
CREATE FUNCTION aliyun_bridge.bridge_v1_status(p_instance_id text,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,aliyun_bridge,pg_temp AS $$DECLARE r aliyun_bridge.requests;data jsonb;BEGIN
 r:=aliyun_bridge.authorize(p_instance_id,p_request);
 IF r.kind='geo' THEN SELECT to_jsonb(x) INTO data FROM public.geoprocessing_runs x WHERE id=r.run_id;
 ELSIF r.kind='facade' THEN SELECT to_jsonb(x) INTO data FROM public.facade_generation_runs x WHERE id=r.run_id;
 ELSE SELECT to_jsonb(x) INTO data FROM public.cloud_facade_runs x WHERE id=r.run_id;END IF;
 RETURN jsonb_build_object('instanceId',p_instance_id,'runId',r.run_id,'kind',r.kind,'run',data);
END$$;
CREATE FUNCTION aliyun_bridge.bridge_v1_cancel(p_instance_id text,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,aliyun_bridge,pg_temp AS $$DECLARE r aliyun_bridge.requests;BEGIN r:=aliyun_bridge.authorize(p_instance_id,p_request);RETURN jsonb_build_object('instanceId',p_instance_id,'runId',r.run_id,'canceled',aliyun_bridge.cancel_run(r.kind,r.run_id));END$$;
CREATE FUNCTION aliyun_bridge.bridge_v1_confirm_crop(p_instance_id text,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,aliyun_bridge,pg_temp AS $$DECLARE r aliyun_bridge.requests;ok boolean;BEGIN
 r:=aliyun_bridge.authorize(p_instance_id,p_request);IF r.kind<>'facade' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM set_config('request.jwt.claim.sub',r.owner_id::text,true);
 SELECT public.confirm_facade_crop(r.run_id,(p_request->>'cropTop')::float8,p_request->>'roofType',(p_request->>'buildingWidth')::float8,(p_request->>'buildingDepth')::float8) INTO ok;
 RETURN jsonb_build_object('instanceId',p_instance_id,'runId',r.run_id,'confirmed',ok);
END$$;
CREATE FUNCTION aliyun_bridge.bridge_v1_retry(p_instance_id text,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,aliyun_bridge,pg_temp AS $$DECLARE r aliyun_bridge.requests;ok boolean;BEGIN
 r:=aliyun_bridge.authorize(p_instance_id,p_request);IF r.kind<>'facade' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM set_config('request.jwt.claim.sub',r.owner_id::text,true);SELECT public.retry_failed_facade_run(r.run_id) INTO ok;
 RETURN jsonb_build_object('instanceId',p_instance_id,'runId',r.run_id,'retried',ok);
END$$;
CREATE FUNCTION aliyun_bridge.bridge_v1_artifacts(p_instance_id text,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,aliyun_bridge,pg_temp AS $$DECLARE r aliyun_bridge.requests;data jsonb;BEGIN
 r:=aliyun_bridge.authorize(p_instance_id,p_request);
 IF r.kind='geo' THEN SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO data FROM public.geoprocessing_artifacts a WHERE run_id=r.run_id;
 ELSIF r.kind='facade' THEN SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO data FROM public.facade_generation_artifacts a WHERE run_id=r.run_id;
 ELSE SELECT jsonb_build_array(to_jsonb(a)) INTO data FROM public.cloud_facade_runs a WHERE id=r.run_id;END IF;
 RETURN jsonb_build_object('instanceId',p_instance_id,'runId',r.run_id,'artifacts',data);
END$$;
REVOKE ALL ON ALL TABLES IN SCHEMA aliyun_bridge FROM PUBLIC,anon,authenticated,service_role,village_aliyun_bridge;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA aliyun_bridge FROM PUBLIC,anon,authenticated,service_role,village_aliyun_bridge;
GRANT EXECUTE ON FUNCTION aliyun_bridge.source_storage_allowed(text,text) TO authenticated,anon;
GRANT EXECUTE ON FUNCTION aliyun_bridge.bridge_v1_apply_context(text,jsonb),aliyun_bridge.bridge_v1_enqueue(text,jsonb),aliyun_bridge.bridge_v1_status(text,jsonb),aliyun_bridge.bridge_v1_cancel(text,jsonb),aliyun_bridge.bridge_v1_confirm_crop(text,jsonb),aliyun_bridge.bridge_v1_retry(text,jsonb),aliyun_bridge.bridge_v1_artifacts(text,jsonb) TO village_aliyun_bridge;
NOTIFY pgrst,'reload schema';
COMMIT;
