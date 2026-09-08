begin;

-- A course is a reusable template. Each semester is a separate teaching project.
alter table public.teaching_projects
  drop constraint if exists teaching_projects_course_id_key;
create index if not exists teaching_projects_course_id_idx
  on public.teaching_projects(course_id);

-- Keep the existing invariant explicit: only one current semester is open globally.
create unique index if not exists teaching_projects_one_current_idx
  on public.teaching_projects((true))
  where stage not in ('completed', 'archived');

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
  if not found or v_project.stage in ('completed', 'archived') then raise exception 'PROJECT_NOT_AVAILABLE'; end if;
  select * into v_village from public.villages where id = p_village_id and status = 'published';
  if not found then raise exception 'VILLAGE_NOT_AVAILABLE'; end if;

  if v_village.is_practice then
    if p_space_type not in ('practice_personal', 'practice_shared') then
      raise exception 'PERSONAL_SPACE_CONTEXT_MISMATCH';
    end if;
  else
    if not v_project.formal_project_open or v_project.formal_village_id is distinct from p_village_id then
      raise exception 'VILLAGE_NOT_IN_PROJECT';
    end if;
    if p_space_type not in ('formal_personal', 'formal_shared', 'group_plan') then
      raise exception 'PERSONAL_SPACE_CONTEXT_MISMATCH';
    end if;
  end if;

  if p_space_type in ('practice_shared', 'formal_shared') and not v_is_staff then
    raise exception 'SHARED_SPACE_RPC_REQUIRED';
  end if;
  if p_space_type in ('practice_personal', 'formal_personal') then
    v_owner_id := auth.uid();
  end if;
  if p_space_type = 'group_plan' then
    if p_group_id is null then raise exception 'GROUP_REQUIRED'; end if;
    if v_project.stage <> 'design' then raise exception 'FROZEN_BASELINE_REQUIRED'; end if;
    if not v_is_staff and not exists (
      select 1 from public.group_memberships membership
      where membership.course_id = v_project.course_id
        and membership.group_id = p_group_id
        and membership.student_key = public.current_profile_student_key()
    ) then raise exception 'GROUP_ACCESS_REQUIRED'; end if;
  end if;

  select id into v_dataset_id from public.village_datasets
  where village_id = p_village_id and status = 'published'
  order by published_at desc nulls last limit 1;
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
    id, title, creator_name, created_at, readonly, edit_enabled, course_id, group_id, space_type,
    teaching_project_id, village_id, base_dataset_id, owner_id
  ) values (
    gen_random_uuid()::text,
    coalesce(nullif(trim(p_title), ''), case
      when p_space_type in ('practice_personal', 'formal_personal') then '我的个人体验空间'
      when p_space_type in ('practice_shared', 'formal_shared') then '全班共享现状空间'
      else '小组规划空间' end),
    public.current_profile_display_name(), now(), false, true, v_project.course_id,
    p_group_id, p_space_type, p_teaching_project_id, p_village_id, v_dataset_id, v_owner_id
  ) returning * into v_space;
  return v_space;
end;
$$;

create or replace function public.ensure_all_project_practice_spaces(p_project_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project public.teaching_projects;
  v_village record;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() not in ('teacher', 'admin') then raise exception 'STAFF_REQUIRED'; end if;
  select * into v_project from public.teaching_projects where id = p_project_id;
  if not found or v_project.stage in ('completed', 'archived') then raise exception 'PROJECT_NOT_AVAILABLE'; end if;

  for v_village in
    select village.id
    from public.villages village
    where village.is_practice and village.status = 'published'
    order by (village.id = v_project.practice_village_id) desc, village.name
  loop
    perform public.ensure_context_space(
      v_project.id, v_village.id, 'practice_shared', '全班共享现状空间', null
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
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
    select 1 from public.villages village
    join public.village_datasets dataset on dataset.village_id = village.id
    where village.id = p_practice_village_id and village.is_practice
      and village.status = 'published' and dataset.status = 'published'
  ) then raise exception 'PUBLISHED_PRACTICE_VILLAGE_REQUIRED'; end if;
  if exists (select 1 from public.teaching_projects where stage not in ('completed', 'archived')) then
    raise exception 'ACTIVE_PROJECT_ALREADY_EXISTS';
  end if;

  insert into public.teaching_projects(name, course_id, practice_village_id, created_by)
  values(trim(p_name), trim(p_course_id), p_practice_village_id, auth.uid())
  returning * into v_project;
  perform public.ensure_all_project_practice_spaces(v_project.id);
  return v_project;
end;
$$;

create or replace function public.publish_village_dataset(p_dataset_id uuid)
returns public.village_datasets
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_dataset public.village_datasets;
  v_is_practice boolean;
  v_project record;
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
  update public.villages set status = 'published', updated_at = now()
  where id = v_dataset.village_id returning is_practice into v_is_practice;

  if v_is_practice then
    for v_project in
      select id from public.teaching_projects where stage not in ('completed', 'archived')
    loop
      perform public.ensure_context_space(
        v_project.id, v_dataset.village_id, 'practice_shared', '全班共享现状空间', null
      );
    end loop;
  end if;
  return v_dataset;
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
        select jsonb_agg(to_jsonb(village) order by
          (village.id = project.practice_village_id) desc,
          village.is_practice desc,
          village.name)
        from public.villages village
        where (village.is_practice and village.status = 'published')
           or (project.formal_project_open
             and village.id = project.formal_village_id
             and village.status = 'published')
      ), '[]'::jsonb)
    )
    from public.teaching_projects project
    where project.stage not in ('completed', 'archived')
    order by project.created_at desc limit 1
  ) end;
$$;

create or replace function public.archive_teaching_project(p_project_id uuid)
returns public.teaching_projects
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project public.teaching_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  update public.teaching_projects
  set stage = 'archived', formal_project_open = false, updated_at = now()
  where id = p_project_id and stage <> 'archived'
  returning * into v_project;
  if not found then
    select * into v_project from public.teaching_projects where id = p_project_id;
  end if;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  return v_project;
end;
$$;

create or replace function public.village_usage_breakdown(p_village_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_row record;
  v_count bigint;
  v_total bigint := 0;
  v_tables jsonb := '{}'::jsonb;
  v_project_count bigint;
begin
  select count(*) into v_project_count
  from public.teaching_projects project
  where project.practice_village_id = p_village_id or project.formal_village_id = p_village_id;
  v_total := v_total + v_project_count;
  v_tables := v_tables || jsonb_build_object('teaching_projects', v_project_count);

  for v_row in
    select column_table.table_name
    from information_schema.columns column_table
    where column_table.table_schema = 'public'
      and column_table.column_name = 'village_id'
      and column_table.table_name not in (
        'villages', 'village_datasets', 'village_reality_models',
        'geoprocessing_villages', 'mc_sync_config', 'mc_building_state'
      )
    order by column_table.table_name
  loop
    execute format(
      'select count(*) from public.%I where village_id::text = $1',
      v_row.table_name
    ) using p_village_id::text into v_count;
    v_total := v_total + v_count;
    v_tables := v_tables || jsonb_build_object(v_row.table_name, v_count);
  end loop;
  return jsonb_build_object('total', v_total, 'tables', v_tables);
end;
$$;

create or replace function public.get_village_removal_preview(p_village_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_village public.villages;
  v_usage jsonb;
  v_dataset_count bigint;
  v_reality_count bigint;
  v_storage_paths jsonb;
  v_protected boolean;
  v_active_formal boolean;
  v_action text;
  v_reason text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_village from public.villages where id = p_village_id;
  if not found then raise exception 'VILLAGE_NOT_FOUND'; end if;

  v_protected := v_village.id = '00000000-0000-4000-8000-000000000001'::uuid;
  select exists (
    select 1 from public.teaching_projects project
    where project.formal_village_id = p_village_id
      and project.formal_project_open
      and project.stage not in ('completed', 'archived')
  ) into v_active_formal;
  v_usage := public.village_usage_breakdown(p_village_id);
  select count(*) into v_dataset_count from public.village_datasets where village_id = p_village_id;
  select count(*) into v_reality_count from public.village_reality_models where village_id = p_village_id;
  select coalesce(jsonb_agg(path order by path), '[]'::jsonb) into v_storage_paths
  from (
    select distinct format('%s/%s/%s', dataset.village_id, dataset.version_label, file_name) as path
    from public.village_datasets dataset
    cross join unnest(array[
      'boundary.geojson', 'imagery.webp', 'buildings.geojson', 'roads.geojson',
      'waterways.geojson', 'water_areas.geojson', 'water.geojson', 'contours.geojson',
      'manifest.json', 'validation.json'
    ]) file_name
    where dataset.village_id = p_village_id and dataset.source_kind = 'uploaded_bundle'
  ) paths;

  if v_protected then
    v_action := 'blocked'; v_reason := 'SYSTEM_VILLAGE_PROTECTED';
  elsif v_active_formal then
    v_action := 'blocked'; v_reason := 'ACTIVE_FORMAL_VILLAGE_REQUIRED';
  elsif coalesce((v_usage->>'total')::bigint, 0) > 0 then
    v_action := 'archive'; v_reason := 'VILLAGE_IN_USE';
  else
    v_action := 'delete'; v_reason := null;
  end if;

  return jsonb_build_object(
    'village', to_jsonb(v_village),
    'action', v_action,
    'reason', v_reason,
    'usage', v_usage,
    'dataset_count', v_dataset_count,
    'reality_model_count', v_reality_count,
    'storage_paths', v_storage_paths
  );
end;
$$;

create or replace function public.archive_village(p_village_id uuid)
returns public.villages
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_village public.villages;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  if p_village_id = '00000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'SYSTEM_VILLAGE_PROTECTED';
  end if;
  if exists (
    select 1 from public.teaching_projects project
    where project.formal_village_id = p_village_id and project.formal_project_open
      and project.stage not in ('completed', 'archived')
  ) then raise exception 'ACTIVE_FORMAL_VILLAGE_REQUIRED'; end if;
  if exists (
    select 1 from public.teaching_projects project
    where project.practice_village_id = p_village_id
      and project.stage not in ('completed', 'archived')
  ) then raise exception 'ACTIVE_DEFAULT_PRACTICE_VILLAGE'; end if;
  update public.villages set status = 'archived', updated_at = now()
  where id = p_village_id returning * into v_village;
  if not found then raise exception 'VILLAGE_NOT_FOUND'; end if;
  return v_village;
end;
$$;

create or replace function public.restore_village(p_village_id uuid)
returns public.villages
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_village public.villages;
  v_status text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  if not exists (select 1 from public.villages where id = p_village_id and status = 'archived') then
    raise exception 'ARCHIVED_VILLAGE_REQUIRED';
  end if;
  select case
    when exists (select 1 from public.village_datasets where village_id = p_village_id and status = 'published') then 'published'
    when exists (select 1 from public.village_datasets where village_id = p_village_id and status = 'ready') then 'data_ready'
    else 'draft'
  end into v_status;
  update public.villages set status = v_status, updated_at = now()
  where id = p_village_id returning * into v_village;
  return v_village;
end;
$$;

create or replace function public.delete_unused_village(p_village_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_usage jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_profile_role() <> 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  if p_village_id = '00000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'SYSTEM_VILLAGE_PROTECTED';
  end if;
  if not exists (select 1 from public.villages where id = p_village_id for update) then
    raise exception 'VILLAGE_NOT_FOUND';
  end if;
  v_usage := public.village_usage_breakdown(p_village_id);
  if coalesce((v_usage->>'total')::bigint, 0) > 0 then raise exception 'VILLAGE_IN_USE'; end if;

  if to_regclass('public.mc_building_state') is not null then
    execute 'delete from public.mc_building_state where village_id::text = $1' using p_village_id::text;
  end if;
  if to_regclass('public.mc_sync_config') is not null then
    execute 'delete from public.mc_sync_config where village_id::text = $1' using p_village_id::text;
  end if;
  if to_regclass('public.geoprocessing_villages') is not null then
    execute 'delete from public.geoprocessing_villages where village_id::text = $1' using p_village_id::text;
  end if;
  delete from public.village_reality_models where village_id = p_village_id;
  delete from public.village_datasets where village_id = p_village_id;
  delete from public.villages where id = p_village_id;
  return p_village_id;
exception when foreign_key_violation then
  raise exception 'VILLAGE_IN_USE';
end;
$$;

-- Backfill shared practice spaces for the current semester without requiring an auth context.
insert into public.planning_spaces(
  id, title, creator_name, created_at, readonly, edit_enabled, course_id, group_id,
  space_type, teaching_project_id, village_id, base_dataset_id, owner_id
)
select gen_random_uuid()::text, '全班共享现状空间', '管理员', now(), false, true,
  project.course_id, null, 'practice_shared', project.id, village.id, dataset.id, null
from public.teaching_projects project
cross join public.villages village
join public.village_datasets dataset on dataset.village_id = village.id and dataset.status = 'published'
where project.stage not in ('completed', 'archived')
  and village.is_practice and village.status = 'published'
  and not exists (
    select 1 from public.planning_spaces space
    where space.teaching_project_id = project.id and space.village_id = village.id
      and space.space_type = 'practice_shared'
  );

alter function public.ensure_context_space(uuid,uuid,text,text,text) set search_path = public, pg_temp;
alter function public.ensure_all_project_practice_spaces(uuid) set search_path = public, pg_temp;
alter function public.create_teaching_project(text,text,uuid) set search_path = public, pg_temp;
alter function public.publish_village_dataset(uuid) set search_path = public, pg_temp;
alter function public.get_active_project_context() set search_path = public, pg_temp;
alter function public.archive_teaching_project(uuid) set search_path = public, pg_temp;
alter function public.village_usage_breakdown(uuid) set search_path = public, pg_catalog, pg_temp;
alter function public.get_village_removal_preview(uuid) set search_path = public, pg_temp;
alter function public.archive_village(uuid) set search_path = public, pg_temp;
alter function public.restore_village(uuid) set search_path = public, pg_temp;
alter function public.delete_unused_village(uuid) set search_path = public, pg_temp;

revoke all on function public.ensure_all_project_practice_spaces(uuid) from public, anon, authenticated;
revoke all on function public.archive_teaching_project(uuid) from public, anon, authenticated;
revoke all on function public.village_usage_breakdown(uuid) from public, anon, authenticated;
revoke all on function public.get_village_removal_preview(uuid) from public, anon, authenticated;
revoke all on function public.archive_village(uuid) from public, anon, authenticated;
revoke all on function public.restore_village(uuid) from public, anon, authenticated;
revoke all on function public.delete_unused_village(uuid) from public, anon, authenticated;

grant execute on function public.ensure_all_project_practice_spaces(uuid) to authenticated;
grant execute on function public.archive_teaching_project(uuid) to authenticated;
grant execute on function public.get_village_removal_preview(uuid) to authenticated;
grant execute on function public.archive_village(uuid) to authenticated;
grant execute on function public.restore_village(uuid) to authenticated;
grant execute on function public.delete_unused_village(uuid) to authenticated;

commit;
