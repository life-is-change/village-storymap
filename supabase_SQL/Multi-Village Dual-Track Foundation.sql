-- 多村庄双轨空间体系：第一阶段基础表、上下文列、RLS 与受控 RPC。
-- 本文件可重复执行。旧米埗村数据的赋值迁移在后续段落追加；在补齐前新增上下文列保持 nullable。

create extension if not exists pgcrypto;
create extension if not exists postgis;

create table if not exists public.villages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  is_practice boolean not null default false,
  boundary geometry(MultiPolygon, 4326) not null,
  default_crs text not null default 'EPSG:4326' check (length(trim(default_crs)) between 4 and 40),
  status text not null default 'draft'
    check (status in ('draft', 'data_preparing', 'data_ready', 'published', 'archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.village_datasets (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  version_label text not null check (length(trim(version_label)) between 1 and 80),
  source_kind text not null check (source_kind in ('platform_generated', 'uploaded_bundle')),
  imagery_config jsonb,
  layer_manifest jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'validating', 'ready', 'published', 'failed')),
  validation_summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (village_id, version_number)
);

create unique index if not exists village_datasets_one_published_idx
  on public.village_datasets(village_id) where status = 'published';

create table if not exists public.teaching_projects (
  id uuid primary key default gen_random_uuid(),
  course_id text unique references public.courses(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 100),
  practice_village_id uuid not null references public.villages(id) on delete restrict,
  formal_village_id uuid references public.villages(id) on delete restrict,
  formal_project_open boolean not null default false,
  stage text not null default 'preparing'
    check (stage in ('preparing', 'survey', 'design', 'completed', 'archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (formal_village_id is not null or not formal_project_open)
);

create unique index if not exists teaching_projects_one_current_idx
  on public.teaching_projects((true)) where stage not in ('completed', 'archived');

create table if not exists public.village_reality_models (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id) on delete cascade,
  ion_asset_id bigint not null check (ion_asset_id > 0),
  title text not null check (length(trim(title)) between 1 and 100),
  height_offset double precision not null default 0 check (height_offset between -1000 and 1000),
  terrain_enabled boolean not null default true,
  status text not null default 'draft'
    check (status in ('draft', 'validating', 'ready', 'published', 'disabled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create unique index if not exists village_reality_models_one_published_idx
  on public.village_reality_models(village_id) where status = 'published';

alter table public.planning_spaces
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict,
  add column if not exists base_dataset_id uuid references public.village_datasets(id) on delete restrict,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.planning_features
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict;

alter table public.object_photos
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict,
  add column if not exists space_id text;

alter table public.community_tasks
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict;

alter table public.object_comments
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict,
  add column if not exists space_id text;

alter table public.object_attribute_edits
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict,
  add column if not exists space_id text;

alter table public.feature_change_batches
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict;

alter table public.feature_versions
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict;

alter table public.feature_snapshots
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict;

alter table public.activity_events
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict;

create index if not exists planning_spaces_context_idx
  on public.planning_spaces(teaching_project_id, village_id, space_type);
create unique index if not exists planning_spaces_context_identity_idx
  on public.planning_spaces(
    teaching_project_id,
    village_id,
    space_type,
    coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(group_id, '')
  ) where teaching_project_id is not null and village_id is not null;
create index if not exists planning_features_context_idx
  on public.planning_features(teaching_project_id, village_id, space_id, layer_key);
create index if not exists object_photos_context_idx
  on public.object_photos(teaching_project_id, village_id, space_id, object_type, object_code);
create index if not exists community_tasks_context_idx
  on public.community_tasks(teaching_project_id, village_id, space_id, created_at desc);
create index if not exists object_comments_context_idx
  on public.object_comments(teaching_project_id, village_id, space_id, object_type, object_code);
create index if not exists object_attribute_edits_context_idx
  on public.object_attribute_edits(teaching_project_id, village_id, space_id, object_type, object_code);
-- 旧版全局唯一约束会阻止不同村庄保存同名对象讨论/属性；上下文数据使用组合唯一键。
drop index if exists public.object_attribute_edits_code_type_idx;
create unique index if not exists object_attribute_edits_context_identity_idx
  on public.object_attribute_edits(teaching_project_id, village_id, space_id, object_code, object_type)
  where teaching_project_id is not null and village_id is not null and space_id is not null;
create index if not exists feature_change_batches_context_idx
  on public.feature_change_batches(teaching_project_id, village_id, space_id, created_at desc);
create index if not exists feature_versions_context_idx
  on public.feature_versions(teaching_project_id, village_id, space_id, created_at desc);
create index if not exists feature_snapshots_context_idx
  on public.feature_snapshots(teaching_project_id, village_id, space_id, created_at desc);
create index if not exists activity_events_context_idx
  on public.activity_events(teaching_project_id, village_id, space_id, occurred_at desc);

alter table public.villages enable row level security;
alter table public.village_datasets enable row level security;
alter table public.teaching_projects enable row level security;
alter table public.village_reality_models enable row level security;

drop policy if exists villages_read_available on public.villages;
create policy villages_read_available on public.villages
for select to authenticated using (
  status = 'published' or public.current_profile_role() in ('teacher', 'admin')
);

drop policy if exists village_datasets_read_available on public.village_datasets;
create policy village_datasets_read_available on public.village_datasets
for select to authenticated using (
  status = 'published' or public.current_profile_role() in ('teacher', 'admin')
);

drop policy if exists teaching_projects_read_available on public.teaching_projects;
create policy teaching_projects_read_available on public.teaching_projects
for select to authenticated using (
  stage <> 'archived' or public.current_profile_role() in ('teacher', 'admin')
);

drop policy if exists village_reality_models_read_available on public.village_reality_models;
create policy village_reality_models_read_available on public.village_reality_models
for select to authenticated using (
  status = 'published' or public.current_profile_role() in ('teacher', 'admin')
);

revoke all on public.villages, public.village_datasets, public.teaching_projects,
  public.village_reality_models from public, anon, authenticated;
grant select on public.villages, public.village_datasets, public.teaching_projects,
  public.village_reality_models to authenticated;

create or replace function public.create_village_draft(
  p_name text,
  p_is_practice boolean,
  p_boundary jsonb,
  p_default_crs text default 'EPSG:4326'
) returns public.villages
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_village public.villages;
  v_boundary geometry;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'VILLAGE_NAME_REQUIRED'; end if;
  if p_boundary is null then raise exception 'VILLAGE_BOUNDARY_REQUIRED'; end if;

  begin
    v_boundary := st_multi(st_setsrid(st_geomfromgeojson(p_boundary::text), 4326));
  exception when others then
    raise exception 'INVALID_VILLAGE_BOUNDARY';
  end;
  if geometrytype(v_boundary) <> 'MULTIPOLYGON' or st_isempty(v_boundary) or not st_isvalid(v_boundary) then
    raise exception 'INVALID_VILLAGE_BOUNDARY';
  end if;

  insert into public.villages(name, is_practice, boundary, default_crs, status, created_by)
  values(trim(p_name), coalesce(p_is_practice, false), v_boundary,
         coalesce(nullif(trim(p_default_crs), ''), 'EPSG:4326'), 'draft', auth.uid())
  returning * into v_village;
  return v_village;
end;
$$;

create or replace function public.publish_village_dataset(p_dataset_id uuid)
returns public.village_datasets
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_dataset public.village_datasets;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_dataset from public.village_datasets where id = p_dataset_id for update;
  if not found then raise exception 'DATASET_NOT_FOUND'; end if;
  if v_dataset.status not in ('ready', 'published') then raise exception 'DATASET_NOT_READY'; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_dataset.layer_manifest->'layers', '[]'::jsonb)) layer
    where layer->>'type' in ('building', 'buildings')
      and coalesce((layer->>'featureCount')::integer, (layer->>'feature_count')::integer, 0) > 0
  ) then raise exception 'BUILDINGS_REQUIRED'; end if;

  update public.village_datasets set status = 'ready', published_at = null
  where village_id = v_dataset.village_id and status = 'published' and id <> v_dataset.id;
  update public.village_datasets set status = 'published', published_at = coalesce(published_at, now())
  where id = v_dataset.id returning * into v_dataset;
  update public.villages set status = 'published', updated_at = now() where id = v_dataset.village_id;
  return v_dataset;
end;
$$;

create or replace function public.save_village_dataset_draft(
  p_village_id uuid,
  p_source_kind text,
  p_imagery_config jsonb,
  p_layer_manifest jsonb,
  p_validation_summary jsonb default '{}'::jsonb,
  p_status text default 'draft',
  p_dataset_id uuid default null,
  p_version_label text default null
) returns public.village_datasets
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_dataset public.village_datasets;
  v_version integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  if not exists (select 1 from public.villages where id = p_village_id and status <> 'archived') then
    raise exception 'VILLAGE_NOT_AVAILABLE';
  end if;
  if p_source_kind not in ('platform_generated', 'uploaded_bundle') then raise exception 'INVALID_SOURCE_KIND'; end if;
  if jsonb_typeof(p_layer_manifest) <> 'object' then raise exception 'INVALID_LAYER_MANIFEST'; end if;
  if p_layer_manifest::text ~* 'https?://' then raise exception 'ARBITRARY_DATASET_URL_FORBIDDEN'; end if;
  if p_status not in ('draft', 'validating', 'ready', 'failed') then raise exception 'INVALID_DATASET_STATUS'; end if;
  if p_status = 'ready' and coalesce((p_validation_summary->>'valid')::boolean, false) is not true then
    raise exception 'DATASET_VALIDATION_REQUIRED';
  end if;

  if p_dataset_id is null then
    perform pg_advisory_xact_lock(hashtextextended(p_village_id::text, 0));
    select coalesce(max(version_number), 0) + 1 into v_version
    from public.village_datasets where village_id = p_village_id;
    insert into public.village_datasets(
      village_id, version_number, version_label, source_kind, imagery_config,
      layer_manifest, validation_summary, status, created_by
    ) values (
      p_village_id, v_version, coalesce(nullif(trim(p_version_label), ''), 'V' || v_version),
      p_source_kind, p_imagery_config, p_layer_manifest, coalesce(p_validation_summary, '{}'::jsonb),
      p_status, auth.uid()
    ) returning * into v_dataset;
  else
    update public.village_datasets set
      source_kind = p_source_kind,
      imagery_config = p_imagery_config,
      layer_manifest = p_layer_manifest,
      validation_summary = coalesce(p_validation_summary, '{}'::jsonb),
      status = p_status,
      version_label = coalesce(nullif(trim(p_version_label), ''), version_label)
    where id = p_dataset_id and village_id = p_village_id and status <> 'published'
    returning * into v_dataset;
    if not found then raise exception 'EDITABLE_DATASET_DRAFT_REQUIRED'; end if;
  end if;
  update public.villages set status = case
    when p_status = 'ready' then 'data_ready'
    when p_status = 'validating' then 'data_preparing'
    else status end,
    updated_at = now()
  where id = p_village_id;
  return v_dataset;
end;
$$;

create or replace function public.create_teaching_project(
  p_name text,
  p_course_id text,
  p_practice_village_id uuid
) returns public.teaching_projects
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project public.teaching_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'PROJECT_NAME_REQUIRED'; end if;
  if not exists (select 1 from public.courses where id = p_course_id) then raise exception 'COURSE_REQUIRED'; end if;
  if not exists (
    select 1 from public.villages v join public.village_datasets d on d.village_id = v.id
    where v.id = p_practice_village_id and v.is_practice and v.status = 'published' and d.status = 'published'
  ) then raise exception 'PUBLISHED_PRACTICE_VILLAGE_REQUIRED'; end if;
  if exists (select 1 from public.teaching_projects where stage not in ('completed', 'archived')) then
    raise exception 'ACTIVE_PROJECT_ALREADY_EXISTS';
  end if;
  insert into public.teaching_projects(name, course_id, practice_village_id, created_by)
  values(trim(p_name), trim(p_course_id), p_practice_village_id, auth.uid())
  returning * into v_project;
  perform public.ensure_project_practice_space(v_project.id);
  return v_project;
end;
$$;

create or replace function public.ensure_context_space(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_type text,
  p_title text default null,
  p_group_id text default null
) returns public.planning_spaces
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project public.teaching_projects;
  v_village public.villages;
  v_dataset_id uuid;
  v_owner_id uuid;
  v_space public.planning_spaces;
  v_is_staff boolean := public.current_profile_role() in ('teacher', 'admin');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_project from public.teaching_projects where id = p_teaching_project_id;
  if not found or v_project.stage = 'archived' then raise exception 'PROJECT_NOT_AVAILABLE'; end if;
  select * into v_village from public.villages where id = p_village_id and status = 'published';
  if not found then raise exception 'VILLAGE_NOT_AVAILABLE'; end if;
  if p_village_id <> v_project.practice_village_id
     and (v_project.formal_village_id is null or p_village_id <> v_project.formal_village_id) then
    raise exception 'VILLAGE_NOT_IN_PROJECT';
  end if;
  if p_space_type not in ('practice_personal', 'practice_shared', 'formal_personal', 'formal_shared', 'group_plan') then
    raise exception 'INVALID_SPACE_TYPE';
  end if;
  if p_village_id = v_project.practice_village_id and p_space_type not in ('practice_personal', 'practice_shared') then
    raise exception 'PERSONAL_SPACE_CONTEXT_MISMATCH';
  end if;
  if p_village_id = v_project.formal_village_id and p_space_type not in ('formal_personal', 'formal_shared', 'group_plan') then
    raise exception 'PERSONAL_SPACE_CONTEXT_MISMATCH';
  end if;
  if p_space_type in ('practice_shared', 'formal_shared') and not v_is_staff then
    raise exception 'SHARED_SPACE_RPC_REQUIRED';
  end if;
  if p_space_type in ('practice_personal', 'formal_personal') then
    v_owner_id := auth.uid();
  end if;
  if p_space_type = 'group_plan' then
    if p_group_id is null then raise exception 'GROUP_REQUIRED'; end if;
    if v_project.stage not in ('design', 'completed') then raise exception 'FROZEN_BASELINE_REQUIRED'; end if;
    if not v_is_staff and not exists (
      select 1 from public.group_memberships membership
      where membership.course_id = v_project.course_id
        and membership.group_id = p_group_id
        and membership.student_key = public.current_profile_student_key()
    ) then raise exception 'GROUP_ACCESS_REQUIRED'; end if;
  end if;

  select id into v_dataset_id from public.village_datasets
  where village_id = p_village_id and status = 'published';
  if v_dataset_id is null then raise exception 'PUBLISHED_DATASET_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_teaching_project_id, p_village_id, p_space_type, v_owner_id, p_group_id), 0
  ));
  select * into v_space from public.planning_spaces
  where teaching_project_id = p_teaching_project_id and village_id = p_village_id
    and space_type = p_space_type and owner_id is not distinct from v_owner_id
    and group_id is not distinct from p_group_id;
  if found then return v_space; end if;

  insert into public.planning_spaces(
    id, title, creator_name, readonly, edit_enabled, course_id, group_id, space_type,
    teaching_project_id, village_id, base_dataset_id, owner_id
  ) values (
    gen_random_uuid()::text,
    coalesce(nullif(trim(p_title), ''), case
      when p_space_type in ('practice_personal', 'formal_personal') then '我的个人体验空间'
      when p_space_type in ('practice_shared', 'formal_shared') then '全班共享现状空间'
      else '小组规划空间' end),
    public.current_profile_display_name(),
    false, true, v_project.course_id, p_group_id, p_space_type,
    p_teaching_project_id, p_village_id, v_dataset_id, v_owner_id
  ) returning * into v_space;
  return v_space;
end;
$$;

create or replace function public.ensure_project_practice_space(p_project_id uuid)
returns public.planning_spaces
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project public.teaching_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() not in ('teacher', 'admin') then raise exception 'STAFF_REQUIRED'; end if;
  select * into v_project from public.teaching_projects where id = p_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  return public.ensure_context_space(
    v_project.id, v_project.practice_village_id, 'practice_shared', '全班共享现状空间', null
  );
end;
$$;

create or replace function public.bind_formal_village(
  p_teaching_project_id uuid,
  p_village_id uuid
) returns public.teaching_projects
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project public.teaching_projects;
  v_has_student_data boolean := false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_teaching_project_id::text, 0));
  select * into v_project from public.teaching_projects where id = p_teaching_project_id for update;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.villages v join public.village_datasets d on d.village_id = v.id
    where v.id = p_village_id and not v.is_practice and v.status = 'published' and d.status = 'published'
  ) then raise exception 'PUBLISHED_DATASET_REQUIRED'; end if;

  if v_project.formal_village_id is not null and v_project.formal_village_id <> p_village_id then
    select exists (
      select 1 from public.planning_features f join public.planning_spaces s on s.id = f.space_id
      where s.teaching_project_id = v_project.id and s.village_id = v_project.formal_village_id
    ) or exists (
      select 1 from public.course_personal_spaces s
      where s.course_id = v_project.course_id and s.village_id = v_project.formal_village_id::text
    ) into v_has_student_data;
    if v_project.formal_project_open and v_has_student_data then
      raise exception 'FORMAL_VILLAGE_LOCKED';
    end if;
  end if;

  update public.teaching_projects set formal_village_id = p_village_id,
    formal_project_open = true, updated_at = now()
  where id = v_project.id returning * into v_project;
  perform public.ensure_context_space(v_project.id, p_village_id, 'formal_shared', '全班共享现状空间', null);
  return v_project;
end;
$$;

create or replace function public.publish_village_reality_model(p_model_id uuid)
returns public.village_reality_models
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_model public.village_reality_models;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_model from public.village_reality_models where id = p_model_id for update;
  if not found then raise exception 'REALITY_MODEL_NOT_FOUND'; end if;
  if v_model.status not in ('ready', 'published') then raise exception 'REALITY_MODEL_NOT_READY'; end if;
  update public.village_reality_models set status = 'disabled'
  where village_id = v_model.village_id and status = 'published' and id <> v_model.id;
  update public.village_reality_models set status = 'published', published_at = coalesce(published_at, now())
  where id = v_model.id returning * into v_model;
  return v_model;
end;
$$;

create or replace function public.save_village_reality_model_draft(
  p_village_id uuid,
  p_ion_asset_id bigint,
  p_title text,
  p_height_offset double precision default 0,
  p_terrain_enabled boolean default true,
  p_status text default 'draft',
  p_model_id uuid default null
) returns public.village_reality_models
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_model public.village_reality_models;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  if not exists (select 1 from public.villages where id = p_village_id and status = 'published') then
    raise exception 'PUBLISHED_VILLAGE_REQUIRED';
  end if;
  if p_ion_asset_id is null or p_ion_asset_id <= 0 then raise exception 'INVALID_ION_ASSET_ID'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'REALITY_MODEL_TITLE_REQUIRED'; end if;
  if p_height_offset not between -1000 and 1000 then raise exception 'INVALID_HEIGHT_OFFSET'; end if;
  if p_status not in ('draft', 'validating', 'ready') then raise exception 'INVALID_REALITY_MODEL_STATUS'; end if;

  if p_model_id is null then
    insert into public.village_reality_models(
      village_id, ion_asset_id, title, height_offset, terrain_enabled, status, created_by
    ) values (
      p_village_id, p_ion_asset_id, trim(p_title), p_height_offset,
      coalesce(p_terrain_enabled, true), p_status, auth.uid()
    ) returning * into v_model;
  else
    update public.village_reality_models set
      ion_asset_id = p_ion_asset_id,
      title = trim(p_title),
      height_offset = p_height_offset,
      terrain_enabled = coalesce(p_terrain_enabled, true),
      status = p_status
    where id = p_model_id and village_id = p_village_id and status <> 'published'
    returning * into v_model;
    if not found then raise exception 'EDITABLE_REALITY_MODEL_DRAFT_REQUIRED'; end if;
  end if;
  return v_model;
end;
$$;

create or replace function public.get_active_project_context()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when auth.uid() is null then null else (
    select jsonb_build_object(
      'project', to_jsonb(project),
      'villages', coalesce((
        select jsonb_agg(to_jsonb(village) order by village.is_practice, village.name)
        from public.villages village
        where village.id in (project.practice_village_id, project.formal_village_id)
          and (village.status = 'published' or public.current_profile_role() in ('teacher', 'admin'))
      ), '[]'::jsonb)
    )
    from public.teaching_projects project
    where project.stage not in ('completed', 'archived')
    order by project.created_at desc limit 1
  ) end;
$$;

alter function public.create_village_draft(text, boolean, jsonb, text) set search_path = public, extensions, pg_temp;
alter function public.create_teaching_project(text, text, uuid) set search_path = public, pg_temp;
alter function public.save_village_dataset_draft(uuid, text, jsonb, jsonb, jsonb, text, uuid, text) set search_path = public, pg_temp;
alter function public.publish_village_dataset(uuid) set search_path = public, pg_temp;
alter function public.bind_formal_village(uuid, uuid) set search_path = public, pg_temp;
alter function public.ensure_context_space(uuid, uuid, text, text, text) set search_path = public, pg_temp;
alter function public.ensure_project_practice_space(uuid) set search_path = public, pg_temp;
alter function public.save_village_reality_model_draft(uuid, bigint, text, double precision, boolean, text, uuid) set search_path = public, pg_temp;
alter function public.publish_village_reality_model(uuid) set search_path = public, pg_temp;
alter function public.get_active_project_context() set search_path = public, pg_temp;

revoke all on function public.create_village_draft(text, boolean, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_teaching_project(text, text, uuid) from public, anon, authenticated;
revoke all on function public.save_village_dataset_draft(uuid, text, jsonb, jsonb, jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function public.publish_village_dataset(uuid) from public, anon, authenticated;
revoke all on function public.bind_formal_village(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ensure_context_space(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.ensure_project_practice_space(uuid) from public, anon, authenticated;
revoke all on function public.save_village_reality_model_draft(uuid, bigint, text, double precision, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.publish_village_reality_model(uuid) from public, anon, authenticated;
revoke all on function public.get_active_project_context() from public, anon, authenticated;

grant execute on function public.create_village_draft(text, boolean, jsonb, text) to authenticated;
grant execute on function public.create_teaching_project(text, text, uuid) to authenticated;
grant execute on function public.save_village_dataset_draft(uuid, text, jsonb, jsonb, jsonb, text, uuid, text) to authenticated;
grant execute on function public.publish_village_dataset(uuid) to authenticated;
grant execute on function public.bind_formal_village(uuid, uuid) to authenticated;
grant execute on function public.ensure_context_space(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.ensure_project_practice_space(uuid) to authenticated;
grant execute on function public.save_village_reality_model_draft(uuid, bigint, text, double precision, boolean, text, uuid) to authenticated;
grant execute on function public.publish_village_reality_model(uuid) to authenticated;
grant execute on function public.get_active_project_context() to authenticated;

-- 当届米埗村与旧数据的一次性、可重入归属迁移。稳定 ID 只用于内置练习实例。
alter table public.course_personal_spaces
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists context_space_type text
    check (context_space_type in ('practice_personal', 'formal_personal'));
create index if not exists course_personal_spaces_project_context_idx
  on public.course_personal_spaces(teaching_project_id, village_id, owner_id);

create or replace function public.ensure_course_personal_space(
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
  on conflict(owner_id, course_id, village_id, space_type) do update set
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
revoke all on function public.ensure_course_personal_space(text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.ensure_course_personal_space(text,uuid,text,text,text) to authenticated;

do $$
declare
  v_admin_id uuid;
  v_mibu_id constant uuid := '00000000-0000-4000-8000-000000000001';
  v_dataset_id constant uuid := '00000000-0000-4000-8000-000000000002';
  v_project_id constant uuid := '00000000-0000-4000-8000-000000000003';
  v_reality_id constant uuid := '00000000-0000-4000-8000-000000000004';
  v_before bigint;
  v_after bigint;
begin
  select id into v_admin_id from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin_id is null then raise exception 'MIBU_SEED_ADMIN_REQUIRED'; end if;

  insert into public.villages(id, name, is_practice, boundary, default_crs, status, created_by)
  values(
    v_mibu_id, '米埗村', true,
    st_multi(st_makeenvelope(113.6578225, 23.6739555, 113.6695615, 23.6806181, 4326)),
    'EPSG:4326', 'published', v_admin_id
  ) on conflict(id) do update set name=excluded.name, is_practice=true,
    boundary=excluded.boundary, default_crs=excluded.default_crs;

  insert into public.village_datasets(
    id, village_id, version_number, version_label, source_kind, imagery_config,
    layer_manifest, status, validation_summary, created_by, published_at
  ) values (
    v_dataset_id, v_mibu_id, 1, 'V0', 'uploaded_bundle',
    jsonb_build_object('kind', 'legacy_mibu_imagery'),
    jsonb_build_object('layers', jsonb_build_array(
      jsonb_build_object('type', 'buildings', 'featureCount', 210),
      jsonb_build_object('type', 'roads'), jsonb_build_object('type', 'water'),
      jsonb_build_object('type', 'contours')
    )),
    'published', jsonb_build_object('valid', true, 'migration', 'legacy_mibu_v0'),
    v_admin_id, now()
  ) on conflict(village_id, version_number) do update set
    status='published', validation_summary=excluded.validation_summary, published_at=coalesce(public.village_datasets.published_at, now());

  insert into public.teaching_projects(
    id, course_id, name, practice_village_id, stage, created_by
  ) values (
    v_project_id, 'mibu-village-planning', '米埗村规划实践（当届）', v_mibu_id, 'preparing', v_admin_id
  ) on conflict(course_id) do update set name=excluded.name, practice_village_id=excluded.practice_village_id;

  insert into public.village_reality_models(
    id, village_id, ion_asset_id, title, height_offset, terrain_enabled,
    status, created_by, published_at
  ) values (
    v_reality_id, v_mibu_id, 5133927, '米埗村实景模型', 0, true,
    'published', v_admin_id, now()
  ) on conflict(village_id) where status = 'published' do update set
    ion_asset_id = excluded.ion_asset_id,
    title = excluded.title,
    height_offset = excluded.height_offset,
    terrain_enabled = excluded.terrain_enabled,
    published_at = coalesce(public.village_reality_models.published_at, now());

  select count(*) into v_before from public.planning_spaces where teaching_project_id is null;
  insert into public.planning_spaces(
    id, title, creator_name, created_at, readonly, edit_enabled, expanded,
    selected_layers, basemap_visible, view_mode, course_id, space_type,
    teaching_project_id, village_id, base_dataset_id
  ) values (
    'practice-shared-00000000-0000-4000-8000-000000000003', '全班共享现状空间',
    '管理员', now(), false, true, true, '["building","road","water","contours"]'::jsonb,
    true, '2d', 'mibu-village-planning', 'practice_shared', v_project_id, v_mibu_id, v_dataset_id
  ) on conflict(id) do update set teaching_project_id=excluded.teaching_project_id,
    village_id=excluded.village_id, base_dataset_id=excluded.base_dataset_id,
    space_type='practice_shared' where public.planning_spaces.teaching_project_id is null;

  update public.planning_features set teaching_project_id=v_project_id, village_id=v_mibu_id
  where teaching_project_id is null and village_id is null;
  update public.course_personal_spaces set teaching_project_id=v_project_id,
    context_space_type='practice_personal'
  where teaching_project_id is null and village_id='mibu';
  select count(*) into v_after from public.planning_spaces where teaching_project_id is null;
  if v_after > v_before then raise exception 'MIBU_MIGRATION_COUNT_ASSERTION_FAILED'; end if;
end;
$$;
