-- 模块二增量迁移：为已部署的场景编辑器增加管理员个人沙盒。
-- 可重复执行；不会删除现有小组项目或覆盖场景文档。

alter table public.scene_edit_projects
  add column if not exists scope_kind text not null default 'group';

alter table public.scene_edit_projects alter column group_id drop not null;

alter table public.scene_edit_projects
  drop constraint if exists scene_edit_projects_scope_kind_check;
alter table public.scene_edit_projects
  add constraint scene_edit_projects_scope_kind_check check (
    (scope_kind = 'group' and group_id is not null)
    or (scope_kind = 'admin_sandbox' and group_id is null)
  );

drop index if exists public.scene_edit_projects_scope_idx;
create index scene_edit_projects_scope_idx
  on public.scene_edit_projects(
    teaching_project_id, village_id, scope_kind, group_id, created_by, space_id, updated_at desc
  );

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
        or (project.scope_kind = 'admin_sandbox'
          and project.created_by = auth.uid()
          and public.current_profile_role() = 'admin')
      )
  );
$$;

drop function if exists public.scene_edit_create_project(uuid, uuid, text, text, text, bigint, jsonb);

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
  if p_scope_kind not in ('group', 'admin_sandbox') then raise exception 'SCENE_EDIT_SCOPE_INVALID'; end if;
  if (p_scope_kind = 'group' and p_group_id is null)
     or (p_scope_kind = 'admin_sandbox' and p_group_id is not null) then
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
    );
  if v_course_id is null then raise exception 'SCENE_EDIT_CONTEXT_INVALID'; end if;
  if not (
    (p_scope_kind = 'group' and (public.is_scene_edit_staff() or public.is_scene_edit_group_member(p_group_id, v_course_id)))
    or (p_scope_kind = 'admin_sandbox' and public.current_profile_role() = 'admin')
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

create or replace function public.scene_edit_load_project(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_project public.scene_edit_projects;
begin
  if not public.can_read_scene_edit_project(p_project_id) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;
  select * into strict v_project from public.scene_edit_projects where id = p_project_id;
  return jsonb_build_object(
    'schemaVersion', 1,
    'projectId', v_project.id,
    'villageId', v_project.village_id,
    'groupId', v_project.group_id,
    'baselineRef', jsonb_build_object('spaceId', v_project.space_id, 'revision', v_project.baseline_revision),
    'revision', v_project.revision,
    'updatedAt', v_project.updated_at,
    'selectionBoundary', v_project.selection_boundary,
    'layers', v_project.layers,
    'groups', v_project.groups,
    'assetRefs', v_project.asset_refs,
    'metadata', coalesce(v_project.metadata, '{}'::jsonb)
      || jsonb_build_object('scopeKind', v_project.scope_kind, 'ownerId', v_project.created_by),
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', object_id, 'kind', kind, 'category', category, 'geometry', geometry,
        'transform', transform, 'properties', properties, 'layerId', layer_id,
        'groupId', group_ref, 'zIndex', z_index
      ) order by z_index, object_id)
      from public.scene_edit_objects where project_id = v_project.id
    ), '[]'::jsonb)
  );
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

create or replace function public.scene_edit_branch_project(
  p_project_id uuid,
  p_new_baseline_revision bigint,
  p_title text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source public.scene_edit_projects;
  v_result jsonb;
  v_new_id uuid;
begin
  select * into strict v_source from public.scene_edit_projects where id = p_project_id;
  if not public.can_read_scene_edit_project(p_project_id) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;
  v_result := public.scene_edit_create_project(
    v_source.teaching_project_id, v_source.village_id, v_source.space_id, v_source.group_id,
    p_title, p_new_baseline_revision, v_source.selection_boundary, v_source.scope_kind
  );
  v_new_id := (v_result ->> 'id')::uuid;
  update public.scene_edit_projects
    set parent_project_id = p_project_id, layers = v_source.layers, groups = v_source.groups,
        asset_refs = v_source.asset_refs, metadata = v_source.metadata
    where id = v_new_id;
  insert into public.scene_edit_objects
    select v_new_id, object_id, kind, category, geometry, transform, properties, layer_id, group_ref, z_index, now()
    from public.scene_edit_objects where project_id = p_project_id;
  return v_result;
end;
$function$;

create or replace function public.scene_edit_restore_version(
  p_version_id uuid,
  p_title text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_version public.scene_edit_versions;
  v_source public.scene_edit_projects;
  v_created jsonb;
  v_project_id uuid;
begin
  select * into strict v_version from public.scene_edit_versions where id = p_version_id;
  select * into strict v_source from public.scene_edit_projects where id = v_version.project_id;
  if not public.can_read_scene_edit_project(v_source.id) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;
  v_created := public.scene_edit_create_project(
    v_source.teaching_project_id, v_source.village_id, v_source.space_id, v_source.group_id,
    p_title, v_source.baseline_revision, v_version.document -> 'selectionBoundary', v_source.scope_kind
  );
  v_project_id := (v_created ->> 'id')::uuid;
  perform public.scene_edit_save_draft(
    v_project_id, 0,
    v_version.document || jsonb_build_object('projectId', v_project_id, 'revision', 0)
  );
  update public.scene_edit_projects set parent_project_id = v_source.id where id = v_project_id;
  return jsonb_build_object('id', v_project_id, 'revision', 1);
end;
$function$;

revoke all on function public.scene_edit_create_project(uuid, uuid, text, text, text, bigint, jsonb, text) from public, anon;
grant execute on function public.scene_edit_create_project(uuid, uuid, text, text, text, bigint, jsonb, text) to authenticated;
revoke all on function public.can_read_scene_edit_project(uuid) from public, anon;
grant execute on function public.can_read_scene_edit_project(uuid) to authenticated;

notify pgrst, 'reload schema';
