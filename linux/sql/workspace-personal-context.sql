-- Exact function-body patch input; installed by the guarded workspace repair only.
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
  -- Match the published multi-practice catalog, not the retired single-village queue registry.
  if not exists (
    select 1 from public.villages village
    where village.id::text = case when p_village_id = 'mibu' then v_project.practice_village_id::text else p_village_id end
      and village.status = 'published'
      and ((p_space_type = 'practice_personal' and village.is_practice)
        or (p_space_type = 'formal_personal' and v_project.formal_project_open
          and village.id = v_project.formal_village_id))
  ) then raise exception 'PERSONAL_SPACE_CONTEXT_MISMATCH'; end if;
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
