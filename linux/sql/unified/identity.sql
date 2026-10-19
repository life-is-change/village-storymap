-- Isolated local candidate only. Never apply to Supabase or another candidate DB.
DO $$ BEGIN
  IF current_database()<>'village_unified_candidate' THEN
    RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='api_private') THEN
    RAISE EXCEPTION 'UNIFIED_SCHEMA_ALREADY_INSTALLED';
  END IF;
END $$;

CREATE ROLE village_unified_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4;
GRANT authenticated TO village_unified_login;
CREATE SCHEMA api_private;
REVOKE ALL ON SCHEMA api_private FROM PUBLIC,anon,authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated,village_unified_login;
REVOKE ALL ON ALL TABLES IN SCHEMA public,auth FROM PUBLIC,anon,authenticated,village_unified_login;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public,auth FROM PUBLIC,anon,authenticated,village_unified_login;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,village_unified_login;
GRANT USAGE ON SCHEMA public,auth,api_private TO authenticated;
GRANT USAGE ON SCHEMA api_private TO village_unified_login;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE api_private.installation(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),schema_version integer NOT NULL);
INSERT INTO api_private.installation VALUES(true,1);
CREATE TABLE api_private.profile_tombstones(user_id uuid PRIMARY KEY,disabled_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

CREATE FUNCTION api_private.installation_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,api_private,pg_temp
AS $$ SELECT schema_version FROM api_private.installation WHERE singleton $$;
CREATE FUNCTION api_private.profile_status() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$
  SELECT CASE
    WHEN EXISTS(SELECT 1 FROM api_private.profile_tombstones WHERE user_id=auth.uid()) THEN 'disabled'
    WHEN EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND disabled_at IS NOT NULL) THEN 'disabled'
    WHEN EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role IN ('student','teacher','admin')) THEN 'active'
    ELSE 'missing' END
$$;
CREATE FUNCTION api_private.current_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() AND api_private.profile_status()='active' $$;

-- No historical permissive profile policy may OR its way around the new boundary.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
  LOOP EXECUTE format('DROP POLICY %I ON public.profiles',p.policyname); END LOOP;
END $$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY unified_profiles_read ON public.profiles FOR SELECT TO authenticated USING(
  disabled_at IS NULL AND api_private.profile_status()='active'
  AND (id=auth.uid() OR api_private.current_role() IN ('teacher','admin'))
);
GRANT SELECT ON public.profiles TO authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA api_private FROM PUBLIC,anon,authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.profile_status(),api_private.current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION api_private.installation_version() TO village_unified_login;
DO $$ BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC',current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO village_unified_login',current_database());
END $$;
