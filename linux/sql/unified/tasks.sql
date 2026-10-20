-- Candidate-only durable requests. The source queue is never a local business FK.
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED';END IF;END$$;
CREATE TABLE api_private.task_worker_villages(local_village_id uuid PRIMARY KEY REFERENCES public.villages,worker_village_id text NOT NULL);
CREATE TABLE api_private.task_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),instance_id text NOT NULL,owner_id uuid NOT NULL REFERENCES public.profiles,
 request_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('geo','facade','cloud-facade')),context jsonb NOT NULL,grant_key text NOT NULL,
 input jsonb NOT NULL,photo_id bigint REFERENCES public.object_photos ON DELETE RESTRICT,source_run_id uuid,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','queued','running','completed','failed','canceled','revoked')),
 remote_status text,progress integer NOT NULL DEFAULT 0,error_code text,imported_bundle uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(instance_id,owner_id,request_id),UNIQUE(instance_id,source_run_id)
);
CREATE TABLE api_private.task_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES api_private.task_requests,
 operation text NOT NULL CHECK(operation IN('submit','poll','cancel','retry','confirmCrop','import')),input jsonb NOT NULL DEFAULT '{}',
 attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease uuid,lease_until timestamptz,done boolean NOT NULL DEFAULT false,
 UNIQUE(task_id,operation)
);
CREATE TABLE api_private.task_snapshots(kind text NOT NULL,local_id text NOT NULL,version bigint NOT NULL,payload jsonb NOT NULL,tombstone boolean NOT NULL,PRIMARY KEY(kind,local_id));
ALTER TABLE public.personal_result_bundles ALTER COLUMN source_run_id DROP NOT NULL;
ALTER TABLE public.personal_layer_versions ALTER COLUMN source_run_id DROP NOT NULL;
ALTER TABLE public.personal_result_bundles ADD COLUMN local_task_id uuid REFERENCES api_private.task_requests;
ALTER TABLE public.personal_layer_versions ADD COLUMN local_task_id uuid REFERENCES api_private.task_requests;
CREATE UNIQUE INDEX personal_result_local_task ON public.personal_result_bundles(space_id,local_task_id) WHERE local_task_id IS NOT NULL;

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
 SELECT jsonb_build_object('requestId',t.request_id,'state',t.state,'sourceRunId',t.source_run_id,'kind',t.kind,'status',coalesce(t.remote_status,t.state),'progress',t.progress,'errorCode',t.error_code,'importedBundle',t.imported_bundle,'context',t.context,'createdAt',t.created_at,'updatedAt',t.updated_at)
$$;
CREATE FUNCTION api_private.task_execute(a text,p jsonb,instance text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE t api_private.task_requests;ctx jsonb;result jsonb;cached jsonb;k text;op text;rid uuid;photo public.object_photos;BEGIN
 IF instance!~'^aliyun-[a-zA-Z0-9_-]{1,92}$' OR api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF a='tasks.list' THEN
  SELECT coalesce(jsonb_agg(api_private.task_public(r) ORDER BY r.created_at DESC),'[]') INTO result FROM (SELECT * FROM api_private.task_requests WHERE instance_id=instance AND owner_id=auth.uid() AND context->>'villageId'=p->>'villageId' AND state<>'revoked' ORDER BY created_at DESC LIMIT 100)r
  WHERE api_private.context_accessible((r.context->>'teachingProjectId')::uuid,(r.context->>'villageId')::uuid,r.context->>'spaceId') AND api_private.task_grant_key(r.context)=r.grant_key;RETURN result;
 END IF;
 IF a IN('tasks.availability','tasks.sourceStatus') THEN RAISE EXCEPTION 'NOT_IMPLEMENTED';END IF;
 IF a IN('tasks.submitGeo','tasks.submitFacade') THEN
  ctx:=jsonb_build_object('teachingProjectId',p->>'teachingProjectId','villageId',p->>'villageId','spaceId',p->>'spaceId','courseId',p->>'courseId');
  PERFORM api_private.assert_context(ctx);
  IF NOT EXISTS(SELECT 1 FROM public.teaching_projects WHERE id=(p->>'teachingProjectId')::uuid AND course_id=p->>'courseId' AND stage NOT IN('completed','archived')) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  SELECT * INTO t FROM api_private.task_requests WHERE instance_id=instance AND owner_id=auth.uid() AND request_id=(p->>'requestId')::uuid;
  IF FOUND THEN PERFORM api_private.task_guard(t);END IF;
  cached:=api_private.begin_operation(a,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
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
 IF a='tasks.artifacts' THEN RETURN jsonb_build_object('requestId',t.request_id,'available',t.state='completed');END IF;
 cached:=api_private.begin_operation(a,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 op:=CASE a WHEN 'tasks.cancel' THEN 'cancel' WHEN 'tasks.retry' THEN 'retry' WHEN 'tasks.confirmCrop' THEN 'confirmCrop' WHEN 'tasks.importResult' THEN 'import' END;
 IF op IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF op='import' THEN
  IF t.state<>'completed' OR t.kind<>'geo' THEN RAISE EXCEPTION 'SOURCE_NOT_READY';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_personal_spaces WHERE id::text=p->>'spaceId' AND owner_id=auth.uid() AND teaching_project_id=(t.context->>'teachingProjectId')::uuid AND village_id::text=t.context->>'villageId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSIF op IN('retry','confirmCrop') AND (t.kind<>'facade' OR t.source_run_id IS NULL) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
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
 ELSIF o.operation='poll' THEN
  IF result->>'instanceId' IS DISTINCT FROM t.instance_id OR (result->>'runId')::uuid IS DISTINCT FROM t.source_run_id THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  s:=result->'run'->>'status';IF s NOT IN('queued','claimed','running','completed','failed','canceled','cancel_requested','queued_rectification','claimed_rectification','rectifying','awaiting_crop','queued_generation','claimed_generation','generating','submitting','succeeded') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  UPDATE api_private.task_requests SET remote_status=s,state=CASE WHEN s IN('completed','succeeded') THEN 'completed' WHEN s IN('failed','canceled') THEN s ELSE 'running' END,progress=greatest(0,least(100,coalesce((result->'run'->>'progress')::integer,0))),error_code=NULL,updated_at=now() WHERE id=t.id;
 ELSIF o.operation='cancel' THEN UPDATE api_private.task_requests SET remote_status='cancel_requested',updated_at=now() WHERE id=t.id;
 ELSIF o.operation='import' THEN RAISE EXCEPTION 'NOT_IMPLEMENTED';
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
CREATE FUNCTION api_private.task_photo_file(rid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE t api_private.task_requests;fid uuid;BEGIN
 SELECT * INTO t FROM api_private.task_requests WHERE request_id=rid;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM set_config('request.jwt.claim.sub',t.owner_id::text,true);PERFORM api_private.task_guard(t);
 SELECT file_id INTO fid FROM public.object_photos WHERE id=t.photo_id;RETURN api_private.file_authorize(fid);
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_private FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION api_private.task_public(api_private.task_requests),api_private.task_guard(api_private.task_requests),api_private.task_grant_key(jsonb),api_private.task_snapshot(text,text,jsonb,boolean) FROM authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.task_execute(text,jsonb,text),api_private.task_assert_photo_mutable(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION api_private.task_next(text),api_private.task_finish(uuid,uuid,jsonb),api_private.task_fail(uuid,text,integer,uuid),api_private.task_photo_file(uuid) TO village_unified_login;
