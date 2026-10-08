-- 模块二：公共空间场景编辑器。
-- 可重复执行；依赖 teaching_projects、planning_spaces、course_groups、
-- group_memberships、current_profile_role() 和 current_profile_student_key()。

create table if not exists public.scene_edit_projects (
  id uuid primary key default gen_random_uuid(),
  teaching_project_id uuid not null references public.teaching_projects(id) on delete restrict,
  village_id uuid not null references public.villages(id) on delete restrict,
  space_id text not null references public.planning_spaces(id) on delete restrict,
  group_id text references public.course_groups(id) on delete restrict,
  scope_kind text not null default 'group' check (scope_kind in ('group', 'admin_sandbox')),
  title text not null check (length(trim(title)) between 1 and 100),
  baseline_revision bigint not null check (baseline_revision >= 0),
  selection_boundary jsonb,
  layers jsonb not null default '[]'::jsonb,
  groups jsonb not null default '[]'::jsonb,
  asset_refs jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  revision bigint not null default 0 check (revision >= 0),
  parent_project_id uuid references public.scene_edit_projects(id) on delete restrict,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_kind = 'group' and group_id is not null)
    or (scope_kind = 'admin_sandbox' and group_id is null)
  )
);

create table if not exists public.scene_edit_objects (
  project_id uuid not null references public.scene_edit_projects(id) on delete cascade,
  object_id text not null,
  kind text not null check (kind in ('surface', 'line', 'asset', 'structure')),
  category text not null,
  geometry jsonb not null,
  transform jsonb not null default '{}'::jsonb,
  properties jsonb not null default '{}'::jsonb,
  layer_id text not null,
  group_ref text,
  z_index integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (project_id, object_id)
);

create table if not exists public.scene_edit_assets (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  group_id text references public.course_groups(id) on delete restrict,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  scope_kind text not null check (scope_kind in ('personal', 'group', 'course')),
  kind text not null check (kind in ('model', 'texture', 'symbol')),
  storage_path text not null,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  metadata jsonb not null default '{}'::jsonb,
  license text not null default 'student-provided',
  source_asset_id uuid references public.scene_edit_assets(id) on delete restrict,
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (scope_kind = 'group' and group_id is not null)
    or (scope_kind in ('personal', 'course'))
  )
);

create table if not exists public.scene_edit_components (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  group_id text references public.course_groups(id) on delete restrict,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  scope_kind text not null check (scope_kind in ('personal', 'group', 'course')),
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  document_fragment jsonb not null,
  preview_path text,
  source_component_id uuid references public.scene_edit_components(id) on delete restrict,
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (scope_kind = 'group' and group_id is not null)
    or (scope_kind in ('personal', 'course'))
  )
);

create table if not exists public.scene_edit_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.scene_edit_projects(id) on delete restrict,
  revision bigint not null,
  label text not null check (length(trim(label)) between 1 and 40),
  description text not null default '' check (length(description) <= 500),
  document jsonb not null,
  preview_path text,
  submission_status text not null default 'milestone' check (submission_status in ('milestone', 'submitted')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (project_id, revision, label)
);

create index if not exists scene_edit_projects_scope_idx
  on public.scene_edit_projects(teaching_project_id, village_id, scope_kind, group_id, created_by, space_id, updated_at desc);
create index if not exists scene_edit_assets_scope_idx
  on public.scene_edit_assets(course_id, group_id, owner_id, scope_kind, created_at desc);
create index if not exists scene_edit_assets_storage_idx
  on public.scene_edit_assets(storage_path);
create index if not exists scene_edit_components_scope_idx
  on public.scene_edit_components(course_id, group_id, owner_id, scope_kind, created_at desc);
create index if not exists scene_edit_versions_project_idx
  on public.scene_edit_versions(project_id, created_at desc);

create or replace function public.is_scene_edit_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and coalesce(public.current_profile_role() in ('teacher', 'admin'), false);
$$;

create or replace function public.is_scene_edit_group_member(p_group_id text, p_course_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.group_memberships membership
    where membership.group_id = p_group_id
      and membership.course_id = p_course_id
      and membership.student_key = public.current_profile_student_key()
  );
$$;

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

create or replace function public.can_read_scene_edit_asset(
  p_scope_kind text,
  p_course_id text,
  p_group_id text,
  p_owner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    public.is_scene_edit_staff()
    or (p_scope_kind = 'personal' and p_owner_id = auth.uid())
    or (p_scope_kind = 'group' and public.is_scene_edit_group_member(p_group_id, p_course_id))
    or (
      p_scope_kind = 'course'
      and exists (
        select 1 from public.group_memberships membership
        where membership.course_id = p_course_id
          and membership.student_key = public.current_profile_student_key()
      )
    )
  );
$$;

revoke all on function public.is_scene_edit_staff() from public, anon;
revoke all on function public.is_scene_edit_group_member(text, text) from public, anon;
revoke all on function public.can_read_scene_edit_project(uuid) from public, anon;
revoke all on function public.can_read_scene_edit_asset(text, text, text, uuid) from public, anon;
grant execute on function public.is_scene_edit_staff() to authenticated;
grant execute on function public.is_scene_edit_group_member(text, text) to authenticated;
grant execute on function public.can_read_scene_edit_project(uuid) to authenticated;
grant execute on function public.can_read_scene_edit_asset(text, text, text, uuid) to authenticated;

alter table public.scene_edit_projects enable row level security;
alter table public.scene_edit_objects enable row level security;
alter table public.scene_edit_assets enable row level security;
alter table public.scene_edit_components enable row level security;
alter table public.scene_edit_versions enable row level security;

drop policy if exists scene_edit_projects_select_scope on public.scene_edit_projects;
create policy scene_edit_projects_select_scope on public.scene_edit_projects
for select to authenticated
using (public.can_read_scene_edit_project(id));

drop policy if exists scene_edit_objects_select_scope on public.scene_edit_objects;
create policy scene_edit_objects_select_scope on public.scene_edit_objects
for select to authenticated
using (public.can_read_scene_edit_project(project_id));

drop policy if exists scene_edit_assets_select_scope on public.scene_edit_assets;
create policy scene_edit_assets_select_scope on public.scene_edit_assets
for select to authenticated
using (public.can_read_scene_edit_asset(scope_kind, course_id, group_id, owner_id));

drop policy if exists scene_edit_components_select_scope on public.scene_edit_components;
create policy scene_edit_components_select_scope on public.scene_edit_components
for select to authenticated
using (public.can_read_scene_edit_asset(scope_kind, course_id, group_id, owner_id));

drop policy if exists scene_edit_versions_select_scope on public.scene_edit_versions;
create policy scene_edit_versions_select_scope on public.scene_edit_versions
for select to authenticated
using (public.can_read_scene_edit_project(project_id));

revoke all on table public.scene_edit_projects from anon, authenticated;
revoke all on table public.scene_edit_objects from anon, authenticated;
revoke all on table public.scene_edit_assets from anon, authenticated;
revoke all on table public.scene_edit_components from anon, authenticated;
revoke all on table public.scene_edit_versions from anon, authenticated;
grant select on table public.scene_edit_projects to authenticated;
grant select on table public.scene_edit_objects to authenticated;
grant select on table public.scene_edit_assets to authenticated;
grant select on table public.scene_edit_components to authenticated;
grant select on table public.scene_edit_versions to authenticated;

create or replace function public.scene_edit_versions_are_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.submission_status = 'milestone'
     and new.submission_status = 'submitted'
     and new.project_id is not distinct from old.project_id
     and new.revision is not distinct from old.revision
     and new.label is not distinct from old.label
     and new.description is not distinct from old.description
     and new.document is not distinct from old.document
     and new.preview_path is not distinct from old.preview_path
     and new.created_by is not distinct from old.created_by
     and new.created_at is not distinct from old.created_at then
    return new;
  end if;
  raise exception 'SCENE_EDIT_VERSION_IS_IMMUTABLE';
end;
$$;

drop trigger if exists scene_edit_versions_no_update on public.scene_edit_versions;
create trigger scene_edit_versions_no_update before update or delete on public.scene_edit_versions
for each row execute function public.scene_edit_versions_are_immutable();

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
  ) then
    raise exception 'SCENE_EDIT_FORBIDDEN';
  end if;
  insert into public.scene_edit_projects(
    teaching_project_id, village_id, space_id, group_id, scope_kind, title, baseline_revision,
    selection_boundary, layers, metadata, created_by, updated_by
  ) values (
    p_teaching_project_id, p_village_id, p_space_id, p_group_id, p_scope_kind, trim(p_title), p_baseline_revision,
    p_selection_boundary, '[{"id":"design","name":"方案要素","visible":true,"locked":false,"order":0}]'::jsonb,
    jsonb_build_object('scopeKind', p_scope_kind, 'ownerId', auth.uid()),
    auth.uid(), auth.uid()
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
    'metadata', coalesce(v_project.metadata, '{}'::jsonb) || jsonb_build_object('scopeKind', v_project.scope_kind, 'ownerId', v_project.created_by),
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
  select
    p_project_id,
    item ->> 'id',
    item ->> 'kind',
    item ->> 'category',
    item -> 'geometry',
    coalesce(item -> 'transform', '{}'::jsonb),
    coalesce(item -> 'properties', '{}'::jsonb),
    item ->> 'layerId',
    nullif(item ->> 'groupId', ''),
    coalesce((item ->> 'zIndex')::integer, 0)
  from jsonb_array_elements(coalesce(p_document -> 'objects', '[]'::jsonb)) item;

  update public.scene_edit_projects
  set selection_boundary = p_document -> 'selectionBoundary',
      layers = coalesce(p_document -> 'layers', '[]'::jsonb),
      groups = coalesce(p_document -> 'groups', '[]'::jsonb),
      asset_refs = coalesce(p_document -> 'assetRefs', '[]'::jsonb),
      metadata = coalesce(p_document -> 'metadata', '{}'::jsonb),
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
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
  v_result := public.scene_edit_create_project(v_source.teaching_project_id, v_source.village_id, v_source.space_id, v_source.group_id, p_title, p_new_baseline_revision, v_source.selection_boundary, v_source.scope_kind);
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

create or replace function public.scene_edit_create_version(
  p_project_id uuid,
  p_expected_revision bigint,
  p_label text,
  p_description text default '',
  p_preview_path text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_project public.scene_edit_projects;
  v_version public.scene_edit_versions;
begin
  select * into strict v_project from public.scene_edit_projects where id = p_project_id for update;
  if not public.can_read_scene_edit_project(p_project_id) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;
  if v_project.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'SCENE_EDIT_REVISION_CONFLICT', detail = v_project.revision::text;
  end if;
  insert into public.scene_edit_versions(project_id, revision, label, description, document, preview_path, created_by)
  values (p_project_id, v_project.revision, trim(p_label), coalesce(p_description, ''), public.scene_edit_load_project(p_project_id), p_preview_path, auth.uid())
  returning * into v_version;
  return jsonb_build_object('id', v_version.id, 'revision', v_version.revision, 'createdAt', v_version.created_at);
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
  v_created := public.scene_edit_create_project(v_source.teaching_project_id, v_source.village_id, v_source.space_id, v_source.group_id, p_title, v_source.baseline_revision, v_version.document -> 'selectionBoundary', v_source.scope_kind);
  v_project_id := (v_created ->> 'id')::uuid;
  perform public.scene_edit_save_draft(v_project_id, 0, v_version.document || jsonb_build_object('projectId', v_project_id, 'revision', 0));
  update public.scene_edit_projects set parent_project_id = v_source.id where id = v_project_id;
  return jsonb_build_object('id', v_project_id, 'revision', 1);
end;
$function$;

create or replace function public.scene_edit_submit_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_version public.scene_edit_versions;
begin
  select * into strict v_version from public.scene_edit_versions where id = p_version_id;
  if not public.can_read_scene_edit_project(v_version.project_id) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;
  update public.scene_edit_versions set submission_status = 'submitted' where id = p_version_id returning * into v_version;
  update public.scene_edit_projects set status = 'submitted', updated_by = auth.uid(), updated_at = now() where id = v_version.project_id;
  return jsonb_build_object('id', v_version.id, 'submissionStatus', v_version.submission_status);
end;
$function$;

create or replace function public.scene_edit_register_asset(
  p_course_id text,
  p_group_id text,
  p_scope_kind text,
  p_kind text,
  p_storage_path text,
  p_display_name text,
  p_mime_type text,
  p_file_size bigint,
  p_metadata jsonb default '{}'::jsonb,
  p_license text default 'student-provided'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_asset public.scene_edit_assets;
begin
  if p_scope_kind = 'group' then
    if p_group_id is null or not public.is_scene_edit_group_member(p_group_id, p_course_id)
       or p_storage_path not like 'group/' || p_group_id || '/%' then
      raise exception 'SCENE_EDIT_ASSET_SCOPE_INVALID';
    end if;
  elsif p_scope_kind = 'personal' then
    if p_storage_path not like 'personal/' || auth.uid()::text || '/%'
       or not exists (
         select 1 from public.group_memberships membership
         where membership.course_id = p_course_id
           and membership.student_key = public.current_profile_student_key()
       ) then
      raise exception 'SCENE_EDIT_ASSET_SCOPE_INVALID';
    end if;
  else
    raise exception 'SCENE_EDIT_ASSET_PUBLISH_REQUIRED';
  end if;
  insert into public.scene_edit_assets(
    course_id, group_id, owner_id, scope_kind, kind, storage_path, display_name,
    mime_type, file_size, metadata, license, created_by
  ) values (
    p_course_id, p_group_id, auth.uid(), p_scope_kind, p_kind, p_storage_path,
    trim(p_display_name), p_mime_type, p_file_size, coalesce(p_metadata, '{}'::jsonb),
    coalesce(nullif(trim(p_license), ''), 'student-provided'), auth.uid()
  ) returning * into v_asset;
  return to_jsonb(v_asset);
end;
$function$;

create or replace function public.scene_edit_update_asset_metadata(p_asset_id uuid, p_metadata jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_asset public.scene_edit_assets;
begin
  select * into strict v_asset from public.scene_edit_assets where id = p_asset_id for update;
  if v_asset.archived_at is not null or not (v_asset.owner_id = auth.uid() or public.is_scene_edit_staff()) then
    raise exception 'SCENE_EDIT_FORBIDDEN';
  end if;
  update public.scene_edit_assets set metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_asset_id returning * into v_asset;
  return to_jsonb(v_asset);
end;
$function$;

create or replace function public.scene_edit_publish_asset(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source public.scene_edit_assets;
  v_asset public.scene_edit_assets;
begin
  select * into strict v_source from public.scene_edit_assets where id = p_asset_id;
  if v_source.archived_at is not null or v_source.scope_kind = 'course'
     or not (v_source.owner_id = auth.uid() or public.is_scene_edit_staff()) then
    raise exception 'SCENE_EDIT_ASSET_PUBLISH_FORBIDDEN';
  end if;
  insert into public.scene_edit_assets(
    course_id, owner_id, scope_kind, kind, storage_path, display_name, mime_type,
    file_size, metadata, license, source_asset_id, created_by
  ) values (
    v_source.course_id, v_source.owner_id, 'course', v_source.kind, v_source.storage_path,
    v_source.display_name, v_source.mime_type, v_source.file_size, v_source.metadata,
    v_source.license, v_source.id, auth.uid()
  ) returning * into v_asset;
  return to_jsonb(v_asset);
end;
$function$;

create or replace function public.scene_edit_copy_asset(p_asset_id uuid, p_group_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source public.scene_edit_assets;
  v_asset public.scene_edit_assets;
begin
  select * into strict v_source from public.scene_edit_assets where id = p_asset_id;
  if v_source.archived_at is not null or v_source.scope_kind <> 'course'
     or not public.is_scene_edit_group_member(p_group_id, v_source.course_id) then
    raise exception 'SCENE_EDIT_ASSET_COPY_FORBIDDEN';
  end if;
  insert into public.scene_edit_assets(
    course_id, group_id, owner_id, scope_kind, kind, storage_path, display_name,
    mime_type, file_size, metadata, license, source_asset_id, created_by
  ) values (
    v_source.course_id, p_group_id, auth.uid(), 'group', v_source.kind, v_source.storage_path,
    v_source.display_name, v_source.mime_type, v_source.file_size, v_source.metadata,
    v_source.license, v_source.id, auth.uid()
  ) returning * into v_asset;
  return to_jsonb(v_asset);
end;
$function$;

create or replace function public.scene_edit_save_component(
  p_course_id text,
  p_group_id text,
  p_scope_kind text,
  p_display_name text,
  p_document_fragment jsonb,
  p_preview_path text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_component public.scene_edit_components;
begin
  if p_scope_kind = 'group' then
    if p_group_id is null or not public.is_scene_edit_group_member(p_group_id, p_course_id) then
      raise exception 'SCENE_EDIT_COMPONENT_SCOPE_INVALID';
    end if;
  elsif p_scope_kind = 'personal' then
    if not exists (
      select 1 from public.group_memberships membership
      where membership.course_id = p_course_id
        and membership.student_key = public.current_profile_student_key()
    ) then raise exception 'SCENE_EDIT_COMPONENT_SCOPE_INVALID'; end if;
  else
    raise exception 'SCENE_EDIT_COMPONENT_PUBLISH_REQUIRED';
  end if;
  insert into public.scene_edit_components(
    course_id, group_id, owner_id, scope_kind, display_name, document_fragment,
    preview_path, created_by
  ) values (
    p_course_id, p_group_id, auth.uid(), p_scope_kind, trim(p_display_name),
    p_document_fragment, p_preview_path, auth.uid()
  ) returning * into v_component;
  return to_jsonb(v_component);
end;
$function$;

create or replace function public.scene_edit_publish_component(p_component_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source public.scene_edit_components;
  v_component public.scene_edit_components;
begin
  select * into strict v_source from public.scene_edit_components where id = p_component_id;
  if v_source.archived_at is not null or v_source.scope_kind = 'course'
     or not (v_source.owner_id = auth.uid() or public.is_scene_edit_staff()) then
    raise exception 'SCENE_EDIT_COMPONENT_PUBLISH_FORBIDDEN';
  end if;
  insert into public.scene_edit_components(
    course_id, owner_id, scope_kind, display_name, document_fragment, preview_path,
    source_component_id, created_by
  ) values (
    v_source.course_id, v_source.owner_id, 'course', v_source.display_name,
    v_source.document_fragment, v_source.preview_path, v_source.id, auth.uid()
  ) returning * into v_component;
  return to_jsonb(v_component);
end;
$function$;

create or replace function public.scene_edit_copy_component(p_component_id uuid, p_group_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source public.scene_edit_components;
  v_component public.scene_edit_components;
begin
  select * into strict v_source from public.scene_edit_components where id = p_component_id;
  if v_source.archived_at is not null or v_source.scope_kind <> 'course'
     or not public.is_scene_edit_group_member(p_group_id, v_source.course_id) then
    raise exception 'SCENE_EDIT_COMPONENT_COPY_FORBIDDEN';
  end if;
  insert into public.scene_edit_components(
    course_id, group_id, owner_id, scope_kind, display_name, document_fragment,
    preview_path, source_component_id, created_by
  ) values (
    v_source.course_id, p_group_id, auth.uid(), 'group', v_source.display_name,
    v_source.document_fragment, v_source.preview_path, v_source.id, auth.uid()
  ) returning * into v_component;
  return to_jsonb(v_component);
end;
$function$;

create or replace function public.scene_edit_archive_component(p_component_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_component public.scene_edit_components;
begin
  select * into strict v_component from public.scene_edit_components where id = p_component_id for update;
  if not (v_component.owner_id = auth.uid() or public.is_scene_edit_staff()) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;
  update public.scene_edit_components set archived_at = now() where id = p_component_id returning * into v_component;
  return jsonb_build_object('id', v_component.id, 'archived', true);
end;
$function$;

create or replace function public.scene_edit_archive_asset(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_asset public.scene_edit_assets;
  referenced_by_version boolean;
begin
  select * into strict v_asset from public.scene_edit_assets where id = p_asset_id for update;
  if not (v_asset.owner_id = auth.uid() or public.is_scene_edit_staff()) then raise exception 'SCENE_EDIT_FORBIDDEN'; end if;
  select exists (
    select 1 from public.scene_edit_versions version
    where coalesce(version.document -> 'assetRefs', '[]'::jsonb) @> jsonb_build_array(p_asset_id::text)
  ) into referenced_by_version;
  update public.scene_edit_assets set archived_at = now() where id = p_asset_id;
  return jsonb_build_object('id', p_asset_id, 'archived', true, 'referenced_by_version', referenced_by_version);
end;
$function$;

revoke all on function public.scene_edit_create_project(uuid, uuid, text, text, text, bigint, jsonb, text) from public, anon;
revoke all on function public.scene_edit_load_project(uuid) from public, anon;
revoke all on function public.scene_edit_save_draft(uuid, bigint, jsonb) from public, anon;
revoke all on function public.scene_edit_branch_project(uuid, bigint, text) from public, anon;
revoke all on function public.scene_edit_create_version(uuid, bigint, text, text, text) from public, anon;
revoke all on function public.scene_edit_restore_version(uuid, text) from public, anon;
revoke all on function public.scene_edit_submit_version(uuid) from public, anon;
revoke all on function public.scene_edit_archive_asset(uuid) from public, anon;
grant execute on function public.scene_edit_create_project(uuid, uuid, text, text, text, bigint, jsonb, text) to authenticated;
grant execute on function public.scene_edit_load_project(uuid) to authenticated;
grant execute on function public.scene_edit_save_draft(uuid, bigint, jsonb) to authenticated;
grant execute on function public.scene_edit_branch_project(uuid, bigint, text) to authenticated;
grant execute on function public.scene_edit_create_version(uuid, bigint, text, text, text) to authenticated;
grant execute on function public.scene_edit_restore_version(uuid, text) to authenticated;
grant execute on function public.scene_edit_submit_version(uuid) to authenticated;
grant execute on function public.scene_edit_archive_asset(uuid) to authenticated;
revoke all on function public.scene_edit_register_asset(text, text, text, text, text, text, text, bigint, jsonb, text) from public, anon;
revoke all on function public.scene_edit_update_asset_metadata(uuid, jsonb) from public, anon;
revoke all on function public.scene_edit_publish_asset(uuid) from public, anon;
revoke all on function public.scene_edit_copy_asset(uuid, text) from public, anon;
revoke all on function public.scene_edit_save_component(text, text, text, text, jsonb, text) from public, anon;
revoke all on function public.scene_edit_publish_component(uuid) from public, anon;
revoke all on function public.scene_edit_copy_component(uuid, text) from public, anon;
revoke all on function public.scene_edit_archive_component(uuid) from public, anon;
grant execute on function public.scene_edit_register_asset(text, text, text, text, text, text, text, bigint, jsonb, text) to authenticated;
grant execute on function public.scene_edit_update_asset_metadata(uuid, jsonb) to authenticated;
grant execute on function public.scene_edit_publish_asset(uuid) to authenticated;
grant execute on function public.scene_edit_copy_asset(uuid, text) to authenticated;
grant execute on function public.scene_edit_save_component(text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.scene_edit_publish_component(uuid) to authenticated;
grant execute on function public.scene_edit_copy_component(uuid, text) to authenticated;
grant execute on function public.scene_edit_archive_component(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('scene-assets', 'scene-assets', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit)
values ('scene-version-previews', 'scene-version-previews', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists scene_assets_storage_select on storage.objects;
create policy scene_assets_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'scene-assets'
  and exists (
    select 1 from public.scene_edit_assets asset
    where asset.storage_path = storage.objects.name
      and public.can_read_scene_edit_asset(asset.scope_kind, asset.course_id, asset.group_id, asset.owner_id)
  )
);

drop policy if exists scene_assets_storage_insert on storage.objects;
create policy scene_assets_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'scene-assets'
  and (
    ((storage.foldername(name))[1] = 'personal' and (storage.foldername(name))[2] = auth.uid()::text)
    or (
      (storage.foldername(name))[1] = 'group'
      and exists (
        select 1 from public.group_memberships membership
        where membership.group_id = (storage.foldername(name))[2]
          and membership.student_key = public.current_profile_student_key()
      )
    )
  )
);

drop policy if exists scene_previews_storage_select on storage.objects;
create policy scene_previews_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'scene-version-previews'
  and exists (
    select 1 from public.scene_edit_versions version
    where version.preview_path = storage.objects.name
      and public.can_read_scene_edit_project(version.project_id)
  )
);

drop policy if exists scene_previews_storage_insert on storage.objects;
create policy scene_previews_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'scene-version-previews'
  and (storage.foldername(name))[1] = 'group'
  and exists (
    select 1 from public.group_memberships membership
    where membership.group_id = (storage.foldername(name))[2]
      and membership.student_key = public.current_profile_student_key()
  )
);
