-- Optional provider jobs share the local ownership domain. Disabled by default
-- in the server; copied source/provider jobs are not consumed by this table.
BEGIN;
DO $$BEGIN IF current_database()<>'village_unified_candidate' OR to_regclass('api_private.local_gpu_uploads') IS NULL OR to_regclass('api_private.local_cloud_jobs') IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_CLOUD_FRESH_TARGET_REQUIRED';END IF;END $$;
CREATE TABLE api_private.local_cloud_jobs(
 run_id uuid PRIMARY KEY REFERENCES api_private.local_gpu_runs,
 state text NOT NULL CHECK(state IN('preparing','submitting','unknown','accepted','polling','completed','failed')),
 provider_id text CHECK(provider_id~'^[a-zA-Z0-9_-]{1,200}$'),lease uuid,lease_until timestamptz,next_at timestamptz NOT NULL DEFAULT now(),
 deadline timestamptz NOT NULL DEFAULT now()+interval '30 minutes',poll_errors integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE api_private.local_cloud_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,run_id uuid NOT NULL REFERENCES api_private.local_gpu_runs,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON api_private.local_cloud_jobs,api_private.local_cloud_audit FROM PUBLIC,anon,authenticated,village_unified_login;
CREATE FUNCTION api_private.local_cloud_call(actor uuid,rid uuid,instance text,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE r api_private.local_gpu_runs;j api_private.local_cloud_jobs;a jsonb;fid uuid;k text;BEGIN
 IF action='version' THEN RETURN '{"schemaVersion":1}'::jsonb;END IF;
 SELECT g.* INTO r FROM api_private.local_gpu_runs g JOIN api_private.task_requests t ON t.id=g.id WHERE t.request_id=rid AND g.owner_id=actor AND g.instance_id=instance AND g.kind='cloud-facade' FOR UPDATE;
 IF NOT FOUND OR NOT api_private.local_gpu_guard(r) THEN RETURN jsonb_build_object('error','FORBIDDEN');END IF;
 SELECT * INTO j FROM api_private.local_cloud_jobs WHERE run_id=r.id FOR UPDATE;
 IF action='reconcile' THEN
  -- Owner-only private operator operation. Ordinary API login cannot use it.
  IF session_user<>current_user OR j.state IS DISTINCT FROM 'unknown' OR NOT coalesce(p->>'jobId'~'^[a-zA-Z0-9_-]{1,200}$',false) THEN RETURN jsonb_build_object('error','FORBIDDEN');END IF;
  UPDATE api_private.local_cloud_jobs SET state='accepted',provider_id=p->>'jobId',lease=NULL,lease_until=NULL,next_at=now(),deadline=now()+interval '30 minutes',updated_at=now() WHERE run_id=r.id;
  IF r.status<>'canceled' THEN
   UPDATE api_private.local_gpu_runs SET status='running',error_code=NULL,updated_at=now() WHERE id=r.id;PERFORM api_private.local_gpu_sync(r.id);
   INSERT INTO api_private.task_outbox(task_id,operation,next_at) VALUES(r.id,'poll',now()) ON CONFLICT(task_id,operation) DO UPDATE SET done=false,lease=NULL,lease_until=NULL,next_at=excluded.next_at;
  END IF;
  INSERT INTO api_private.local_cloud_audit(run_id,action) VALUES(r.id,'owner_reconciled_provider_id');RETURN jsonb_build_object('ok',true);
 END IF;
 IF r.status='canceled' THEN RETURN jsonb_build_object('operation','canceled');END IF;
 IF action='claim' THEN
  IF j.run_id IS NULL THEN
   INSERT INTO api_private.local_cloud_jobs(run_id,state,lease,lease_until) VALUES(r.id,'preparing',gen_random_uuid(),now()+interval '120 seconds') RETURNING * INTO j;
  ELSIF j.state IN('unknown','completed','failed') THEN RETURN jsonb_build_object('operation',CASE j.state WHEN 'completed' THEN 'complete' ELSE j.state END);
  ELSIF j.state='submitting' THEN
   IF j.lease_until>now() THEN RETURN jsonb_build_object('operation','wait');END IF;
   UPDATE api_private.local_cloud_jobs SET state='unknown',lease=NULL,lease_until=NULL,updated_at=now() WHERE run_id=r.id;
   UPDATE api_private.local_gpu_runs SET status='failed',error_code='PROVIDER_SUBMISSION_UNKNOWN',updated_at=now() WHERE id=r.id;PERFORM api_private.local_gpu_sync(r.id);
   INSERT INTO api_private.local_cloud_audit(run_id,action) VALUES(r.id,'submission_ack_unknown');RETURN jsonb_build_object('operation','unknown');
  ELSIF j.lease_until>now() OR j.next_at>now() THEN RETURN jsonb_build_object('operation','wait');
  ELSIF j.deadline<=now() THEN
   UPDATE api_private.local_cloud_jobs SET state='failed',lease=NULL,lease_until=NULL,updated_at=now() WHERE run_id=r.id;
   UPDATE api_private.local_gpu_runs SET status='failed',error_code='PROVIDER_TIMEOUT',updated_at=now() WHERE id=r.id;PERFORM api_private.local_gpu_sync(r.id);RETURN jsonb_build_object('operation','failed');
  ELSE
   UPDATE api_private.local_cloud_jobs SET state=CASE WHEN provider_id IS NULL THEN 'preparing' ELSE 'polling' END,lease=gen_random_uuid(),lease_until=now()+interval '120 seconds',updated_at=now() WHERE run_id=r.id RETURNING * INTO j;
  END IF;
  RETURN jsonb_build_object('operation',CASE WHEN j.provider_id IS NULL THEN 'submit' ELSE 'poll' END,'runId',r.id,'lease',j.lease,'jobId',j.provider_id,'photo',r.photo_snapshot);
 END IF;
 IF j.lease IS DISTINCT FROM (p->>'lease')::uuid OR j.lease_until IS NULL OR j.lease_until<=now() THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;
 IF action='intent' THEN
  IF j.state<>'preparing' THEN RETURN jsonb_build_object('error','REVISION_CONFLICT');END IF;
  UPDATE api_private.local_cloud_jobs SET state='submitting',updated_at=now() WHERE run_id=r.id;
  UPDATE api_private.local_gpu_runs SET status='running',progress=5,updated_at=now() WHERE id=r.id;PERFORM api_private.local_gpu_sync(r.id);
  INSERT INTO api_private.local_cloud_audit(run_id,action) VALUES(r.id,'billable_submit_intent');RETURN jsonb_build_object('ok',true);
 END IF;
 IF action<>'record' THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
 IF p->>'status'='accepted' THEN
  IF j.state<>'submitting' OR NOT coalesce(p->>'jobId'~'^[a-zA-Z0-9_-]{1,200}$',false) THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
  UPDATE api_private.local_cloud_jobs SET state='accepted',provider_id=p->>'jobId',lease=NULL,lease_until=NULL,next_at=now()+interval '5 seconds',updated_at=now() WHERE run_id=r.id;
  UPDATE api_private.local_gpu_runs SET status='queued',error_code=NULL,updated_at=now() WHERE id=r.id;
 ELSIF p->>'status'='submission_unknown' THEN
  IF j.state<>'submitting' THEN RETURN jsonb_build_object('ok',true);END IF;
  UPDATE api_private.local_cloud_jobs SET state='unknown',lease=NULL,lease_until=NULL,updated_at=now() WHERE run_id=r.id;
  UPDATE api_private.local_gpu_runs SET status='failed',error_code='PROVIDER_SUBMISSION_UNKNOWN',updated_at=now() WHERE id=r.id;
  INSERT INTO api_private.local_cloud_audit(run_id,action) VALUES(r.id,'submission_ack_unknown');
 ELSIF p->>'status'='completed' THEN
  IF j.state<>'polling' OR j.provider_id IS NULL THEN RETURN jsonb_build_object('error','REVISION_CONFLICT');END IF;a:=p->'artifact';
  IF NOT coalesce(a->>'sha256'~'^[a-f0-9]{64}$' AND a->>'size'~'^[0-9]{1,8}$' AND (a->>'size')::bigint BETWEEN 1 AND 10485760 AND ((a->>'mime'='image/png' AND a->>'extension'='png') OR (a->>'mime'='image/jpeg' AND a->>'extension'='jpg')),false) THEN RETURN jsonb_build_object('error','INVALID_FILE');END IF;
  k:=encode(sha256(convert_to(instance||'/'||r.id::text||'/standard_facade/'||(a->>'sha256'),'UTF8')),'hex');fid:=(substr(k,1,8)||'-'||substr(k,9,4)||'-4'||substr(k,14,3)||'-8'||substr(k,18,3)||'-'||substr(k,21,12))::uuid;
  IF fid IS DISTINCT FROM (a->>'fileId')::uuid THEN RETURN jsonb_build_object('error','INVALID_FILE');END IF;
  INSERT INTO api_private.local_gpu_outputs(run_id,phase,revision,artifact_type,file_id,sha256,size,mime,extension,state,lease_token,source)
   VALUES(r.id,'cloud',0,'standard_facade',fid,a->>'sha256',(a->>'size')::bigint,a->>'mime',a->>'extension','ready',j.lease,jsonb_build_object('provider','dashscope','model','qwen-image-3.0'));
  UPDATE api_private.local_cloud_jobs SET state='completed',lease=NULL,lease_until=NULL,updated_at=now() WHERE run_id=r.id;
  UPDATE api_private.local_gpu_runs SET status='completed',completion_token=j.lease,progress=100,error_code=NULL,updated_at=now() WHERE id=r.id;
 ELSIF p->>'status' IN('queued','running','poll_error') THEN
  IF j.state<>'polling' OR j.provider_id IS NULL THEN RETURN jsonb_build_object('error','REVISION_CONFLICT');END IF;
  UPDATE api_private.local_cloud_jobs SET state='accepted',lease=NULL,lease_until=NULL,next_at=now()+CASE WHEN p->>'status'='poll_error' THEN interval '30 seconds' ELSE interval '5 seconds' END,poll_errors=poll_errors+CASE WHEN p->>'status'='poll_error' THEN 1 ELSE 0 END,updated_at=now() WHERE run_id=r.id;
  UPDATE api_private.local_gpu_runs SET status='running',progress=greatest(progress,10),updated_at=now() WHERE id=r.id;
 ELSIF p->>'status'='failed' THEN
  UPDATE api_private.local_cloud_jobs SET state='failed',lease=NULL,lease_until=NULL,updated_at=now() WHERE run_id=r.id;
  UPDATE api_private.local_gpu_runs SET status='failed',error_code='PROVIDER_FAILED',updated_at=now() WHERE id=r.id;
 ELSE RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
 PERFORM api_private.local_gpu_sync(r.id);RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION api_private.local_cloud_call(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION api_private.local_cloud_call(uuid,uuid,text,text,jsonb) TO village_unified_login;
COMMIT;
