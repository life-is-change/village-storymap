-- Install only in a fresh, explicitly selected autonomous candidate, as owner.
-- It is not a source migration and must not be applied to a live legacy copy.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1
    OR to_regclass('api_private.local_auth_installation') IS NOT NULL THEN
   RAISE EXCEPTION 'LOCAL_AUTH_FRESH_TARGET_REQUIRED';
 END IF;
 IF (SELECT max(version) FROM auth.schema_migrations)<>'20260831180000'
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_auth_runtime' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb)
    OR EXISTS(SELECT 1 FROM auth.identities WHERE provider<>'email')
    OR EXISTS(SELECT 1 FROM auth.mfa_factors) THEN RAISE EXCEPTION 'LOCAL_AUTH_COMPATIBILITY_REQUIRED'; END IF;
END $$;

CREATE TABLE api_private.local_auth_installation(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 issuer text NOT NULL CHECK(issuer='https://8.148.248.237/auth/v1'),
 auth_version text NOT NULL CHECK(auth_version='v2.197.0'),
 installed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO api_private.local_auth_installation(singleton,issuer,auth_version)
 VALUES(true,'https://8.148.248.237/auth/v1','v2.197.0');
REVOKE ALL ON api_private.local_auth_installation FROM PUBLIC,anon,authenticated,village_unified_login,village_auth_runtime;

-- These are copied credentials for old sessions, not local sessions. Preserve
-- user UUIDs, encrypted_password and identity rows; clear only transient state.
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.sessions;
DELETE FROM auth.flow_state;
DELETE FROM auth.one_time_tokens;
DELETE FROM auth.oauth_client_states;
UPDATE auth.users SET confirmation_token='',recovery_token='',email_change_token_new='',
 email_change_token_current='',reauthentication_token='',email_change='',phone_change='',phone_change_token='';

ALTER ROLE village_auth_runtime IN DATABASE village_unified_candidate SET search_path=auth;
GRANT CONNECT ON DATABASE village_unified_candidate TO village_auth_runtime;
GRANT USAGE ON SCHEMA auth TO village_auth_runtime;
REVOKE CREATE ON SCHEMA public,auth FROM village_auth_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM village_auth_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO village_auth_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA auth TO village_auth_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO village_auth_runtime;
REVOKE INSERT,UPDATE,DELETE ON auth.schema_migrations FROM village_auth_runtime;
-- GoTrue owns access to its Auth data, not business tables. Explicit policies
-- also work when a platform snapshot has enabled RLS on Auth-managed tables.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='auth' LOOP
  EXECUTE format('ALTER TABLE auth.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('CREATE POLICY local_auth_runtime ON auth.%I FOR ALL TO village_auth_runtime USING(true) WITH CHECK(true)',t.tablename);
 END LOOP;
END $$;

CREATE FUNCTION api_private.local_auth_session_active(p_user uuid,p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,auth,api_private,pg_temp
AS $$
 SELECT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
  WHERE s.id=p_session AND s.user_id=p_user AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now())
    AND (s.not_after IS NULL OR s.not_after>now())
    AND NOT EXISTS(SELECT 1 FROM api_private.profile_tombstones t WHERE t.user_id=p_user))
$$;
REVOKE ALL ON FUNCTION api_private.local_auth_session_active(uuid,uuid) FROM PUBLIC,anon,authenticated,village_auth_runtime;
GRANT EXECUTE ON FUNCTION api_private.local_auth_session_active(uuid,uuid) TO village_unified_login;

CREATE FUNCTION api_private.ensure_local_profile(p_id uuid,p_profile jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE p public.profiles; u auth.users; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 IF EXISTS(SELECT 1 FROM api_private.profile_tombstones WHERE user_id=p_id) THEN RAISE EXCEPTION 'PROFILE_DISABLED'; END IF;
 SELECT * INTO u FROM auth.users WHERE id=p_id AND deleted_at IS NULL
   AND email_confirmed_at IS NOT NULL AND NOT is_anonymous AND length(encrypted_password)>0
   AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF p.disabled_at IS NOT NULL THEN RAISE EXCEPTION 'PROFILE_DISABLED'; END IF;
 ELSE
  IF jsonb_typeof(p_profile)<>'object' OR p_profile->>'id' IS DISTINCT FROM p_id::text
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_profile) k WHERE k NOT IN ('id','student_id','display_name','gender','class_name','grade'))
    OR coalesce(p_profile->>'student_id','') !~ '^[a-z0-9_-]{2,32}$'
    OR u.email IS DISTINCT FROM 'sid-'||(p_profile->>'student_id')||'@rzmbmwauomzwiyenafha.supabase.co'
    OR u.raw_user_meta_data->>'student_id' IS DISTINCT FROM p_profile->>'student_id'
    OR u.raw_user_meta_data->>'display_name' IS DISTINCT FROM p_profile->>'display_name'
    OR length(coalesce(p_profile->>'display_name','')) NOT BETWEEN 1 AND 20
    OR length(coalesce(p_profile->>'gender',''))>12 OR length(coalesce(p_profile->>'class_name',''))>30
    OR length(coalesce(p_profile->>'grade',''))>20 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  INSERT INTO public.profiles(id,student_id,display_name,role,gender,class_name,grade)
   VALUES(p_id,p_profile->>'student_id',p_profile->>'display_name','student',p_profile->>'gender',p_profile->>'class_name',p_profile->>'grade') RETURNING * INTO p;
  INSERT INTO api_private.profile_key_aliases VALUES(p.student_id||'::'||p.display_name,p.id);
 END IF;
 RETURN jsonb_build_object('id',p.id,'student_id',p.student_id,'display_name',p.display_name,'role',p.role,'gender',p.gender,'class_name',p.class_name,'grade',p.grade);
END $$;
REVOKE ALL ON FUNCTION api_private.ensure_local_profile(uuid,jsonb) FROM PUBLIC,anon,authenticated,village_auth_runtime;
GRANT EXECUTE ON FUNCTION api_private.ensure_local_profile(uuid,jsonb) TO village_unified_login;
-- The historical provider-authenticated anchor path must be unreachable here.
REVOKE ALL ON FUNCTION api_private.ensure_profile(uuid,jsonb) FROM village_unified_login,authenticated,anon,PUBLIC;
COMMIT;
