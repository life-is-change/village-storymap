-- Candidate-only durable requests. The source queue is never a local business FK.
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED';END IF;END$$;
CREATE TABLE api_private.task_worker_villages(local_village_id uuid PRIMARY KEY REFERENCES public.villages,worker_village_id text NOT NULL);
CREATE TABLE api_private.task_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),instance_id text NOT NULL,owner_id uuid NOT NULL REFERENCES public.profiles,
 request_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('geo','facade','cloud-facade')),context jsonb NOT NULL,grant_key text NOT NULL,
 input jsonb NOT NULL,photo_id bigint REFERENCES public.object_photos ON DELETE RESTRICT,source_run_id uuid,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','queued','running','completed','failed','canceled','revoked')),
 remote_status text,remote_info jsonb NOT NULL DEFAULT '{}',progress integer NOT NULL DEFAULT 0,error_code text,imported_bundle uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(instance_id,owner_id,request_id),UNIQUE(instance_id,source_run_id)
);
CREATE TABLE api_private.task_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES api_private.task_requests,
 operation text NOT NULL CHECK(operation IN('submit','poll','cancel','retry','confirmCrop','import')),input jsonb NOT NULL DEFAULT '{}',
 attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease uuid,lease_until timestamptz,done boolean NOT NULL DEFAULT false,
 UNIQUE(task_id,operation)
);
CREATE TABLE api_private.task_snapshots(kind text NOT NULL,local_id text NOT NULL,version bigint NOT NULL,payload jsonb NOT NULL,tombstone boolean NOT NULL,PRIMARY KEY(kind,local_id));
CREATE TABLE api_private.task_artifacts(
 task_id uuid NOT NULL REFERENCES api_private.task_requests,artifact_type text NOT NULL,file_id uuid NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),size bigint NOT NULL CHECK(size BETWEEN 1 AND 52428800),mime text NOT NULL,
 extension text NOT NULL,layer_key text,feature_count integer,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','ready')),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,artifact_type,sha256)
);
ALTER TABLE public.personal_result_bundles ALTER COLUMN source_run_id DROP NOT NULL;
ALTER TABLE public.personal_layer_versions ALTER COLUMN source_run_id DROP NOT NULL;
ALTER TABLE public.personal_result_bundles ADD COLUMN local_task_id uuid REFERENCES api_private.task_requests;
ALTER TABLE public.personal_layer_versions ADD COLUMN local_task_id uuid REFERENCES api_private.task_requests;
CREATE UNIQUE INDEX personal_result_local_task ON public.personal_result_bundles(space_id,local_task_id) WHERE local_task_id IS NOT NULL;
CREATE TABLE api_private.task_import_receipts(instance_id text NOT NULL,source_run_id uuid NOT NULL,artifact_digest text NOT NULL,space_id uuid NOT NULL,bundle_id uuid NOT NULL REFERENCES public.personal_result_bundles,PRIMARY KEY(instance_id,source_run_id,artifact_digest,space_id));

CREATE FUNCTION api_private.task_grant_key(c jsonb) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE v text;BEGIN
 PERFORM api_private.assert_context(c);
 IF api_private.staff() THEN v:='staff:'||api_private.current_role();
 ELSE SELECT coalesce(jsonb_agg(jsonb_build_array(m.group_id,to_jsonb(m)->>'joined_at') ORDER BY m.group_id)::text,'[]') INTO v
  FROM public.group_memberships m JOIN public.teaching_projects t ON t.course_id=m.course_id WHERE t.id=(c->>'teachingProjectId')::uuid AND m.student_key=api_private.student_key();END IF;
 RETURN encode(sha256(convert_to(jsonb_build_array(auth.uid(),c->>'teachingProjectId',c->>'villageId',c->>'spaceId',v)::text,'UTF8')),'hex');
END$$;
CREATE FUNCTION api_private.task_guard(t api_private.task_requests) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$BEGIN
 IF t.owner_id IS DISTINCT FROM auth.uid() OR api_private.profile_status()<>'active' OR t.state='revoked' OR api_private.task_grant_key(t.context) IS DISTINCT FROM t.grant_key THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF t.photo_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.object_photos p WHERE p.id=t.photo_id AND p.teaching_project_id=(t.context->>'teachingProjectId')::uuid AND p.village_id=(t.context->>'villageId')::uuid AND p.space_id=t.context->>'spaceId' AND p.object_code=t.input->>'objectCode' AND p.file_id IS NOT NULL) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
END$$;
CREATE FUNCTION api_private.task_public(t api_private.task_requests) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT t.remote_info||jsonb_build_object('requestId',t.request_id,'state',t.state,'sourceRunId',t.source_run_id,'kind',t.kind,'status',coalesce(t.remote_status,t.state),'progress',t.progress,'errorCode',t.error_code,'importedBundle',t.imported_bundle,'context',t.context,'photoId',t.photo_id,'objectCode',t.input->>'objectCode','createdAt',t.created_at,'updatedAt',t.updated_at)
$$;
CREATE FUNCTION api_private.task_execute(a text,p jsonb,instance text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE t api_private.task_requests;ctx jsonb;result jsonb;cached jsonb;k text;op text;rid uuid;photo public.object_photos;BEGIN
 IF instance!~'^aliyun-[a-zA-Z0-9_-]{1,92}$' OR api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF a='tasks.list' THEN
  SELECT coalesce(jsonb_agg(api_private.task_public(r) ORDER BY r.created_at DESC),'[]') INTO result FROM (SELECT * FROM api_private.task_requests WHERE instance_id=instance AND owner_id=auth.uid() AND context->>'villageId'=p->>'villageId' AND state<>'revoked' ORDER BY created_at DESC LIMIT 100)r
  WHERE api_private.context_accessible((r.context->>'teachingProjectId')::uuid,(r.context->>'villageId')::uuid,r.context->>'spaceId') AND api_private.task_grant_key(r.context)=r.grant_key;RETURN result;
 END IF;
 IF a='tasks.availability' THEN RETURN jsonb_build_object('authorized',true);END IF;
 IF a='tasks.sourceStatus' THEN
  SELECT jsonb_build_object('workerVillageId',w.worker_village_id) INTO result FROM api_private.task_worker_villages w JOIN public.villages v ON v.id=w.local_village_id WHERE v.id=(p->>'villageId')::uuid AND v.status='published';
  IF result IS NULL THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;RETURN result;
 END IF;
 IF a IN('tasks.submitGeo','tasks.submitFacade') THEN
  ctx:=jsonb_build_object('teachingProjectId',p->>'teachingProjectId','villageId',p->>'villageId','spaceId',p->>'spaceId','courseId',p->>'courseId');
  PERFORM api_private.assert_context(ctx);
  IF NOT EXISTS(SELECT 1 FROM public.teaching_projects WHERE id=(p->>'teachingProjectId')::uuid AND course_id=p->>'courseId' AND stage NOT IN('completed','archived')) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  SELECT * INTO t FROM api_private.task_requests WHERE instance_id=instance AND owner_id=auth.uid() AND request_id=(p->>'requestId')::uuid;
  IF FOUND THEN PERFORM api_private.task_guard(t);END IF;
  cached:=api_private.begin_operation(a,p);IF cached IS NOT NULL THEN RETURN cached->'result';END IF;
  IF a='tasks.submitGeo' THEN
   k:='geo';IF NOT EXISTS(SELECT 1 FROM api_private.task_worker_villages WHERE local_village_id=(p->>'villageId')::uuid) THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
  ELSE k:=p->>'kind';SELECT * INTO photo FROM public.object_photos WHERE id=(p->>'photoId')::bigint FOR UPDATE;
   IF photo.id IS NULL OR photo.file_id IS NULL OR photo.teaching_project_id IS DISTINCT FROM (p->>'teachingProjectId')::uuid OR photo.village_id IS DISTINCT FROM (p->>'villageId')::uuid OR photo.space_id IS DISTINCT FROM p->>'spaceId' OR photo.object_code IS DISTINCT FROM p->>'objectCode' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  END IF;
  INSERT INTO api_private.task_requests(instance_id,owner_id,request_id,kind,context,grant_key,input,photo_id)
   VALUES(instance,auth.uid(),(p->>'requestId')::uuid,k,ctx,api_private.task_grant_key(ctx),p,photo.id) RETURNING * INTO t;
  INSERT INTO api_private.task_outbox(task_id,operation) VALUES(t.id,'submit');
  RETURN api_private.finish_operation(a,p,api_private.task_public(t));
 END IF;
 rid:=coalesce(p->>'taskId',p->>'requestId')::uuid;
 SELECT * INTO t FROM api_private.task_requests WHERE instance_id=instance AND owner_id=auth.uid() AND request_id=rid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;PERFORM api_private.task_guard(t);
 IF a='tasks.get' THEN RETURN api_private.task_public(t);END IF;
 IF a='tasks.isImported' THEN RETURN jsonb_build_object('imported',t.imported_bundle IS NOT NULL,'bundleId',t.imported_bundle);END IF;
 IF a='tasks.artifacts' THEN RETURN api_private.task_artifacts_read(t.request_id,instance);END IF;
 cached:=api_private.begin_operation(a,p);IF cached IS NOT NULL THEN RETURN cached->'result';END IF;
 op:=CASE a WHEN 'tasks.cancel' THEN 'cancel' WHEN 'tasks.retry' THEN 'retry' WHEN 'tasks.confirmCrop' THEN 'confirmCrop' WHEN 'tasks.importResult' THEN 'import' END;
 IF op IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF op='import' THEN
  IF t.state<>'completed' OR t.kind<>'geo' THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_personal_spaces WHERE id::text=p->>'spaceId' AND owner_id=auth.uid() AND teaching_project_id=(t.context->>'teachingProjectId')::uuid AND village_id::text=t.context->>'villageId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSIF op IN('retry','confirmCrop') AND (t.kind<>'facade' OR t.source_run_id IS NULL) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF EXISTS(SELECT 1 FROM api_private.task_outbox WHERE task_id=t.id AND operation=op AND NOT done AND input<>p-'taskId'-'requestId') THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 INSERT INTO api_private.task_outbox(task_id,operation,input) VALUES(t.id,op,p-'taskId'-'requestId')
 ON CONFLICT(task_id,operation) DO UPDATE SET input=excluded.input,done=false,next_at=now(),attempts=0 WHERE api_private.task_outbox.done;
 RETURN api_private.finish_operation(a,p,jsonb_build_object('requestId',t.request_id,'state','pending','operation',op));
END$$;
CREATE FUNCTION api_private.task_snapshot(k text,lid text,p jsonb,gone boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,api_private,pg_temp AS $$DECLARE s api_private.task_snapshots;BEGIN
 SELECT * INTO s FROM api_private.task_snapshots WHERE kind=k AND local_id=lid FOR UPDATE;
 IF FOUND THEN
  IF s.tombstone AND NOT gone THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF s.payload<>p OR s.tombstone<>gone THEN UPDATE api_private.task_snapshots SET version=version+1,payload=p,tombstone=gone WHERE kind=k AND local_id=lid RETURNING * INTO s;END IF;
 ELSE INSERT INTO api_private.task_snapshots VALUES(k,lid,1,p,gone) RETURNING * INTO s;END IF;
 RETURN jsonb_build_object('localKind',k,'localId',lid,'version',s.version,'tombstone',gone,'payload',p);
END$$;
CREATE FUNCTION api_private.task_next(instance text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE o api_private.task_outbox;t api_private.task_requests;allowed boolean:=true;active boolean;profile jsonb;capsule jsonb;photo jsonb;key text;village text;result jsonb;fid uuid;BEGIN
 -- SKIP LOCKED and a durable lease survive a process crash; source receipts
 -- make an expired lease safe to retry without a second GPU job.
 SELECT * INTO o FROM api_private.task_outbox WHERE NOT done AND next_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO t FROM api_private.task_requests WHERE id=o.task_id AND instance_id=instance FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM set_config('request.jwt.claim.sub',t.owner_id::text,true);
 active:=api_private.profile_status()='active';
 BEGIN PERFORM api_private.task_guard(t);EXCEPTION WHEN raise_exception THEN allowed:=false;END;
 key:='grant:'||t.grant_key;
 SELECT worker_village_id INTO village FROM api_private.task_worker_villages WHERE local_village_id=(t.context->>'villageId')::uuid;
 profile:=api_private.task_snapshot('profile',t.owner_id::text,jsonb_build_object('active',active),NOT active);
 capsule:=api_private.task_snapshot('space',key,jsonb_build_object('members',CASE WHEN allowed THEN jsonb_build_array(t.owner_id) ELSE '[]'::jsonb END,'courseId',t.context->>'courseId','workerVillageId',village),NOT allowed);
 UPDATE api_private.task_outbox SET lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' WHERE id=o.id RETURNING * INTO o;
 result:=jsonb_build_object('id',o.id,'lease',o.lease,'operation',o.operation,'input',o.input,'attempts',o.attempts,'ownerId',t.owner_id,'requestId',t.request_id,'revoked',NOT allowed,'snapshots',jsonb_build_array(profile,capsule),
  'instanceId',t.instance_id,'sourceRunId',t.source_run_id,'kind',t.kind,
  'bridgeInput',jsonb_build_object('ownerId',t.owner_id,'requestId',t.request_id,'contextId',key,'contextVersion',capsule->'version','profileVersion',profile->'version','kind',t.kind,'input',CASE WHEN t.kind='geo' THEN t.input-'requestId'-'teachingProjectId'-'villageId'-'spaceId'-'courseId' ELSE jsonb_build_object('objectCode',t.input->>'objectCode') END));
 IF t.photo_id IS NOT NULL AND allowed AND o.operation='submit' THEN
  SELECT file_id INTO fid FROM public.object_photos WHERE id=t.photo_id;
  photo:=api_private.task_snapshot('photo','photo:'||t.photo_id||':'||t.grant_key,jsonb_build_object('contextId',key,'fileId',fid),false);
  result:=jsonb_set(result,'{bridgeInput}',(result->'bridgeInput')||jsonb_build_object('photoId',photo->>'localId','photoVersion',photo->'version'))
   ||jsonb_build_object('photo',jsonb_build_object('fileId',fid,'snapshot',photo));
 END IF;RETURN result;
END$$;
CREATE FUNCTION api_private.task_finish(oid uuid,token uuid,result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE o api_private.task_outbox;t api_private.task_requests;s text;BEGIN
 SELECT * INTO o FROM api_private.task_outbox WHERE id=oid AND lease=token AND NOT done FOR UPDATE;IF NOT FOUND THEN RETURN jsonb_build_object('accepted',false);END IF;
 SELECT * INTO t FROM api_private.task_requests WHERE id=o.task_id FOR UPDATE;PERFORM set_config('request.jwt.claim.sub',t.owner_id::text,true);
 IF coalesce((result->>'revoked')::boolean,false) THEN UPDATE api_private.task_requests SET state='revoked',error_code='FORBIDDEN',updated_at=now() WHERE id=t.id;UPDATE api_private.task_outbox SET done=true,lease=NULL,lease_until=NULL WHERE task_id=t.id;RETURN jsonb_build_object('revoked',true);END IF;
 PERFORM api_private.task_guard(t);
 IF o.operation='submit' THEN
  IF result->>'instanceId' IS DISTINCT FROM t.instance_id OR result->>'runId' IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  UPDATE api_private.task_requests SET source_run_id=(result->>'runId')::uuid,state='queued',error_code=NULL,updated_at=now() WHERE id=t.id;
 ELSIF o.operation IN('poll','retry') THEN
  IF result->>'instanceId' IS DISTINCT FROM t.instance_id OR (result->>'runId')::uuid IS DISTINCT FROM t.source_run_id THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  s:=result->'run'->>'status';IF s NOT IN('queued','claimed','running','completed','failed','canceled','cancel_requested','queued_rectification','claimed_rectification','rectifying','awaiting_crop','queued_generation','claimed_generation','generating','submitting','succeeded') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  UPDATE api_private.task_requests SET remote_status=s,state=CASE WHEN s IN('completed','succeeded') THEN 'completed' WHEN s IN('failed','canceled') THEN s ELSE 'running' END,progress=greatest(0,least(100,coalesce((result->'run'->>'progress')::integer,0))),
   remote_info=coalesce((SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(result->'run') e WHERE e.key IN('generation_revision','crop_top','roof_type','building_width','building_depth','attempt_count','rectification_attempt_count','generation_attempt_count')),'{}'),
   error_code=CASE WHEN result->'run'->>'error_code'~'^[A-Z0-9_]{1,80}$' THEN result->'run'->>'error_code' END,updated_at=now() WHERE id=t.id;
 ELSIF o.operation='cancel' THEN
  IF result->>'instanceId' IS DISTINCT FROM t.instance_id OR result->>'canceled' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  UPDATE api_private.task_requests SET state=CASE WHEN state IN('completed','failed','canceled') THEN state WHEN source_run_id IS NULL THEN 'canceled' ELSE state END,
   remote_status=CASE WHEN state IN('completed','failed','canceled') THEN remote_status WHEN source_run_id IS NULL THEN 'canceled' ELSE 'cancel_requested' END,updated_at=now() WHERE id=t.id;
  UPDATE api_private.task_outbox SET done=true,lease=NULL,lease_until=NULL WHERE task_id=t.id AND operation='submit';
 ELSIF o.operation='import' THEN
  IF t.imported_bundle IS NULL OR (result->>'bundleId')::uuid IS DISTINCT FROM t.imported_bundle THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
 END IF;
 UPDATE api_private.task_outbox SET done=true,lease=NULL,lease_until=NULL WHERE id=o.id;
 IF o.operation IN('submit','poll','cancel','retry','confirmCrop') AND EXISTS(SELECT 1 FROM api_private.task_requests WHERE id=t.id AND state NOT IN('completed','failed','canceled','revoked')) THEN
  INSERT INTO api_private.task_outbox(task_id,operation,next_at) VALUES(t.id,'poll',now()+interval '5 seconds') ON CONFLICT(task_id,operation) DO UPDATE SET done=false,lease=NULL,lease_until=NULL,attempts=0,next_at=excluded.next_at;
 END IF;RETURN jsonb_build_object('accepted',true);
END$$;
CREATE FUNCTION api_private.task_fail(oid uuid,err text,delay_ms integer,token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,api_private,pg_temp AS $$BEGIN
 UPDATE api_private.task_requests SET error_code=CASE WHEN err IN('FORBIDDEN','REVISION_CONFLICT','INVALID_INPUT','SOURCE_NOT_READY','WORKER_OFFLINE','TOO_MANY_ACTIVE_RUNS','NOT_FOUND','BRIDGE_UNAVAILABLE','FILE_UNAVAILABLE') THEN err ELSE 'BRIDGE_UNAVAILABLE' END,updated_at=now() WHERE id=(SELECT task_id FROM api_private.task_outbox WHERE id=oid AND lease=token);
 UPDATE api_private.task_outbox SET attempts=attempts+1,next_at=now()+make_interval(secs=>greatest(1000,least(delay_ms,30000))/1000.0),lease=NULL,lease_until=NULL WHERE id=oid AND lease=token;
 RETURN jsonb_build_object('retryScheduled',true);
END$$;
CREATE FUNCTION api_private.task_assert_photo_mutable(pid bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,pg_temp AS $$BEGIN
 PERFORM 1 FROM public.object_photos WHERE id=pid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM api_private.task_requests WHERE photo_id=pid) THEN RAISE EXCEPTION 'FILE_IN_USE';END IF;RETURN '{}'::jsonb;
END$$;
CREATE FUNCTION api_private.task_before_submit(oid uuid,token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,api_private,pg_temp AS $$DECLARE t api_private.task_requests;BEGIN
 SELECT r.* INTO t FROM api_private.task_requests r JOIN api_private.task_outbox o ON o.task_id=r.id WHERE o.id=oid AND o.lease=token AND NOT o.done AND o.operation='submit';
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;PERFORM set_config('request.jwt.claim.sub',t.owner_id::text,true);PERFORM api_private.task_guard(t);RETURN jsonb_build_object('allowed',true);
END$$;
CREATE FUNCTION api_private.task_photo_file(rid uuid,actor uuid,instance text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE t api_private.task_requests;fid uuid;BEGIN
 SELECT * INTO t FROM api_private.task_requests WHERE request_id=rid AND owner_id=actor AND instance_id=instance;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM set_config('request.jwt.claim.sub',t.owner_id::text,true);PERFORM api_private.task_guard(t);
 SELECT file_id INTO fid FROM public.object_photos WHERE id=t.photo_id;RETURN api_private.file_authorize(fid);
END$$;
CREATE FUNCTION api_private.task_outbox_guard(oid uuid,token uuid) RETURNS api_private.task_requests LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,api_private,pg_temp AS $$DECLARE t api_private.task_requests;BEGIN
 SELECT r.* INTO t FROM api_private.task_requests r JOIN api_private.task_outbox o ON o.task_id=r.id WHERE o.id=oid AND o.lease=token AND NOT o.done;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;PERFORM set_config('request.jwt.claim.sub',t.owner_id::text,true);PERFORM api_private.task_guard(t);RETURN t;
END$$;
CREATE FUNCTION api_private.task_artifact_manage(oid uuid,token uuid,action text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,api_private,pg_temp AS $$DECLARE t api_private.task_requests;a api_private.task_artifacts;k text:=p->>'artifactType';layer text;BEGIN
 t:=api_private.task_outbox_guard(oid,token);
 SELECT * INTO a FROM api_private.task_artifacts WHERE task_id=t.id AND artifact_type=k AND sha256=p->>'sha256';
 IF action='lookup' THEN RETURN to_jsonb(a);END IF;
 layer:=CASE k WHEN 'buildings' THEN 'building' WHEN 'roads' THEN 'road' WHEN 'waterways' THEN 'water' WHEN 'water_areas' THEN 'water' WHEN 'contours' THEN 'contours' END;
 IF action='reserve' THEN
  IF NOT coalesce(p->>'sha256'~'^[a-f0-9]{64}$' AND p->>'size'~'^[0-9]{1,9}$' AND (p->>'size')::bigint BETWEEN 1 AND CASE WHEN t.kind='geo' AND to_regclass('api_private.local_gpu_uploads') IS NOT NULL THEN 536870912 ELSE 52428800 END,false) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF t.kind='geo' THEN IF layer IS NULL OR p->>'mime'<>'application/geo+json' OR p->>'extension'<>'geojson' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  ELSIF k='building_glb' THEN IF p->>'mime'<>'model/gltf-binary' OR p->>'extension'<>'glb' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  ELSIF k NOT IN('rectified_preview','rectified_source','building_mask','standard_facade') OR p->>'mime' NOT IN('image/png','image/jpeg') OR p->>'extension' IS DISTINCT FROM (CASE WHEN p->>'mime'='image/png' THEN 'png' ELSE 'jpg' END) OR (p->>'size')::bigint>10485760 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  INSERT INTO api_private.task_artifacts(task_id,artifact_type,file_id,sha256,size,mime,extension,layer_key)
   VALUES(t.id,k,(p->>'fileId')::uuid,p->>'sha256',(p->>'size')::bigint,p->>'mime',p->>'extension',layer) ON CONFLICT(task_id,artifact_type,sha256) DO NOTHING;
  SELECT * INTO a FROM api_private.task_artifacts WHERE task_id=t.id AND artifact_type=k AND sha256=p->>'sha256';
  IF a.file_id IS DISTINCT FROM (p->>'fileId')::uuid OR a.size IS DISTINCT FROM (p->>'size')::bigint OR a.mime IS DISTINCT FROM p->>'mime' THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 ELSIF action='ready' THEN
  IF a.file_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  UPDATE api_private.task_artifacts SET state='ready',feature_count=(p->>'featureCount')::integer WHERE file_id=a.file_id RETURNING * INTO a;
 ELSE RAISE EXCEPTION 'INVALID_INPUT';END IF;
 RETURN to_jsonb(a);
END$$;
CREATE FUNCTION api_private.task_artifacts_read(rid uuid,instance text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,api_private,auth,pg_temp AS $$DECLARE t api_private.task_requests;result jsonb;BEGIN
 SELECT * INTO t FROM api_private.task_requests WHERE request_id=rid AND owner_id=auth.uid() AND instance_id=instance;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;PERFORM api_private.task_guard(t);
 SELECT coalesce(jsonb_agg(to_jsonb(a)-'task_id'),'[]') INTO result FROM (SELECT DISTINCT ON(artifact_type) * FROM api_private.task_artifacts WHERE task_id=t.id AND state='ready' ORDER BY artifact_type,created_at DESC)a;RETURN result;
END$$;
CREATE FUNCTION api_private.task_import_begin(oid uuid,token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE t api_private.task_requests;o api_private.task_outbox;s public.course_personal_spaces;b uuid;v uuid;l record;n integer;versions jsonb:='{}';digest text;BEGIN
 t:=api_private.task_outbox_guard(oid,token);SELECT * INTO o FROM api_private.task_outbox WHERE id=oid;
 IF o.operation<>'import' OR t.kind<>'geo' OR t.state<>'completed' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO s FROM public.course_personal_spaces WHERE id::text=o.input->>'spaceId' AND owner_id=t.owner_id AND teaching_project_id=(t.context->>'teachingProjectId')::uuid AND village_id::text=t.context->>'villageId' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT EXISTS(SELECT 1 FROM api_private.task_artifacts WHERE task_id=t.id AND state='ready' AND layer_key IS NOT NULL) THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
 SELECT encode(sha256(convert_to(string_agg(artifact_type||':'||sha256,',' ORDER BY artifact_type,sha256),'UTF8')),'hex') INTO digest FROM api_private.task_artifacts WHERE task_id=t.id AND state='ready' AND layer_key IS NOT NULL;
 IF t.imported_bundle IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM api_private.task_import_receipts WHERE instance_id=t.instance_id AND source_run_id=t.source_run_id AND artifact_digest=digest AND space_id=s.id AND bundle_id=t.imported_bundle) THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
  RETURN jsonb_build_object('bundleId',t.imported_bundle,'existing',true);
 END IF;
 INSERT INTO public.personal_result_bundles(space_id,source_run_id,local_task_id) VALUES(s.id,NULL,t.id) RETURNING id INTO b;
 INSERT INTO api_private.task_import_receipts VALUES(t.instance_id,t.source_run_id,digest,s.id,b);
 FOR l IN SELECT layer_key,array_agg(artifact_type ORDER BY artifact_type) types FROM api_private.task_artifacts WHERE task_id=t.id AND state='ready' AND layer_key IS NOT NULL GROUP BY layer_key LOOP
  SELECT coalesce(max(version_number),0)+1 INTO n FROM public.personal_layer_versions WHERE space_id=s.id AND layer_key=l.layer_key;
  INSERT INTO public.personal_layer_versions(space_id,bundle_id,layer_key,version_number,source_run_id,local_task_id,artifact_types,feature_count,editable)
   VALUES(s.id,b,l.layer_key,n,NULL,t.id,l.types,0,l.layer_key<>'contours') RETURNING id INTO v;versions:=versions||jsonb_build_object(l.layer_key,v);
 END LOOP;RETURN jsonb_build_object('bundleId',b,'versions',versions,'existing',false);
END$$;
CREATE FUNCTION api_private.task_import_append(oid uuid,token uuid,bundle uuid,layer text,features jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,extensions,pg_temp AS $$DECLARE t api_private.task_requests;v public.personal_layer_versions;f jsonb;g extensions.geometry;code text;counter integer;BEGIN
 t:=api_private.task_outbox_guard(oid,token);
 IF jsonb_typeof(features)<>'array' OR jsonb_array_length(features)>500 OR octet_length(features::text)>2097152 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 SELECT * INTO v FROM public.personal_layer_versions WHERE bundle_id=bundle AND local_task_id=t.id AND layer_key=layer FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT count(*) INTO counter FROM public.personal_layer_features WHERE layer_version_id=v.id;
 FOR f IN SELECT value FROM jsonb_array_elements(features) LOOP
  IF f->>'type' IS DISTINCT FROM 'Feature' OR jsonb_typeof(f->'geometry') IS DISTINCT FROM 'object' OR jsonb_typeof(coalesce(f->'properties','{}'))<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  g:=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON((f->'geometry')::text),4326);
  IF g IS NULL OR NOT extensions.ST_IsValid(g) OR extensions.ST_IsEmpty(g) OR NOT extensions.ST_CoveredBy(g,extensions.ST_MakeEnvelope(-180,-90,180,90,4326))
   OR extensions.GeometryType(g) NOT IN('POLYGON','MULTIPOLYGON','LINESTRING','MULTILINESTRING') OR layer='building' AND extensions.GeometryType(g) NOT IN('POLYGON','MULTIPOLYGON') OR layer IN('road','contours') AND extensions.GeometryType(g) NOT IN('LINESTRING','MULTILINESTRING') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  counter:=counter+1;code:=coalesce(nullif(f->>'id',''),nullif(f->'properties'->>'object_code',''),nullif(f->'properties'->>'code',''),layer||'-'||v.version_number||'-'||counter);
  IF length(code)>200 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  INSERT INTO public.personal_layer_features(space_id,layer_version_id,layer_key,object_code,object_name,geom,props) VALUES(v.space_id,v.id,layer,code,coalesce(nullif(f->'properties'->>'name',''),code),f->'geometry',coalesce(f->'properties','{}'));
 END LOOP;UPDATE public.personal_layer_versions SET feature_count=counter WHERE id=v.id;RETURN jsonb_build_object('featureCount',counter);
END$$;
CREATE FUNCTION api_private.task_import_finish(oid uuid,token uuid,bundle uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,pg_temp AS $$DECLARE t api_private.task_requests;v public.personal_layer_versions;expected integer;BEGIN
 t:=api_private.task_outbox_guard(oid,token);
 FOR v IN SELECT * FROM public.personal_layer_versions WHERE bundle_id=bundle AND local_task_id=t.id LOOP
  SELECT sum(feature_count) INTO expected FROM api_private.task_artifacts WHERE task_id=t.id AND state='ready' AND layer_key=v.layer_key;
  IF v.feature_count IS DISTINCT FROM expected THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  INSERT INTO public.personal_layer_selections(space_id,layer_key,current_version_id,comparison_version_id) VALUES(v.space_id,v.layer_key,v.id,NULL)
   ON CONFLICT(space_id,layer_key) DO UPDATE SET current_version_id=excluded.current_version_id,comparison_version_id=NULL,updated_at=now();
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.personal_result_bundles WHERE id=bundle AND local_task_id=t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 UPDATE api_private.task_requests SET imported_bundle=bundle,updated_at=now() WHERE id=t.id;RETURN jsonb_build_object('bundleId',bundle);
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_private FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION api_private.task_public(api_private.task_requests),api_private.task_guard(api_private.task_requests),api_private.task_grant_key(jsonb),api_private.task_snapshot(text,text,jsonb,boolean) FROM authenticated,village_unified_login;
REVOKE EXECUTE ON FUNCTION api_private.task_outbox_guard(uuid,uuid) FROM authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.task_execute(text,jsonb,text),api_private.task_assert_photo_mutable(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION api_private.task_artifacts_read(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION api_private.task_next(text),api_private.task_finish(uuid,uuid,jsonb),api_private.task_fail(uuid,text,integer,uuid),api_private.task_photo_file(uuid,uuid,text),api_private.task_before_submit(uuid,uuid) TO village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.task_artifact_manage(uuid,uuid,text,jsonb),api_private.task_import_begin(uuid,uuid),api_private.task_import_append(uuid,uuid,uuid,text,jsonb),api_private.task_import_finish(uuid,uuid,uuid) TO village_unified_login;
