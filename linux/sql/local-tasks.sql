-- Autonomous candidate only. Imported Supabase queues remain historical data.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1
   OR to_regclass('api_private.local_gpu_runs') IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_QUEUE_FRESH_TARGET_REQUIRED'; END IF;
END $$;
CREATE TABLE api_private.local_gpu_workers(
 id uuid PRIMARY KEY,instance_id text NOT NULL,name text NOT NULL,kind text NOT NULL CHECK(kind IN('geo','facade')),
 token_digest text NOT NULL CHECK(token_digest~'^[a-f0-9]{64}$'),revoked_at timestamptz,expires_at timestamptz,
 protocol text,state text NOT NULL DEFAULT 'starting',last_seen_at timestamptz,
 UNIQUE(instance_id,name)
);
CREATE TABLE api_private.local_gpu_sources(
 worker_id uuid NOT NULL REFERENCES api_private.local_gpu_workers,local_village_id uuid NOT NULL REFERENCES public.villages,
 ready boolean NOT NULL,bounds jsonb,error_code text,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(worker_id,local_village_id)
);
CREATE TABLE api_private.local_gpu_runs(
 id uuid PRIMARY KEY REFERENCES api_private.task_requests,instance_id text NOT NULL,owner_id uuid NOT NULL REFERENCES public.profiles,
 kind text NOT NULL CHECK(kind IN('geo','facade','cloud-facade')),input jsonb NOT NULL,input_digest text NOT NULL,photo_snapshot jsonb,
 phase text NOT NULL CHECK(phase IN('geo','rectification','generation','cloud')),
 status text NOT NULL,progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),stage text,error_code text,
 worker_id uuid REFERENCES api_private.local_gpu_workers,lease_token uuid,lease_until timestamptz,rectification_token uuid,completion_token uuid,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),rectification_attempts integer NOT NULL DEFAULT 0,generation_attempts integer NOT NULL DEFAULT 0,
 generation_revision integer NOT NULL DEFAULT 0,crop jsonb,warnings jsonb NOT NULL DEFAULT '[]',
 next_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status IN('queued','claimed','running','queued_rectification','claimed_rectification','rectifying','awaiting_crop','queued_generation','claimed_generation','generating','completed','failed','cancel_requested','canceled'))
);
CREATE INDEX local_gpu_claimable ON api_private.local_gpu_runs(kind,next_at,created_at) WHERE status IN('queued','queued_rectification','queued_generation');
CREATE TABLE api_private.local_gpu_claim_receipts(
 worker_id uuid NOT NULL REFERENCES api_private.local_gpu_workers,request_id uuid NOT NULL,run_id uuid NOT NULL REFERENCES api_private.local_gpu_runs,
 lease_token uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(worker_id,request_id)
);
-- Only the verified file commit functions may publish ready metadata (Task 6).
CREATE TABLE api_private.local_gpu_outputs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES api_private.local_gpu_runs,
 phase text NOT NULL,revision integer NOT NULL,artifact_type text NOT NULL,file_id uuid NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),size bigint NOT NULL CHECK(size>0 AND size<=536870912),mime text NOT NULL,extension text NOT NULL,
 state text NOT NULL CHECK(state IN('pending','ready')),lease_token uuid NOT NULL,validation jsonb NOT NULL DEFAULT '{}',source jsonb NOT NULL DEFAULT '{}',
 UNIQUE(run_id,phase,revision,artifact_type,sha256)
);
REVOKE ALL ON api_private.local_gpu_workers,api_private.local_gpu_sources,api_private.local_gpu_runs,api_private.local_gpu_claim_receipts,api_private.local_gpu_outputs FROM PUBLIC,anon,authenticated,village_unified_login;
CREATE FUNCTION api_private.local_task_pending_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,api_private,pg_temp
AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('local-task-quota:'||new.instance_id||new.owner_id||new.kind,0));
 IF (SELECT count(*) FROM api_private.task_requests WHERE instance_id=new.instance_id AND owner_id=new.owner_id AND kind=new.kind AND state IN('pending','queued','running'))>=2 THEN RAISE EXCEPTION 'TOO_MANY_ACTIVE_RUNS';END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION api_private.local_task_pending_quota() FROM PUBLIC,anon,authenticated,village_unified_login;
CREATE TRIGGER local_task_pending_quota BEFORE INSERT ON api_private.task_requests FOR EACH ROW EXECUTE FUNCTION api_private.local_task_pending_quota();

CREATE FUNCTION api_private.local_gpu_guard(r api_private.local_gpu_runs) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE t api_private.task_requests;BEGIN
 SELECT * INTO t FROM api_private.task_requests WHERE id=r.id AND instance_id=r.instance_id AND owner_id=r.owner_id;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM set_config('request.jwt.claim.sub',r.owner_id::text,true);
 BEGIN PERFORM api_private.task_guard(t);EXCEPTION WHEN raise_exception THEN RETURN false;END;
 RETURN true;
END $$;
CREATE FUNCTION api_private.local_gpu_sync(rid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,api_private,pg_temp
AS $$ DECLARE r api_private.local_gpu_runs;s text;info jsonb;BEGIN
 SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid;
 s:=CASE WHEN r.status='completed' THEN 'completed' WHEN r.status IN('failed','canceled') THEN r.status WHEN r.status IN('queued','queued_rectification','queued_generation') THEN 'queued' ELSE 'running' END;
 info:=jsonb_build_object('generation_revision',r.generation_revision,'crop_top',r.crop->'cropTop','roof_type',r.crop->'roofType','building_width',r.crop->'buildingWidth','building_depth',r.crop->'buildingDepth','attempt_count',r.attempts,'rectification_attempt_count',r.rectification_attempts,'generation_attempt_count',r.generation_attempts);
 UPDATE api_private.task_requests SET source_run_id=r.id,state=s,remote_status=r.status,progress=r.progress,error_code=r.error_code,remote_info=info,updated_at=now()
 WHERE id=r.id AND state<>'revoked' AND (source_run_id,state,remote_status,progress,error_code,remote_info) IS DISTINCT FROM (r.id,s,r.status,r.progress,r.error_code,info);
END $$;
CREATE FUNCTION api_private.local_gpu_public(r api_private.local_gpu_runs) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('id',r.id,'status',r.status,'progress',r.progress,'stage',r.stage,'error_code',r.error_code,'generation_revision',r.generation_revision,'crop_top',r.crop->'cropTop','roof_type',r.crop->'roofType','building_width',r.crop->'buildingWidth','building_depth',r.crop->'buildingDepth','attempt_count',r.attempts,'rectification_attempt_count',r.rectification_attempts,'generation_attempt_count',r.generation_attempts) $$;
CREATE FUNCTION api_private.local_gpu_worker_view(r api_private.local_gpu_runs) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,api_private,pg_temp
AS $$ SELECT jsonb_build_object('leaseToken',r.lease_token,'leaseUntil',r.lease_until,'kind',r.kind,'phase',r.phase,
 'run',api_private.local_gpu_public(r)||jsonb_build_object('owner_id',r.owner_id,'village_id',(SELECT w.worker_village_id FROM api_private.task_worker_villages w JOIN api_private.task_requests t ON (t.context->>'villageId')::uuid=w.local_village_id WHERE t.id=r.id),'input',r.input,'photo',r.photo_snapshot,'crop',r.crop)) $$;
CREATE FUNCTION api_private.local_gpu_outputs_ready(r api_private.local_gpu_runs) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,api_private,pg_temp
AS $$ DECLARE needed text[];step text;BEGIN
 IF r.phase='rectification' THEN needed:=ARRAY['rectified_preview','rectified_source','building_mask'];
 ELSIF r.phase='generation' THEN needed:=ARRAY['building_glb'];
 ELSIF r.phase='geo' THEN
  needed:=ARRAY[]::text[];
  FOR step IN SELECT jsonb_array_elements_text(r.input->'requestedSteps') LOOP
   needed:=needed||CASE step WHEN 'roads_water' THEN ARRAY['roads','waterways','water_areas'] ELSE ARRAY[step] END;
  END LOOP;
 ELSE RETURN false;END IF;
 RETURN cardinality(needed)>0 AND NOT EXISTS(SELECT 1 FROM unnest(needed) AS required(artifact_type) WHERE NOT EXISTS(
  SELECT 1 FROM api_private.local_gpu_outputs o WHERE o.run_id=r.id AND o.phase=r.phase AND o.revision=r.generation_revision AND o.artifact_type=required.artifact_type AND o.state='ready' AND o.lease_token=r.lease_token));
END $$;

CREATE FUNCTION api_private.local_worker_auth(wid uuid,digest text,instance text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,api_private,pg_temp
AS $$ SELECT jsonb_build_object('workerId',id,'kind',kind) FROM api_private.local_gpu_workers
 WHERE id=wid AND token_digest=digest AND instance_id=instance AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) $$;
CREATE FUNCTION api_private.local_queue_version() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT '{"schemaVersion":1}'::jsonb $$;
REVOKE ALL ON FUNCTION api_private.local_queue_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION api_private.local_queue_version() TO village_unified_login;

CREATE FUNCTION api_private.local_worker_call(wid uuid,digest text,instance text,action text,rid uuid,token uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE w api_private.local_gpu_workers;r api_private.local_gpu_runs;receipt api_private.local_gpu_claim_receipts;next_status text;BEGIN
 SELECT * INTO w FROM api_private.local_gpu_workers WHERE id=wid AND token_digest=digest AND instance_id=instance AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','UNAUTHORIZED');END IF;
 IF action='heartbeat' THEN
  IF p->>'protocol' IS DISTINCT FROM w.kind||'-aliyun-local-v1' OR p->>'state' NOT IN('idle','busy','error','starting') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  UPDATE api_private.local_gpu_workers SET protocol=p->>'protocol',state=p->>'state',last_seen_at=now() WHERE id=wid;
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF action='sources' THEN
  IF w.kind<>'geo' THEN RETURN jsonb_build_object('error','FORBIDDEN');END IF;
  RETURN jsonb_build_object('villages',coalesce((SELECT jsonb_agg(jsonb_build_object('localVillageId',m.local_village_id,'workerVillageId',m.worker_village_id)) FROM api_private.task_worker_villages m JOIN public.villages v ON v.id=m.local_village_id WHERE v.status='published'),'[]'));
 END IF;
 IF action='source-status' THEN
  IF w.kind<>'geo' THEN RETURN jsonb_build_object('error','FORBIDDEN');END IF;
  IF NOT EXISTS(SELECT 1 FROM api_private.task_worker_villages WHERE worker_village_id=p->>'villageId') THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
  INSERT INTO api_private.local_gpu_sources SELECT wid,local_village_id,(p->>'ready')::boolean,p->'bounds',p->>'errorCode',now() FROM api_private.task_worker_villages WHERE worker_village_id=p->>'villageId'
   ON CONFLICT(worker_id,local_village_id) DO UPDATE SET ready=excluded.ready,bounds=excluded.bounds,error_code=excluded.error_code,updated_at=now();
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF action='claim' THEN
  IF w.protocol IS DISTINCT FROM w.kind||'-aliyun-local-v1' OR w.last_seen_at IS NULL OR w.last_seen_at<now()-interval '2 minutes' THEN RETURN jsonb_build_object('error','WORKER_OFFLINE');END IF;
  SELECT * INTO receipt FROM api_private.local_gpu_claim_receipts WHERE worker_id=wid AND request_id=(p->>'requestId')::uuid;
  IF FOUND THEN
   SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=receipt.run_id;
   IF r.worker_id=wid AND r.lease_token=receipt.lease_token AND r.lease_until>now() AND r.status IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating','cancel_requested') THEN RETURN api_private.local_gpu_worker_view(r);END IF;
   RETURN jsonb_build_object('error','STALE_CLAIM');
  END IF;
  -- Bound reaping work. Never scan or consume the restored source queues.
  FOR r IN SELECT g.* FROM api_private.task_requests t JOIN api_private.local_gpu_runs g ON g.id=t.id WHERE t.instance_id=instance AND g.instance_id=instance AND g.kind=w.kind AND g.lease_until<=now() AND g.status IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating','cancel_requested') ORDER BY g.lease_until LIMIT 20 FOR UPDATE OF t SKIP LOCKED LOOP
   SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=r.id AND instance_id=instance AND kind=w.kind AND lease_until<=now() AND status IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating','cancel_requested') FOR UPDATE;
   IF NOT FOUND THEN CONTINUE;END IF;
   UPDATE api_private.local_gpu_runs SET status=CASE WHEN status='cancel_requested' THEN 'canceled' WHEN attempts>=5 THEN 'failed' WHEN phase='geo' THEN 'queued' WHEN phase='rectification' THEN 'queued_rectification' ELSE 'queued_generation' END,
     error_code=CASE WHEN attempts>=5 THEN 'LEASE_ATTEMPTS_EXHAUSTED' ELSE error_code END,progress=CASE WHEN phase='generation' THEN 40 ELSE 0 END,lease_until=NULL,worker_id=NULL,lease_token=NULL,next_at=now()+make_interval(secs=>least(30,power(2,attempts)::integer)),updated_at=now() WHERE id=r.id;
   PERFORM api_private.local_gpu_sync(r.id);
  END LOOP;
  IF EXISTS(SELECT 1 FROM api_private.local_gpu_runs WHERE worker_id=wid AND lease_until>now() AND status IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating','cancel_requested')) THEN RETURN jsonb_build_object('run',NULL,'busy',true);END IF;
  LOOP
   SELECT g.* INTO r FROM api_private.task_requests t JOIN api_private.local_gpu_runs g ON g.id=t.id WHERE t.instance_id=instance AND g.instance_id=instance AND g.kind=w.kind AND g.status IN('queued','queued_rectification','queued_generation') AND g.next_at<=now() AND g.attempts<5 ORDER BY g.next_at,g.created_at,g.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
   IF NOT FOUND THEN RETURN jsonb_build_object('run',NULL);END IF;
   SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=r.id AND instance_id=instance AND kind=w.kind AND status IN('queued','queued_rectification','queued_generation') AND next_at<=now() AND attempts<5 FOR UPDATE;
   IF NOT FOUND THEN CONTINUE;END IF;
   IF api_private.local_gpu_guard(r) THEN EXIT;END IF;
   UPDATE api_private.local_gpu_runs SET status='canceled',error_code='FORBIDDEN',updated_at=now() WHERE id=r.id;
   UPDATE api_private.task_requests SET state='revoked',error_code='FORBIDDEN',updated_at=now() WHERE id=r.id;
  END LOOP;
  UPDATE api_private.local_gpu_runs SET worker_id=wid,lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds',attempts=attempts+1,
    rectification_attempts=rectification_attempts+CASE WHEN phase='rectification' THEN 1 ELSE 0 END,generation_attempts=generation_attempts+CASE WHEN phase='generation' THEN 1 ELSE 0 END,
    status=CASE phase WHEN 'geo' THEN 'claimed' WHEN 'rectification' THEN 'claimed_rectification' ELSE 'claimed_generation' END,error_code=NULL,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  INSERT INTO api_private.local_gpu_claim_receipts(worker_id,request_id,run_id,lease_token) VALUES(wid,(p->>'requestId')::uuid,r.id,r.lease_token);
  PERFORM api_private.local_gpu_sync(r.id);RETURN api_private.local_gpu_worker_view(r);
 END IF;
 -- Match local_task_control: parent task before child run. Holding the run
 -- first while local_gpu_sync waits for the task can deadlock status polling.
 PERFORM 1 FROM api_private.task_requests WHERE id=rid AND instance_id=instance AND kind=w.kind FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;
 SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid AND instance_id=instance AND kind=w.kind FOR UPDATE;
 IF NOT FOUND OR r.worker_id IS DISTINCT FROM wid OR r.lease_token IS DISTINCT FROM token OR NOT api_private.local_gpu_guard(r) THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;
 IF action='complete' AND r.status='completed' OR action='publish-rectification' AND r.status='awaiting_crop' OR action='cancel' AND r.status='canceled' THEN RETURN jsonb_build_object('ok',true,'status',r.status);END IF;
 IF action IN('fail','retry-failure') AND r.status IN('failed','queued','queued_rectification','queued_generation') AND r.lease_until IS NULL AND r.error_code=p->>'errorCode' THEN RETURN jsonb_build_object('ok',true,'status',r.status);END IF;
 IF r.lease_until IS NULL OR r.lease_until<=now() OR r.status NOT IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating','cancel_requested') THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;
 IF action='cancel-status' THEN RETURN jsonb_build_object('cancelRequested',r.status='cancel_requested');END IF;
 IF action='renew' THEN
  UPDATE api_private.local_gpu_runs SET lease_until=now()+interval '120 seconds',updated_at=now() WHERE id=rid RETURNING * INTO r;
  RETURN jsonb_build_object('leaseUntil',r.lease_until,'cancelRequested',r.status='cancel_requested');
 ELSIF action='progress' THEN
  IF r.status='cancel_requested' THEN RETURN jsonb_build_object('cancelRequested',true);END IF;
  next_status:=CASE r.phase WHEN 'geo' THEN 'running' WHEN 'rectification' THEN 'rectifying' ELSE 'generating' END;
  IF p->>'state' IS DISTINCT FROM next_status THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  UPDATE api_private.local_gpu_runs SET status=next_status,stage=p->>'stage',progress=greatest(progress,(p->>'progress')::integer),updated_at=now() WHERE id=rid;
 ELSIF action IN('complete','publish-rectification') THEN
  IF r.status='cancel_requested' THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;
  IF (action='publish-rectification') IS DISTINCT FROM (r.phase='rectification') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF NOT api_private.local_gpu_outputs_ready(r) THEN RETURN jsonb_build_object('error','FILES_NOT_READY');END IF;
  UPDATE api_private.local_gpu_runs SET status=CASE WHEN action='publish-rectification' THEN 'awaiting_crop' ELSE 'completed' END,progress=CASE WHEN action='complete' THEN 100 ELSE 40 END,warnings=coalesce(p->'warnings','[]'),lease_until=NULL,
    rectification_token=CASE WHEN action='publish-rectification' THEN token ELSE rectification_token END,completion_token=CASE WHEN action='complete' THEN token ELSE completion_token END,updated_at=now() WHERE id=rid;
 ELSIF action IN('cancel','fail','retry-failure') THEN
  next_status:=CASE WHEN r.status='cancel_requested' OR action='cancel' THEN 'canceled' WHEN action='fail' OR r.attempts>=5 THEN 'failed' WHEN r.phase='geo' THEN 'queued' WHEN r.phase='rectification' THEN 'queued_rectification' ELSE 'queued_generation' END;
  UPDATE api_private.local_gpu_runs SET status=next_status,error_code=p->>'errorCode',progress=CASE WHEN next_status IN('queued','queued_rectification','queued_generation') THEN CASE WHEN phase='generation' THEN 40 ELSE 0 END ELSE progress END,lease_until=NULL,next_at=now()+make_interval(secs=>least(30,power(2,attempts)::integer)),updated_at=now() WHERE id=rid;
 ELSE RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM api_private.local_gpu_sync(rid);RETURN jsonb_build_object('ok',true,'status',(SELECT x.status FROM api_private.local_gpu_runs x WHERE id=rid));
END $$;

CREATE FUNCTION api_private.local_task_control(action text,instance text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE t api_private.task_requests;r api_private.local_gpu_runs;available boolean;busy boolean;village text;bound jsonb;expected text;BEGIN
 IF instance!~'^aliyun-[a-zA-Z0-9_-]{1,92}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF action='availability' THEN
  SELECT count(*)>0,bool_or(state='busy') INTO available,busy FROM api_private.local_gpu_workers
   WHERE instance_id=instance AND kind=CASE p->>'kind' WHEN 'geoprocessing' THEN 'geo' ELSE p->>'kind' END AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND last_seen_at>now()-interval '2 minutes' AND protocol=kind||'-aliyun-local-v1';
  RETURN jsonb_build_object('instanceId',instance,'data',jsonb_build_object('available',available,'compatible',available,'state',CASE WHEN NOT available THEN 'offline' WHEN busy THEN 'busy' ELSE 'available' END));
 END IF;
 IF action='sourceStatus' THEN
  SELECT jsonb_build_object('state',CASE WHEN bool_or(s.ready) THEN 'ready' ELSE 'missing' END,'ready',coalesce(bool_or(s.ready),false),'bounds',(jsonb_agg(s.bounds) FILTER(WHERE s.ready))->0) INTO bound FROM api_private.local_gpu_sources s JOIN api_private.task_worker_villages m ON m.local_village_id=s.local_village_id JOIN api_private.local_gpu_workers w ON w.id=s.worker_id
   WHERE m.worker_village_id=p->>'villageId' AND w.instance_id=instance AND w.revoked_at IS NULL AND w.last_seen_at>now()-interval '2 minutes' AND s.updated_at>now()-interval '5 minutes';
  RETURN jsonb_build_object('instanceId',instance,'data',bound);
 END IF;
 SELECT * INTO t FROM api_private.task_requests WHERE instance_id=instance AND owner_id=(p->>'ownerId')::uuid AND request_id=(p->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
 PERFORM set_config('request.jwt.claim.sub',t.owner_id::text,true);PERFORM api_private.task_guard(t);
 SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=t.id FOR UPDATE;
 IF action='enqueue' THEN
  expected:=encode(sha256(convert_to(jsonb_build_object('kind',t.kind,'input',t.input,'photo',p->'photo')::text,'UTF8')),'hex');
  IF FOUND THEN
   IF r.input_digest<>expected THEN RETURN jsonb_build_object('error','REVISION_CONFLICT');END IF;
  ELSE
   IF (SELECT count(*) FROM api_private.local_gpu_runs WHERE instance_id=instance AND owner_id=t.owner_id AND kind=t.kind AND status NOT IN('failed','canceled','completed'))>=2 THEN RETURN jsonb_build_object('error','TOO_MANY_ACTIVE_RUNS');END IF;
   IF t.kind IN('facade','cloud-facade') THEN
    IF p->'photo'->>'fileId' IS DISTINCT FROM (SELECT file_id::text FROM public.object_photos WHERE id=t.photo_id)
       OR p->'photo'->>'sha256'!~'^[a-f0-9]{64}$' OR (p->'photo'->>'size')::bigint NOT BETWEEN 1 AND 10485760
       OR p->'photo'->>'mime' NOT IN('image/jpeg','image/png') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
   END IF;
   INSERT INTO api_private.local_gpu_runs(id,instance_id,owner_id,kind,input,input_digest,photo_snapshot,phase,status)
    VALUES(t.id,instance,t.owner_id,t.kind,t.input,expected,p->'photo',CASE t.kind WHEN 'geo' THEN 'geo' WHEN 'cloud-facade' THEN 'cloud' ELSE 'rectification' END,CASE WHEN t.kind='facade' THEN 'queued_rectification' ELSE 'queued' END) RETURNING * INTO r;
   PERFORM api_private.local_gpu_sync(r.id);
  END IF;
  RETURN jsonb_build_object('instanceId',instance,'runId',r.id);
 END IF;
 IF r.id IS NULL THEN RETURN jsonb_build_object('error','SOURCE_NOT_READY');END IF;
 IF action='cancel' THEN
  IF r.status NOT IN('completed','failed','canceled') THEN
   UPDATE api_private.local_gpu_runs SET status=CASE WHEN lease_until>now() THEN 'cancel_requested' ELSE 'canceled' END,updated_at=now() WHERE id=r.id RETURNING * INTO r;PERFORM api_private.local_gpu_sync(r.id);
  END IF;
  RETURN jsonb_build_object('instanceId',instance,'canceled',true);
 ELSIF action='retry' THEN
  IF r.kind='cloud-facade' THEN RETURN jsonb_build_object('error','SOURCE_NOT_READY');END IF;
  IF r.status='failed' AND r.attempts<5 THEN
   UPDATE api_private.local_gpu_runs SET status=CASE phase WHEN 'geo' THEN 'queued' WHEN 'rectification' THEN 'queued_rectification' ELSE 'queued_generation' END,lease_until=NULL,worker_id=NULL,lease_token=NULL,error_code=NULL,next_at=now(),updated_at=now() WHERE id=r.id RETURNING * INTO r;PERFORM api_private.local_gpu_sync(r.id);
  END IF;
 ELSIF action='confirmCrop' THEN
  IF r.kind<>'facade' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  bound:=p-'ownerId'-'requestId';
  IF r.status='awaiting_crop' THEN
   IF (bound->>'cropTop')::numeric NOT BETWEEN 0 AND 0.65 OR bound->>'roofType' NOT IN('hip','gable','flat') OR (bound->>'buildingWidth')::numeric NOT BETWEEN 0.01 AND 500 OR (bound->>'buildingDepth')::numeric NOT BETWEEN 0.01 AND 500 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
   UPDATE api_private.local_gpu_runs SET crop=bound,phase='generation',status='queued_generation',generation_revision=generation_revision+1,worker_id=NULL,lease_token=NULL,lease_until=NULL,next_at=now(),updated_at=now() WHERE id=r.id RETURNING * INTO r;PERFORM api_private.local_gpu_sync(r.id);
  ELSIF r.crop IS DISTINCT FROM bound THEN RETURN jsonb_build_object('error','REVISION_CONFLICT');END IF;
 ELSIF action='artifacts' THEN
  RETURN jsonb_build_object('instanceId',instance,'artifacts',coalesce((SELECT jsonb_agg(jsonb_build_object('artifact_type',o.artifact_type,'sha256',o.sha256,'size',o.size,'mime',o.mime,'generation_revision',o.revision)) FROM api_private.local_gpu_outputs o WHERE o.run_id=r.id AND o.state='ready' AND ((o.phase='rectification' AND o.lease_token=r.rectification_token) OR (o.phase=r.phase AND o.revision=r.generation_revision AND o.lease_token=r.completion_token))),'[]'));
 ELSIF action<>'status' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 RETURN jsonb_build_object('instanceId',instance,'runId',r.id,'kind',r.kind,'run',api_private.local_gpu_public(r));
END $$;
REVOKE ALL ON FUNCTION api_private.local_gpu_guard(api_private.local_gpu_runs),api_private.local_gpu_sync(uuid),api_private.local_gpu_public(api_private.local_gpu_runs),api_private.local_gpu_worker_view(api_private.local_gpu_runs),api_private.local_gpu_outputs_ready(api_private.local_gpu_runs),api_private.local_worker_auth(uuid,text,text),api_private.local_worker_call(uuid,text,text,text,uuid,uuid,jsonb),api_private.local_task_control(text,text,jsonb) FROM PUBLIC,anon,authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.local_worker_auth(uuid,text,text),api_private.local_worker_call(uuid,text,text,text,uuid,uuid,jsonb),api_private.local_task_control(text,text,jsonb) TO village_unified_login;
COMMIT;
