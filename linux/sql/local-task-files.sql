-- Lease-authorized private upload receipts. No file bytes or Worker secrets in SQL.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'village_unified_candidate' OR to_regclass('api_private.local_gpu_runs') IS NULL
  OR to_regclass('api_private.local_gpu_uploads') IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_TASK_FILES_FRESH_TARGET_REQUIRED';END IF;
END $$;
CREATE TABLE api_private.local_gpu_uploads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),worker_id uuid NOT NULL REFERENCES api_private.local_gpu_workers,
 request_id uuid NOT NULL,run_id uuid NOT NULL REFERENCES api_private.local_gpu_runs,lease_token uuid NOT NULL,
 phase text NOT NULL,revision integer NOT NULL,artifact_type text NOT NULL,file_id uuid NOT NULL,
 size bigint NOT NULL CHECK(size BETWEEN 1 AND 536870912),sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),mime text NOT NULL,extension text NOT NULL,
 chunks jsonb NOT NULL DEFAULT '[]',offset_bytes bigint NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','ready','aborted')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(worker_id,request_id),
 CHECK(offset_bytes BETWEEN 0 AND size),CHECK(jsonb_array_length(chunks)<=64)
);
REVOKE ALL ON api_private.local_gpu_uploads FROM PUBLIC,anon,authenticated,village_unified_login;
ALTER TABLE api_private.local_gpu_outputs DROP CONSTRAINT local_gpu_outputs_file_id_key;
ALTER TABLE api_private.task_artifacts DROP CONSTRAINT task_artifacts_size_check;
ALTER TABLE api_private.task_artifacts ADD CHECK(size BETWEEN 1 AND 536870912);
CREATE FUNCTION api_private.local_gpu_upload_view(u api_private.local_gpu_uploads,r api_private.local_gpu_runs) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('uploadId',u.id,'fileId',u.file_id,'artifactType',u.artifact_type,'kind',r.kind,'phase',u.phase,'size',u.size,'sha256',u.sha256,'mime',u.mime,'extension',u.extension,'chunks',u.chunks,'offset',u.offset_bytes,'state',u.state) $$;
CREATE FUNCTION api_private.local_task_files_version() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT '{"schemaVersion":1}'::jsonb $$;
REVOKE ALL ON FUNCTION api_private.local_task_files_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION api_private.local_task_files_version() TO village_unified_login;

CREATE FUNCTION api_private.local_worker_file(wid uuid,digest text,instance text,action text,rid uuid,token uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE w api_private.local_gpu_workers;r api_private.local_gpu_runs;u api_private.local_gpu_uploads;o api_private.local_gpu_outputs;
 part jsonb;n integer;sz bigint;lim bigint;total bigint;k text;fid uuid;BEGIN
 -- Same lock order as queue control. Credential revocation and lease changes
 -- cannot race the metadata publication transaction.
 SELECT * INTO w FROM api_private.local_gpu_workers WHERE id=wid AND token_digest=digest AND instance_id=instance AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','UNAUTHORIZED');END IF;
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
   IF NOT (r.input->'requestedSteps' ? CASE WHEN k IN('waterways','water_areas') THEN 'water' ELSE k END) THEN RETURN jsonb_build_object('error','FORBIDDEN');END IF;lim:=536870912;
  ELSIF r.kind='facade' AND r.phase='rectification' AND k='diagnostics' AND p->>'mime'='application/json' AND p->>'extension'='json' THEN lim:=2097152;
  ELSIF r.kind='facade' AND r.phase='rectification' AND k IN('rectified_preview','rectified_source','building_mask') AND ((p->>'mime'='image/png' AND p->>'extension'='png') OR (p->>'mime'='image/jpeg' AND p->>'extension' IN('jpg','jpeg'))) THEN lim:=10485760;
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

-- Trusted outbox only; this repeats owner/context checks and exposes only the
-- outputs approved by this run's completed lease, never a stale upload attempt.
CREATE FUNCTION api_private.local_task_artifact(owner uuid,rid uuid,instance text,kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE r api_private.local_gpu_runs;o api_private.local_gpu_outputs;BEGIN
 SELECT g.* INTO r FROM api_private.local_gpu_runs g JOIN api_private.task_requests t ON t.id=g.id WHERE t.request_id=rid AND g.instance_id=instance AND g.owner_id=owner;
 IF NOT FOUND OR NOT api_private.local_gpu_guard(r) THEN RETURN jsonb_build_object('error','FORBIDDEN');END IF;
 SELECT * INTO o FROM api_private.local_gpu_outputs WHERE run_id=r.id AND artifact_type=kind AND state='ready'
  AND ((phase='rectification' AND lease_token=r.rectification_token) OR (phase=r.phase AND revision=r.generation_revision AND lease_token=r.completion_token));
 IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
 RETURN jsonb_build_object('fileId',o.file_id,'size',o.size,'sha256',o.sha256,'mime',o.mime);
END $$;
REVOKE ALL ON FUNCTION api_private.local_gpu_upload_view(api_private.local_gpu_uploads,api_private.local_gpu_runs),api_private.local_worker_file(uuid,text,text,text,uuid,uuid,jsonb),api_private.local_task_artifact(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.local_worker_file(uuid,text,text,text,uuid,uuid,jsonb),api_private.local_task_artifact(uuid,uuid,text,text) TO village_unified_login;
COMMIT;
