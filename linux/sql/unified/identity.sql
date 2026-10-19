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

-- Auth passwords and sessions stay at the managed provider. These local rows
-- are UUID anchors for the restored foreign keys, not local Auth accounts.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TABLE api_private.profile_key_aliases(
  student_key text PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.profiles(id)
);
INSERT INTO api_private.profile_key_aliases SELECT student_id||'::'||display_name,id FROM public.profiles;
CREATE FUNCTION api_private.profile_self() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ BEGIN
  IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED'; END IF;
  RETURN (SELECT jsonb_build_object('id',id,'student_id',student_id,'display_name',display_name,
    'role',role,'gender',gender,'class_name',class_name,'grade',grade) FROM public.profiles WHERE id=auth.uid());
END $$;
CREATE FUNCTION api_private.ensure_profile(p_id uuid,p_profile jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE p public.profiles; BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  IF EXISTS(SELECT 1 FROM api_private.profile_tombstones WHERE user_id=p_id) THEN RAISE EXCEPTION 'PROFILE_DISABLED'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=p_id FOR UPDATE;
  IF FOUND THEN
    IF p.disabled_at IS NOT NULL THEN RAISE EXCEPTION 'PROFILE_DISABLED'; END IF;
  ELSE
    IF p_profile->>'id' IS DISTINCT FROM p_id::text OR jsonb_typeof(p_profile)<>'object'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_profile) k WHERE k NOT IN ('id','student_id','display_name','gender','class_name','grade'))
      OR coalesce(p_profile->>'student_id','') !~ '^[a-z0-9_-]{2,32}$'
      OR length(coalesce(p_profile->>'display_name','')) NOT BETWEEN 1 AND 20
      OR length(coalesce(p_profile->>'gender',''))>12 OR length(coalesce(p_profile->>'class_name',''))>30
      OR length(coalesce(p_profile->>'grade',''))>20 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    INSERT INTO auth.users(id) VALUES(p_id) ON CONFLICT(id) DO NOTHING;
    INSERT INTO public.profiles(id,student_id,display_name,role,gender,class_name,grade)
      VALUES(p_id,p_profile->>'student_id',p_profile->>'display_name','student',p_profile->>'gender',p_profile->>'class_name',p_profile->>'grade') RETURNING * INTO p;
    INSERT INTO api_private.profile_key_aliases VALUES(p.student_id||'::'||p.display_name,p.id);
  END IF;
  RETURN jsonb_build_object('id',p.id,'student_id',p.student_id,'display_name',p.display_name,'role',p.role,'gender',p.gender,'class_name',p.class_name,'grade',p.grade);
END $$;
CREATE FUNCTION api_private.update_profile(p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ DECLARE p public.profiles; old_key text; new_key text; BEGIN
  IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'PROFILE_DISABLED'; END IF;
  IF jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_each(p_patch) e WHERE e.key NOT IN ('displayName','gender','className','grade') OR jsonb_typeof(e.value)<>'string')
    OR (p_patch ? 'displayName' AND length(p_patch->>'displayName') NOT BETWEEN 1 AND 20)
    OR length(coalesce(p_patch->>'gender',''))>12 OR length(coalesce(p_patch->>'className',''))>30
    OR length(coalesce(p_patch->>'grade',''))>20 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
  old_key:=p.student_id||'::'||p.display_name;
  UPDATE public.profiles SET display_name=coalesce(p_patch->>'displayName',display_name),gender=coalesce(p_patch->>'gender',gender),
    class_name=coalesce(p_patch->>'className',class_name),grade=coalesce(p_patch->>'grade',grade) WHERE id=p.id RETURNING * INTO p;
  new_key:=p.student_id||'::'||p.display_name;
  IF old_key<>new_key THEN
    UPDATE public.group_memberships SET student_key=new_key WHERE student_key=old_key;
    IF to_regclass('public.task_progress') IS NOT NULL THEN
      EXECUTE 'UPDATE public.task_progress SET student_key=$1 WHERE student_key=$2' USING new_key,old_key;
    END IF;
    INSERT INTO api_private.profile_key_aliases VALUES(new_key,p.id) ON CONFLICT(student_key) DO NOTHING;
  END IF;
  RETURN api_private.profile_self();
END $$;
CREATE FUNCTION api_private.disable_profile(p_target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp
AS $$ BEGIN
  IF api_private.current_role() IS DISTINCT FROM 'admin' OR p_target=auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=p_target AND role<>'admin' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  INSERT INTO api_private.profile_tombstones(user_id) VALUES(p_target) ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET disabled_at=coalesce(disabled_at,now()) WHERE id=p_target;
  RETURN jsonb_build_object('id',p_target,'disabled',true);
END $$;
REVOKE ALL ON FUNCTION api_private.profile_self(),api_private.ensure_profile(uuid,jsonb),api_private.update_profile(jsonb),api_private.disable_profile(uuid) FROM PUBLIC,anon,authenticated,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.profile_self(),api_private.update_profile(jsonb),api_private.disable_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api_private.ensure_profile(uuid,jsonb) TO village_unified_login;
