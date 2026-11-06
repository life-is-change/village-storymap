BEGIN;
ALTER TABLE public.scene_edit_projects DROP CONSTRAINT IF EXISTS scene_edit_projects_scope_kind_check;
ALTER TABLE public.scene_edit_projects DROP CONSTRAINT IF EXISTS scene_edit_projects_check;
ALTER TABLE public.scene_edit_projects ADD CONSTRAINT scene_edit_projects_scope_kind_check
 CHECK ((scope_kind='group' AND group_id IS NOT NULL)
     OR (scope_kind IN ('admin_sandbox','practice_personal') AND group_id IS NULL));

create or replace function public.can_read_scene_edit_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.scene_edit_projects project
    join public.teaching_projects teaching on teaching.id = project.teaching_project_id
    where project.id = p_project_id
      and (
        (project.scope_kind = 'group' and (
          public.is_scene_edit_staff()
          or public.is_scene_edit_group_member(project.group_id, teaching.course_id)
        ))
        or (project.scope_kind = 'practice_personal' and project.created_by = auth.uid())
        or (project.scope_kind = 'admin_sandbox'
          and project.created_by = auth.uid()
          and public.current_profile_role() = 'admin')
      )
  );
$$;

create or replace function public.scene_edit_create_project(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_group_id text,
  p_title text,
  p_baseline_revision bigint,
  p_selection_boundary jsonb default null,
  p_scope_kind text default 'group'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_course_id text;
  v_project public.scene_edit_projects;
begin
  if p_scope_kind not in ('group', 'admin_sandbox', 'practice_personal') then raise exception 'SCENE_EDIT_SCOPE_INVALID'; end if;
  if (p_scope_kind = 'group' and p_group_id is null)
     or (p_scope_kind <> 'group' and p_group_id is not null) then
    raise exception 'SCENE_EDIT_SCOPE_INVALID';
  end if;

  select teaching.course_id into v_course_id
  from public.teaching_projects teaching
  join public.planning_spaces space on space.teaching_project_id = teaching.id
  where teaching.id = p_teaching_project_id
    and space.id = p_space_id
    and space.village_id = p_village_id
    and (
      (p_scope_kind = 'group' and space.group_id = p_group_id and space.space_type = 'group_plan')
      or p_scope_kind = 'admin_sandbox'
      or (p_scope_kind = 'practice_personal' and space.space_type = 'practice_personal'
          and space.owner_id = auth.uid())
    );
  if v_course_id is null then raise exception 'SCENE_EDIT_CONTEXT_INVALID'; end if;
  if not (
    (p_scope_kind = 'group' and (public.is_scene_edit_staff() or public.is_scene_edit_group_member(p_group_id, v_course_id)))
    or (p_scope_kind = 'admin_sandbox' and public.current_profile_role() = 'admin')
    or p_scope_kind = 'practice_personal'
  ) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;

  insert into public.scene_edit_projects(
    teaching_project_id, village_id, space_id, group_id, scope_kind, title, baseline_revision,
    selection_boundary, layers, metadata, created_by, updated_by
  ) values (
    p_teaching_project_id, p_village_id, p_space_id, p_group_id, p_scope_kind, trim(p_title), p_baseline_revision,
    p_selection_boundary, '[{"id":"design","name":"方案要素","visible":true,"locked":false,"order":0}]'::jsonb,
    jsonb_build_object('scopeKind', p_scope_kind, 'ownerId', auth.uid()), auth.uid(), auth.uid()
  ) returning * into v_project;
  return jsonb_build_object('id', v_project.id, 'revision', v_project.revision);
end;
$function$;

create or replace function public.scene_edit_save_draft(
  p_project_id uuid,
  p_expected_revision bigint,
  p_document jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_project public.scene_edit_projects;
  v_course_id text;
begin
  select project.* into strict v_project
  from public.scene_edit_projects project
  where project.id = p_project_id
  for update;
  select course_id into v_course_id from public.teaching_projects where id = v_project.teaching_project_id;
  if not (
    (v_project.scope_kind = 'group' and (public.is_scene_edit_staff() or public.is_scene_edit_group_member(v_project.group_id, v_course_id)))
    or (v_project.scope_kind = 'practice_personal' and v_project.created_by = auth.uid())
    or (v_project.scope_kind = 'admin_sandbox' and v_project.created_by = auth.uid() and public.current_profile_role() = 'admin')
  ) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;
  if v_project.status <> 'draft' then raise exception 'SCENE_EDIT_PROJECT_SUBMITTED'; end if;
  if v_project.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'SCENE_EDIT_REVISION_CONFLICT', detail = v_project.revision::text;
  end if;
  if p_document #>> '{baselineRef,spaceId}' <> v_project.space_id
     or (p_document #>> '{baselineRef,revision}')::bigint <> v_project.baseline_revision
     or (p_document ->> 'groupId') is distinct from v_project.group_id
     or coalesce(p_document #>> '{metadata,scopeKind}', 'group') is distinct from v_project.scope_kind then
    raise exception 'SCENE_EDIT_BASELINE_MISMATCH';
  end if;

  delete from public.scene_edit_objects where project_id = p_project_id;
  insert into public.scene_edit_objects(
    project_id, object_id, kind, category, geometry, transform, properties, layer_id, group_ref, z_index
  )
  select p_project_id, item ->> 'id', item ->> 'kind', item ->> 'category', item -> 'geometry',
    coalesce(item -> 'transform', '{}'::jsonb), coalesce(item -> 'properties', '{}'::jsonb),
    item ->> 'layerId', nullif(item ->> 'groupId', ''), coalesce((item ->> 'zIndex')::integer, 0)
  from jsonb_array_elements(coalesce(p_document -> 'objects', '[]'::jsonb)) item;

  update public.scene_edit_projects
  set selection_boundary = p_document -> 'selectionBoundary',
      layers = coalesce(p_document -> 'layers', '[]'::jsonb),
      groups = coalesce(p_document -> 'groups', '[]'::jsonb),
      asset_refs = coalesce(p_document -> 'assetRefs', '[]'::jsonb),
      metadata = coalesce(p_document -> 'metadata', '{}'::jsonb),
      revision = revision + 1, updated_by = auth.uid(), updated_at = now()
  where id = p_project_id
  returning * into v_project;
  return jsonb_build_object('revision', v_project.revision, 'updatedAt', v_project.updated_at);
end;
$function$;

CREATE OR REPLACE FUNCTION api_private.guard_semester_scene_project() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,api_private,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.teaching_projects p WHERE p.id=new.teaching_project_id
  AND p.stage NOT IN ('completed','archived')
  AND api_private.profile_status()='active'
  AND public.context_space_mutable(p.id,new.village_id,new.space_id)
  AND (new.scope_kind='admin_sandbox' OR
   (new.scope_kind='practice_personal' AND new.created_by=auth.uid()
    AND EXISTS(SELECT 1 FROM public.planning_spaces s WHERE s.id=new.space_id AND s.space_type='practice_personal' AND s.owner_id=auth.uid())) OR new.scope_kind='group'
   AND p.formal_village_id=new.village_id AND public.project_group_eligible(new.group_id,p.id)))
 THEN RAISE EXCEPTION 'SCENE_EDIT_FORBIDDEN'; END IF;
 RETURN new;
END $$;
COMMIT;
