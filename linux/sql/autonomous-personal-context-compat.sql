-- Candidate-only, additive compatibility for the pre-project personal table.
BEGIN;
DO $$BEGIN
 IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'AUTONOMOUS_TARGET_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM autonomous_control.installed_steps WHERE name='files.sql')
 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.course_personal_spaces'::regclass AND attname IN ('teaching_project_id','context_space_type') AND NOT attisdropped)
 OR to_regprocedure('public.ensure_course_personal_space(text,uuid,text,text,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'LEGACY_PERSONAL_SCHEMA_REQUIRED'; END IF;
END$$;
LOCK TABLE public.course_personal_spaces IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE personal_compat_before ON COMMIT DROP AS
 SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'[]')) AS digest FROM public.course_personal_spaces s;
ALTER TABLE public.course_personal_spaces
 ADD COLUMN teaching_project_id uuid REFERENCES public.teaching_projects(id) ON DELETE RESTRICT,
 ADD COLUMN context_space_type text CHECK(context_space_type IN ('practice_personal','formal_personal'));
CREATE INDEX course_personal_spaces_project_context_idx ON public.course_personal_spaces(teaching_project_id,village_id,owner_id);
CREATE FUNCTION public.ensure_course_personal_space(
  p_course_id text,
  p_teaching_project_id uuid,
  p_village_id text,
  p_space_type text,
  p_title text default null
) returns public.course_personal_spaces
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_space public.course_personal_spaces;
  v_project public.teaching_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_space_type not in ('practice_personal', 'formal_personal') then
    raise exception 'PERSONAL_SPACE_TYPE_REQUIRED';
  end if;
  select * into v_project from public.teaching_projects
  where id = p_teaching_project_id and course_id = p_course_id and stage <> 'archived';
  if not found then raise exception 'PROJECT_NOT_AVAILABLE'; end if;
  if p_space_type = 'practice_personal'
     and p_village_id not in ('mibu', v_project.practice_village_id::text) then
    raise exception 'PERSONAL_SPACE_CONTEXT_MISMATCH';
  end if;
  if p_space_type = 'formal_personal'
     and (v_project.formal_village_id is null or p_village_id <> v_project.formal_village_id::text) then
    raise exception 'PERSONAL_SPACE_CONTEXT_MISMATCH';
  end if;
  if not exists(select 1 from public.geoprocessing_villages where village_id = p_village_id and active) then
    raise exception 'VILLAGE_NOT_AVAILABLE';
  end if;
  insert into public.course_personal_spaces(
    owner_id, course_id, village_id, space_type, title, teaching_project_id, context_space_type
  ) values (
    auth.uid(), trim(p_course_id), p_village_id, 'course_personal',
    coalesce(nullif(trim(p_title), ''), '我的个人体验空间'),
    p_teaching_project_id, p_space_type
  )
  ON CONFLICT(owner_id, course_id, village_id, space_type) do update set
    teaching_project_id = excluded.teaching_project_id,
    context_space_type = excluded.context_space_type,
    updated_at = now()
  where course_personal_spaces.teaching_project_id is null
     or course_personal_spaces.teaching_project_id = excluded.teaching_project_id
  returning * into v_space;
  if v_space.id is null then raise exception 'PERSONAL_SPACE_PROJECT_CONFLICT'; end if;
  return v_space;
end;
$$;
REVOKE ALL ON FUNCTION public.ensure_course_personal_space(text,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
DO $$BEGIN
 IF (SELECT digest FROM personal_compat_before) IS DISTINCT FROM
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(s)-'teaching_project_id'-'context_space_type' ORDER BY id)::text,'[]')) FROM public.course_personal_spaces s)
 THEN RAISE EXCEPTION 'PERSONAL_SOURCE_ROWS_CHANGED'; END IF;
END$$;
CREATE TABLE autonomous_control.personal_context_compat(sql_sha256 text NOT NULL,function_sha256 text NOT NULL);
REVOKE ALL ON autonomous_control.personal_context_compat FROM PUBLIC,anon,authenticated;
INSERT INTO autonomous_control.personal_context_compat VALUES('__SQL_SHA256__',md5(pg_get_functiondef('public.ensure_course_personal_space(text,uuid,text,text,text)'::regprocedure)));
COMMIT;
