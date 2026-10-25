-- Generated from the matching schema sources; no table/data recreation.
BEGIN;
DO $$ BEGIN
 IF to_regclass('api_private.local_gpu_runs') IS NULL OR to_regclass('api_private.local_gpu_uploads') IS NULL
 THEN RAISE EXCEPTION 'EXISTING_ALIYUN_LOCAL_QUEUE_REQUIRED'; END IF;
END $$;
CREATE OR REPLACE FUNCTION api_private.task_public(t api_private.task_requests) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT t.remote_info||jsonb_build_object('requestId',t.request_id,'state',t.state,'sourceRunId',t.source_run_id,'kind',t.kind,'status',coalesce(t.remote_status,t.state),'progress',t.progress,'errorCode',t.error_code,'importedBundle',t.imported_bundle,'context',t.context,'photoId',t.photo_id,'generation_method',coalesce(t.input->>'generationMethod','texture'),'model_purpose',coalesce(t.input->>'modelPurpose','existing'),'building_width',coalesce((t.remote_info->>'building_width')::numeric,(t.input->>'buildingWidth')::numeric),'building_depth',coalesce((t.remote_info->>'building_depth')::numeric,(t.input->>'buildingDepth')::numeric),'objectCode',t.input->>'objectCode','createdAt',t.created_at,'updatedAt',t.updated_at)
$$;

CREATE OR REPLACE FUNCTION api_private.task_artifact_manage(oid uuid,token uuid,action text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,api_private,pg_temp AS $$DECLARE t api_private.task_requests;a api_private.task_artifacts;k text:=p->>'artifactType';layer text;BEGIN
 t:=api_private.task_outbox_guard(oid,token);
 SELECT * INTO a FROM api_private.task_artifacts WHERE task_id=t.id AND artifact_type=k AND sha256=p->>'sha256';
 IF action='lookup' THEN RETURN to_jsonb(a);END IF;
 layer:=CASE k WHEN 'buildings' THEN 'building' WHEN 'roads' THEN 'road' WHEN 'waterways' THEN 'water' WHEN 'water_areas' THEN 'water' WHEN 'contours' THEN 'contours' END;
 IF action='reserve' THEN
  IF NOT coalesce(p->>'sha256'~'^[a-f0-9]{64}$' AND p->>'size'~'^[0-9]{1,9}$' AND (p->>'size')::bigint BETWEEN 1 AND CASE WHEN t.kind='geo' AND to_regclass('api_private.local_gpu_uploads') IS NOT NULL THEN 536870912 ELSE 52428800 END,false) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF t.kind='geo' THEN IF layer IS NULL OR p->>'mime'<>'application/geo+json' OR p->>'extension'<>'geojson' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  ELSIF k='model_manifest' THEN IF p->>'mime'<>'application/json' OR p->>'extension'<>'json' OR (p->>'size')::bigint>2097152 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
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

CREATE OR REPLACE FUNCTION api_private.task_finish(oid uuid,token uuid,result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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
   remote_info=coalesce((SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(result->'run') e WHERE e.key IN('generation_revision','crop_top','roof_type','building_width','building_depth','attempt_count','rectification_attempt_count','generation_attempt_count','generation_method','model_purpose','component_floors','component_roofs')),'{}'),
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

CREATE OR REPLACE FUNCTION api_private.local_gpu_sync(rid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,api_private,pg_temp
AS $$ DECLARE r api_private.local_gpu_runs;s text;info jsonb;BEGIN
 SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid;
 s:=CASE WHEN r.status='completed' THEN 'completed' WHEN r.status IN('failed','canceled') THEN r.status WHEN r.status IN('queued','queued_rectification','queued_generation') THEN 'queued' ELSE 'running' END;
 info:=jsonb_build_object('generation_revision',r.generation_revision,'crop_top',r.crop->'cropTop','roof_type',r.crop->'roofType','building_width',r.crop->'buildingWidth','building_depth',r.crop->'buildingDepth','component_floors',r.crop->'floors','component_roofs',r.crop->'roofCount','generation_method',coalesce(r.input->>'generationMethod','texture'),'model_purpose',coalesce(r.input->>'modelPurpose','existing'),'attempt_count',r.attempts,'rectification_attempt_count',r.rectification_attempts,'generation_attempt_count',r.generation_attempts);
 UPDATE api_private.task_requests SET source_run_id=r.id,state=s,remote_status=r.status,progress=r.progress,error_code=r.error_code,remote_info=info,updated_at=now()
 WHERE id=r.id AND state<>'revoked' AND (source_run_id,state,remote_status,progress,error_code,remote_info) IS DISTINCT FROM (r.id,s,r.status,r.progress,r.error_code,info);
END $$;

CREATE OR REPLACE FUNCTION api_private.local_gpu_public(r api_private.local_gpu_runs) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('id',r.id,'status',r.status,'progress',r.progress,'stage',r.stage,'error_code',r.error_code,'generation_revision',r.generation_revision,'crop_top',r.crop->'cropTop','roof_type',r.crop->'roofType','building_width',r.crop->'buildingWidth','building_depth',r.crop->'buildingDepth','component_floors',r.crop->'floors','component_roofs',r.crop->'roofCount','generation_method',coalesce(r.input->>'generationMethod','texture'),'model_purpose',coalesce(r.input->>'modelPurpose','existing'),'attempt_count',r.attempts,'rectification_attempt_count',r.rectification_attempts,'generation_attempt_count',r.generation_attempts) $$;

CREATE OR REPLACE FUNCTION api_private.local_worker_call(wid uuid,digest text,instance text,action text,rid uuid,token uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE w api_private.local_gpu_workers;r api_private.local_gpu_runs;receipt api_private.local_gpu_claim_receipts;next_status text;BEGIN
 SELECT * INTO w FROM api_private.local_gpu_workers WHERE id=wid AND token_digest=digest AND instance_id=instance AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','UNAUTHORIZED');END IF;
 IF action='heartbeat' THEN
  IF (p->>'protocol' IS DISTINCT FROM w.kind||'-aliyun-local-v1' AND NOT (w.kind='facade' AND p->>'protocol'='facade-aliyun-local-v2')) OR p->>'state' NOT IN('idle','busy','error','starting') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
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
  IF (w.protocol IS DISTINCT FROM w.kind||'-aliyun-local-v1' AND NOT (w.kind='facade' AND w.protocol='facade-aliyun-local-v2')) OR w.last_seen_at IS NULL OR w.last_seen_at<now()-interval '2 minutes' THEN RETURN jsonb_build_object('error','WORKER_OFFLINE');END IF;
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
   SELECT g.* INTO r FROM api_private.task_requests t JOIN api_private.local_gpu_runs g ON g.id=t.id WHERE t.instance_id=instance AND g.instance_id=instance AND g.kind=w.kind AND (coalesce(g.input->>'generationMethod','texture')<>'components' OR w.protocol='facade-aliyun-local-v2') AND g.status IN('queued','queued_rectification','queued_generation') AND g.next_at<=now() AND g.attempts<5 ORDER BY g.next_at,g.created_at,g.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
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

CREATE OR REPLACE FUNCTION api_private.local_task_control(action text,instance text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE t api_private.task_requests;r api_private.local_gpu_runs;available boolean;busy boolean;village text;bound jsonb;expected text;BEGIN
 IF instance!~'^aliyun-[a-zA-Z0-9_-]{1,92}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF action='availability' THEN
  SELECT count(*)>0,bool_or(state='busy') INTO available,busy FROM api_private.local_gpu_workers
   WHERE instance_id=instance AND kind=CASE p->>'kind' WHEN 'geoprocessing' THEN 'geo' ELSE p->>'kind' END AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND last_seen_at>now()-interval '2 minutes' AND (protocol=kind||'-aliyun-local-v1' OR (kind='facade' AND protocol='facade-aliyun-local-v2'));
  RETURN jsonb_build_object('instanceId',instance,'data',jsonb_build_object('available',available,'compatible',available,'componentAvailable',EXISTS(SELECT 1 FROM api_private.local_gpu_workers WHERE instance_id=instance AND kind='facade' AND protocol='facade-aliyun-local-v2' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND last_seen_at>now()-interval '2 minutes'),'state',CASE WHEN NOT available THEN 'offline' WHEN busy THEN 'busy' ELSE 'available' END));
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
   IF r.input->>'generationMethod'='components' AND coalesce(r.input->>'modelPurpose','existing')='existing' AND ((bound->>'buildingWidth')::numeric IS DISTINCT FROM (r.input->>'buildingWidth')::numeric OR (bound->>'buildingDepth')::numeric IS DISTINCT FROM (r.input->>'buildingDepth')::numeric) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
   IF (bound->>'cropTop')::numeric NOT BETWEEN 0 AND 0.65 OR bound->>'roofType' NOT IN('hip','gable','flat') OR (bound->>'buildingWidth')::numeric NOT BETWEEN 0.01 AND 500 OR (bound->>'buildingDepth')::numeric NOT BETWEEN 0.01 AND 500 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
   UPDATE api_private.local_gpu_runs SET crop=bound,phase='generation',status='queued_generation',generation_revision=generation_revision+1,worker_id=NULL,lease_token=NULL,lease_until=NULL,next_at=now(),updated_at=now() WHERE id=r.id RETURNING * INTO r;PERFORM api_private.local_gpu_sync(r.id);
  ELSIF r.crop IS DISTINCT FROM bound THEN RETURN jsonb_build_object('error','REVISION_CONFLICT');END IF;
 ELSIF action='artifacts' THEN
  RETURN jsonb_build_object('instanceId',instance,'artifacts',coalesce((SELECT jsonb_agg(jsonb_build_object('artifact_type',o.artifact_type,'sha256',o.sha256,'size',o.size,'mime',o.mime,'generation_revision',o.revision)) FROM api_private.local_gpu_outputs o WHERE o.run_id=r.id AND o.state='ready' AND ((o.phase='rectification' AND o.lease_token=r.rectification_token) OR (o.phase=r.phase AND o.revision=r.generation_revision AND o.lease_token=r.completion_token))),'[]'));
 ELSIF action<>'status' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 RETURN jsonb_build_object('instanceId',instance,'runId',r.id,'kind',r.kind,'run',api_private.local_gpu_public(r));
END $$;

CREATE OR REPLACE FUNCTION api_private.local_worker_file(wid uuid,digest text,instance text,action text,rid uuid,token uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE w api_private.local_gpu_workers;r api_private.local_gpu_runs;u api_private.local_gpu_uploads;o api_private.local_gpu_outputs;
 part jsonb;n integer;sz bigint;lim bigint;total bigint;k text;fid uuid;BEGIN
 -- Same lock order as queue control. Credential revocation and lease changes
 -- cannot race the metadata publication transaction.
 SELECT * INTO w FROM api_private.local_gpu_workers WHERE id=wid AND token_digest=digest AND instance_id=instance AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','UNAUTHORIZED');END IF;
 PERFORM 1 FROM api_private.task_requests WHERE id=rid AND instance_id=instance AND kind=w.kind FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;
 SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid AND instance_id=instance FOR UPDATE;
 IF NOT FOUND OR r.worker_id IS DISTINCT FROM wid OR r.lease_token IS DISTINCT FROM token OR r.lease_until IS NULL OR r.lease_until<=now()
  OR r.status NOT IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating') OR r.kind<>w.kind
  OR NOT api_private.local_gpu_guard(r) THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;
 IF action='context' THEN RETURN jsonb_build_object('kind',r.kind,'phase',r.phase);END IF;
 IF action='input' THEN
  IF r.kind<>'facade' OR r.photo_snapshot IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
  RETURN r.photo_snapshot||jsonb_build_object('requestId',(SELECT request_id FROM api_private.task_requests WHERE id=rid),'ownerId',r.owner_id);
 END IF;
 IF action='artifact' THEN
  IF r.kind<>'facade' OR r.phase<>'generation' OR p->>'artifactType' NOT IN('rectified_preview','rectified_source','building_mask') THEN RETURN jsonb_build_object('error','FORBIDDEN');END IF;
  SELECT * INTO o FROM api_private.local_gpu_outputs WHERE run_id=rid AND phase='rectification' AND lease_token=r.rectification_token AND artifact_type=p->>'artifactType' AND state='ready';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
  RETURN jsonb_build_object('fileId',o.file_id,'size',o.size,'sha256',o.sha256,'mime',o.mime);
 END IF;
 IF action='begin' THEN
  k:=p->>'artifactType';
  IF r.kind='geo' AND r.phase='geo' AND k IN('buildings','roads','waterways','water_areas','contours') AND p->>'mime'='application/geo+json' AND p->>'extension'='geojson' THEN
   IF NOT (r.input->'requestedSteps' ? CASE WHEN k IN('roads','waterways','water_areas') THEN 'roads_water' ELSE k END) THEN RETURN jsonb_build_object('error','FORBIDDEN');END IF;lim:=536870912;
  ELSIF r.kind='facade' AND r.phase='rectification' AND k='diagnostics' AND p->>'mime'='application/json' AND p->>'extension'='json' THEN lim:=2097152;
  ELSIF r.kind='facade' AND r.phase='rectification' AND k IN('rectified_preview','rectified_source','building_mask') AND ((p->>'mime'='image/png' AND p->>'extension'='png') OR (p->>'mime'='image/jpeg' AND p->>'extension' IN('jpg','jpeg'))) THEN lim:=10485760;
  ELSIF r.kind='facade' AND r.phase='generation' AND k='model_manifest' AND p->>'mime'='application/json' AND p->>'extension'='json' THEN lim:=2097152;
  ELSIF r.kind='facade' AND r.phase='generation' AND k='building_glb' AND p->>'mime'='model/gltf-binary' AND p->>'extension'='glb' THEN lim:=52428800;
  ELSE RETURN jsonb_build_object('error','FILE_TYPE_UNSUPPORTED');END IF;
  IF NOT coalesce(p->>'size'~'^[0-9]{1,9}$' AND p->>'sha256'~'^[a-f0-9]{64}$',false) THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
  sz:=(p->>'size')::bigint;IF sz<1 OR sz>lim THEN RETURN jsonb_build_object('error','FILE_TOO_LARGE');END IF;
  IF EXISTS(SELECT 1 FROM api_private.local_gpu_outputs WHERE run_id=rid AND phase=r.phase AND revision=r.generation_revision AND artifact_type=p->>'artifactType' AND lease_token=token AND state='ready' AND sha256<>p->>'sha256') THEN RETURN jsonb_build_object('error','UPLOAD_CONFLICT');END IF;
  -- Independent deterministic identity check, matching taskFileId().
  k:=encode(sha256(convert_to(instance||'/'||rid::text||'/'||(p->>'artifactType')||'/'||(p->>'sha256'),'UTF8')),'hex');
  fid:=(substr(k,1,8)||'-'||substr(k,9,4)||'-4'||substr(k,14,3)||'-8'||substr(k,18,3)||'-'||substr(k,21,12))::uuid;
  IF fid IS DISTINCT FROM (p->>'fileId')::uuid THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
  SELECT * INTO u FROM api_private.local_gpu_uploads WHERE worker_id=wid AND request_id=(p->>'requestId')::uuid;
  IF FOUND THEN
   IF (u.run_id,u.lease_token,u.phase,u.revision,u.artifact_type,u.file_id,u.size,u.sha256,u.mime,u.extension) IS DISTINCT FROM
    (rid,token,r.phase,r.generation_revision,p->>'artifactType',fid,sz,p->>'sha256',p->>'mime',p->>'extension') THEN RETURN jsonb_build_object('error','UPLOAD_CONFLICT');END IF;
   RETURN api_private.local_gpu_upload_view(u,r);
  END IF;
  IF (SELECT count(*) FROM api_private.local_gpu_uploads WHERE worker_id=wid AND state='pending' AND lease_token=token)>=8 THEN RETURN jsonb_build_object('error','FILE_BUSY');END IF;
  INSERT INTO api_private.local_gpu_uploads(worker_id,request_id,run_id,lease_token,phase,revision,artifact_type,file_id,size,sha256,mime,extension)
   VALUES(wid,(p->>'requestId')::uuid,rid,token,r.phase,r.generation_revision,p->>'artifactType',fid,sz,p->>'sha256',p->>'mime',p->>'extension') RETURNING * INTO u;
  RETURN api_private.local_gpu_upload_view(u,r);
 END IF;
 SELECT * INTO u FROM api_private.local_gpu_uploads WHERE id=(p->>'uploadId')::uuid AND worker_id=wid AND run_id=rid AND lease_token=token AND phase=r.phase AND revision=r.generation_revision FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
 IF action='status' THEN RETURN api_private.local_gpu_upload_view(u,r);END IF;
 IF action='abort' THEN
  IF u.state='ready' THEN RETURN jsonb_build_object('error','UPLOAD_CONFLICT');END IF;
  UPDATE api_private.local_gpu_uploads SET state='aborted',updated_at=now() WHERE id=u.id RETURNING * INTO u;RETURN api_private.local_gpu_upload_view(u,r);
 END IF;
 IF u.state='aborted' THEN RETURN jsonb_build_object('error','UPLOAD_EXPIRED');END IF;
 IF action IN('chunk-check','chunk') THEN
  IF NOT coalesce(p->>'index'~'^[0-9]{1,2}$' AND p->>'size'~'^[0-9]{1,7}$' AND p->>'sha256'~'^[a-f0-9]{64}$',false) THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
  n:=(p->>'index')::integer;sz:=(p->>'size')::bigint;total:=jsonb_array_length(u.chunks);part:=jsonb_build_object('index',n,'size',sz,'sha256',p->>'sha256');
  IF n<0 OR n>63 OR sz<1 OR sz>8388608 OR n>total THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
  IF n<total THEN
   IF u.chunks->n IS DISTINCT FROM part THEN RETURN jsonb_build_object('error','UPLOAD_CONFLICT');END IF;
  ELSIF u.state<>'pending' OR u.offset_bytes+sz>u.size OR (u.offset_bytes+sz<u.size AND sz<>8388608) THEN RETURN jsonb_build_object('error','INVALID_INPUT');
  ELSIF action='chunk' THEN UPDATE api_private.local_gpu_uploads SET chunks=chunks||jsonb_build_array(part),offset_bytes=offset_bytes+sz,updated_at=now() WHERE id=u.id RETURNING * INTO u;
  END IF;
  RETURN api_private.local_gpu_upload_view(u,r);
 END IF;
 IF action='commit' THEN
  IF u.state='ready' THEN RETURN api_private.local_gpu_upload_view(u,r);END IF;
  IF u.offset_bytes<>u.size THEN RETURN jsonb_build_object('error','FILES_NOT_READY');END IF;
  IF u.extension='geojson' AND NOT coalesce(p->'validation'->>'featureCount'~'^[0-9]{1,7}$',false) THEN RETURN jsonb_build_object('error','INVALID_FILE');END IF;
  IF EXISTS(SELECT 1 FROM api_private.local_gpu_outputs WHERE run_id=rid AND phase=u.phase AND revision=u.revision AND artifact_type=u.artifact_type AND lease_token=token AND state='ready' AND sha256<>u.sha256) THEN RETURN jsonb_build_object('error','UPLOAD_CONFLICT');END IF;
  INSERT INTO api_private.local_gpu_outputs(run_id,phase,revision,artifact_type,file_id,sha256,size,mime,extension,state,lease_token,validation)
   VALUES(rid,u.phase,u.revision,u.artifact_type,u.file_id,u.sha256,u.size,u.mime,u.extension,'ready',token,p->'validation')
   ON CONFLICT(run_id,phase,revision,artifact_type,sha256) DO UPDATE SET lease_token=excluded.lease_token,state='ready',validation=excluded.validation;
  UPDATE api_private.local_gpu_uploads SET state='ready',updated_at=now() WHERE id=u.id RETURNING * INTO u;
  RETURN api_private.local_gpu_upload_view(u,r);
 END IF;
 RETURN jsonb_build_object('error','INVALID_INPUT');
END $$;
COMMIT;
