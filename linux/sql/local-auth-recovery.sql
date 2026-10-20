-- Private operator recovery, not a publicly routed password-reset endpoint.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'village_unified_candidate' OR NOT EXISTS(SELECT 1 FROM api_private.local_auth_installation WHERE issuer='https://8.148.248.237/auth/v1')
   OR to_regclass('api_private.auth_recovery_actions') IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_AUTH_RECOVERY_FRESH_TARGET_REQUIRED'; END IF;
END $$;
CREATE TABLE api_private.auth_recovery_actions(
 actor_id uuid NOT NULL REFERENCES public.profiles,request_id uuid NOT NULL,target_id uuid NOT NULL REFERENCES public.profiles,
 target_student_id text NOT NULL,request_mac text NOT NULL CHECK(request_mac~'^[a-f0-9]{64}$'),
 finish_token uuid NOT NULL DEFAULT gen_random_uuid(),expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','unknown','completed','canceled')),
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 PRIMARY KEY(actor_id,request_id)
);
CREATE UNIQUE INDEX auth_recovery_one_pending ON api_private.auth_recovery_actions(target_id) WHERE state IN('pending','unknown');
REVOKE ALL ON api_private.auth_recovery_actions FROM PUBLIC,anon,authenticated,village_unified_login,village_auth_runtime;

CREATE FUNCTION api_private.begin_auth_recovery(p_student text,p_request uuid,p_mac text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,api_private,public,auth,pg_temp
AS $$ DECLARE r api_private.auth_recovery_actions;target public.profiles;fresh boolean:=false;BEGIN
 IF api_private.current_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_student !~ '^[a-z0-9_-]{2,32}$' OR p_request IS NULL OR p_mac !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('auth-recovery:'||auth.uid(),0));
 SELECT * INTO r FROM api_private.auth_recovery_actions WHERE actor_id=auth.uid() AND request_id=p_request FOR UPDATE;
 IF FOUND THEN
  IF r.target_student_id<>p_student OR r.request_mac<>p_mac THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  IF r.state='canceled' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF r.state<>'completed' AND r.expires_at<=now() THEN
   UPDATE api_private.auth_recovery_actions SET finish_token=gen_random_uuid(),expires_at=now()+interval '5 minutes'
    WHERE actor_id=r.actor_id AND request_id=r.request_id RETURNING * INTO r;
  END IF;
 ELSE
  IF (SELECT count(*) FROM api_private.auth_recovery_actions WHERE actor_id=auth.uid() AND created_at>now()-interval '1 hour')>=3
     OR EXISTS(SELECT 1 FROM api_private.auth_recovery_actions WHERE actor_id=auth.uid() AND created_at>now()-interval '30 seconds') THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
  SELECT * INTO target FROM public.profiles WHERE student_id=p_student FOR UPDATE;
  -- This command recovers student/teacher accounts. It cannot reset any admin,
  -- including its caller. Administrator break-glass recovery is not automated.
  IF NOT FOUND OR target.role='admin' OR target.disabled_at IS NOT NULL
     OR EXISTS(SELECT 1 FROM api_private.profile_tombstones WHERE user_id=target.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF EXISTS(SELECT 1 FROM api_private.auth_recovery_actions WHERE target_id=target.id AND state IN('pending','unknown')) THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  INSERT INTO api_private.auth_recovery_actions(actor_id,request_id,target_id,target_student_id,request_mac)
   VALUES(auth.uid(),p_request,target.id,p_student,p_mac) RETURNING * INTO r;fresh:=true;
 END IF;
 RETURN jsonb_build_object('targetId',r.target_id,'finishToken',r.finish_token,'state',r.state,'fresh',fresh);
END $$;

CREATE FUNCTION api_private.finish_auth_recovery(p_actor uuid,p_request uuid,p_token uuid,p_state text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,api_private,public,auth,pg_temp
AS $$ DECLARE r api_private.auth_recovery_actions;BEGIN
 IF p_state NOT IN('unknown','completed') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 SELECT * INTO r FROM api_private.auth_recovery_actions WHERE actor_id=p_actor AND request_id=p_request FOR UPDATE;
 IF NOT FOUND OR r.finish_token IS DISTINCT FROM p_token OR r.expires_at<=now()
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND role='admin' AND disabled_at IS NULL)
    OR EXISTS(SELECT 1 FROM api_private.profile_tombstones WHERE user_id=p_actor)
    OR r.state='canceled' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF r.state='completed' THEN RETURN jsonb_build_object('state','completed'); END IF;
 IF p_state='completed' THEN
  DELETE FROM auth.refresh_tokens WHERE user_id::text=r.target_id::text;
  DELETE FROM auth.sessions WHERE user_id=r.target_id;
 END IF;
 UPDATE api_private.auth_recovery_actions SET state=p_state,finished_at=CASE WHEN p_state='completed' THEN now() ELSE NULL END
  WHERE actor_id=r.actor_id AND request_id=r.request_id;
 RETURN jsonb_build_object('state',p_state);
END $$;
REVOKE ALL ON FUNCTION api_private.begin_auth_recovery(text,uuid,text),api_private.finish_auth_recovery(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,village_unified_login,village_auth_runtime;
GRANT EXECUTE ON FUNCTION api_private.begin_auth_recovery(text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION api_private.finish_auth_recovery(uuid,uuid,uuid,text) TO village_unified_login;

-- Block target business sessions immediately while an external password update
-- is pending/unknown. A lost update acknowledgement cannot leave old sessions usable.
CREATE OR REPLACE FUNCTION api_private.local_auth_session_active(p_user uuid,p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,auth,api_private,pg_temp
AS $$
 SELECT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
  WHERE s.id=p_session AND s.user_id=p_user AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now()) AND (s.not_after IS NULL OR s.not_after>now())
    AND NOT EXISTS(SELECT 1 FROM api_private.profile_tombstones t WHERE t.user_id=p_user)
    AND NOT EXISTS(SELECT 1 FROM api_private.auth_recovery_actions r WHERE r.target_id=p_user AND r.state IN('pending','unknown')))
$$;

CREATE FUNCTION api_private.revoke_disabled_local_auth() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,api_private,pg_temp
AS $$ BEGIN
 UPDATE auth.users SET banned_until=now()+interval '100 years' WHERE id=new.user_id;
 DELETE FROM auth.refresh_tokens WHERE user_id::text=new.user_id::text;
 DELETE FROM auth.sessions WHERE user_id=new.user_id;
 UPDATE api_private.auth_recovery_actions SET state='canceled',finished_at=now() WHERE target_id=new.user_id AND state IN('pending','unknown');
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION api_private.revoke_disabled_local_auth() FROM PUBLIC,anon,authenticated,village_unified_login,village_auth_runtime;
CREATE TRIGGER local_auth_disable AFTER INSERT ON api_private.profile_tombstones FOR EACH ROW EXECUTE FUNCTION api_private.revoke_disabled_local_auth();
COMMIT;
