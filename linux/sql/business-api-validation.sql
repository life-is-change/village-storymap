-- Candidate only. Called by guarded deployment after validating target identity.
-- Role password is assigned separately on private stdin, never committed here.
DO $guard$
BEGIN
 IF current_database() <> 'village_copy' THEN RAISE EXCEPTION 'WRONG_CANDIDATE_DATABASE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='village_api_login') THEN
   RAISE EXCEPTION 'API_ROLE_ALREADY_EXISTS';
 END IF;
END $guard$;
CREATE ROLE village_api_login LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4;
GRANT authenticated TO village_api_login WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE village_copy TO village_api_login;
DO $guard$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['profiles','planning_spaces','course_personal_spaces','courses','group_memberships'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname=n AND c.relrowsecurity) THEN
   RAISE EXCEPTION 'REQUIRED_RLS_MISSING';
  END IF;
  IF NOT has_table_privilege('authenticated','public.'||quote_ident(n),'SELECT') THEN RAISE EXCEPTION 'REQUIRED_SELECT_MISSING'; END IF;
  IF n IN ('profiles','planning_spaces','course_personal_spaces') AND EXISTS (
   SELECT 1 FROM pg_policy p WHERE p.polrelid=('public.'||quote_ident(n))::regclass
   AND p.polcmd IN ('r','*') AND pg_get_expr(p.polqual,p.polrelid)='true'
  ) THEN RAISE EXCEPTION 'PERMISSIVE_POLICY_REQUIRES_REVIEW'; END IF;
 END LOOP;
 IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('public.current_profile_role()') IS NULL OR to_regprocedure('public.current_profile_student_key()') IS NULL THEN RAISE EXCEPTION 'IDENTITY_HELPER_MISSING'; END IF;
END $guard$;
