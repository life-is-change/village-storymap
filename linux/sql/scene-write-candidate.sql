-- Only the independent C1 database. Never apply this to Supabase or village_copy.
DO $guard$ BEGIN
 IF current_database()<>'village_scene_validation' THEN RAISE EXCEPTION 'WRONG_CANDIDATE_DATABASE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_scene_login') THEN RAISE EXCEPTION 'SCENE_ROLE_ALREADY_EXISTS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls) THEN RAISE EXCEPTION 'UNSAFE_AUTHENTICATED_ROLE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.scene_edit_projects'::regclass,'public.scene_edit_versions'::regclass) AND NOT relrowsecurity) THEN RAISE EXCEPTION 'SCENE_RLS_REQUIRED'; END IF;
END $guard$;
REVOKE CONNECT ON DATABASE village_scene_validation FROM PUBLIC;
CREATE ROLE village_scene_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2;
GRANT authenticated TO village_scene_login WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE village_scene_validation TO village_scene_login;
CREATE FUNCTION public.scene_candidate_lock(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $body$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_read_scene_edit_project(p_id) THEN RAISE EXCEPTION 'SCENE_EDIT_FORBIDDEN'; END IF;
 PERFORM id FROM public.scene_edit_projects WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCENE_EDIT_FORBIDDEN'; END IF;
END $body$;
REVOKE ALL ON FUNCTION public.scene_candidate_lock(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.scene_candidate_lock(uuid) TO authenticated;
