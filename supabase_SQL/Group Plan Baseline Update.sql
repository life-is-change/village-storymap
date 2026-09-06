begin;

create extension if not exists pgcrypto;

alter table public.planning_features
  add column if not exists operation_kind text,
  add column if not exists base_object_code text,
  add column if not exists base_snapshot_id uuid references public.feature_snapshots(id) on delete restrict,
  add column if not exists feature_revision bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.planning_features'::regclass
      and conname = 'planning_features_operation_kind_check'
  ) then
    alter table public.planning_features
      add constraint planning_features_operation_kind_check
      check (operation_kind is null or operation_kind in ('added', 'updated', 'deleted'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.planning_features'::regclass
      and conname = 'planning_features_feature_revision_check'
  ) then
    alter table public.planning_features
      add constraint planning_features_feature_revision_check
      check (feature_revision >= 0);
  end if;
end;
$$;

create unique index if not exists planning_spaces_one_group_plan_uidx
  on public.planning_spaces(teaching_project_id, village_id, group_id)
  where space_type = 'group_plan' and group_id is not null;

create index if not exists planning_features_group_override_idx
  on public.planning_features(space_id, layer_key, base_object_code, feature_revision desc)
  where operation_kind is not null;

create table if not exists public.group_baseline_updates (
  id uuid primary key default gen_random_uuid(),
  teaching_project_id uuid not null references public.teaching_projects(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete restrict,
  space_id text not null references public.planning_spaces(id) on delete cascade,
  group_id text not null references public.course_groups(id) on delete restrict,
  from_snapshot_id uuid not null references public.feature_snapshots(id) on delete restrict,
  to_snapshot_id uuid not null references public.feature_snapshots(id) on delete restrict,
  status text not null check (status in ('running', 'completed', 'failed', 'restored')),
  stats jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.group_baseline_conflicts (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.group_baseline_updates(id) on delete cascade,
  teaching_project_id uuid not null references public.teaching_projects(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete restrict,
  space_id text not null references public.planning_spaces(id) on delete cascade,
  group_id text not null references public.course_groups(id) on delete restrict,
  layer_key text not null check (layer_key in ('building', 'road', 'water')),
  object_code text not null,
  conflict_type text not null check (conflict_type in ('both_changed', 'baseline_deleted', 'code_collision')),
  baseline_change jsonb not null default '{}'::jsonb,
  group_change jsonb not null default '{}'::jsonb,
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved', 'resolved')),
  resolution_payload jsonb,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.group_plan_restore_points (
  id uuid primary key default gen_random_uuid(),
  teaching_project_id uuid not null references public.teaching_projects(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete restrict,
  space_id text not null references public.planning_spaces(id) on delete cascade,
  group_id text not null references public.course_groups(id) on delete restrict,
  baseline_snapshot_id uuid not null references public.feature_snapshots(id) on delete restrict,
  overrides jsonb not null default '[]'::jsonb,
  source_update_id uuid references public.group_baseline_updates(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists group_baseline_updates_space_created_idx
  on public.group_baseline_updates(space_id, created_at desc);

create index if not exists group_baseline_conflicts_update_status_idx
  on public.group_baseline_conflicts(update_id, resolution_status);

create index if not exists group_baseline_conflicts_object_idx
  on public.group_baseline_conflicts(space_id, layer_key, object_code);

create index if not exists group_plan_restore_points_space_created_idx
  on public.group_plan_restore_points(space_id, created_at desc);

create or replace function public.is_group_plan_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_profile_role() in ('teacher', 'admin'), false);
$$;

create or replace function public.is_group_plan_member(p_space_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.planning_spaces space
    join public.teaching_projects project
      on project.id = space.teaching_project_id
    join public.group_memberships membership
      on membership.course_id = project.course_id
     and membership.group_id = space.group_id
    where space.id = p_space_id
      and space.space_type = 'group_plan'
      and membership.student_key = public.current_profile_student_key()
  );
$$;

revoke all on function public.is_group_plan_staff() from public, anon;
revoke all on function public.is_group_plan_member(text) from public, anon;
grant execute on function public.is_group_plan_staff() to authenticated;
grant execute on function public.is_group_plan_member(text) to authenticated;

alter table public.group_baseline_updates enable row level security;
alter table public.group_baseline_conflicts enable row level security;
alter table public.group_plan_restore_points enable row level security;

drop policy if exists group_baseline_updates_select_scope on public.group_baseline_updates;
create policy group_baseline_updates_select_scope
  on public.group_baseline_updates
  for select to authenticated
  using (
    public.is_group_plan_staff()
    or public.is_group_plan_member(space_id)
  );

drop policy if exists group_baseline_conflicts_select_scope on public.group_baseline_conflicts;
create policy group_baseline_conflicts_select_scope
  on public.group_baseline_conflicts
  for select to authenticated
  using (
    public.is_group_plan_staff()
    or public.is_group_plan_member(space_id)
  );

drop policy if exists group_plan_restore_points_select_scope on public.group_plan_restore_points;
create policy group_plan_restore_points_select_scope
  on public.group_plan_restore_points
  for select to authenticated
  using (
    public.is_group_plan_staff()
    or public.is_group_plan_member(space_id)
  );

revoke all on table public.group_baseline_updates from anon, authenticated;
revoke all on table public.group_baseline_conflicts from anon, authenticated;
revoke all on table public.group_plan_restore_points from anon, authenticated;

grant select on table public.group_baseline_updates to authenticated;
grant select on table public.group_baseline_conflicts to authenticated;
grant select on table public.group_plan_restore_points to authenticated;

create or replace function public.ensure_group_plan_space(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_group_id text,
  p_snapshot_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_project public.teaching_projects;
  v_village public.villages;
  v_group public.course_groups;
  v_snapshot public.feature_snapshots;
  v_space public.planning_spaces;
  v_space_id text;
  v_created boolean := false;
  v_inserted_count integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(btrim(p_group_id), '') is null then raise exception 'GROUP_REQUIRED'; end if;

  select project.* into v_project
  from public.teaching_projects project
  where project.id = p_teaching_project_id
    and project.formal_village_id = p_village_id;
  if not found then raise exception 'FORMAL_VILLAGE_PROJECT_REQUIRED'; end if;

  select village.* into v_village
  from public.villages village
  where village.id = p_village_id;
  if not found then raise exception 'VILLAGE_NOT_FOUND'; end if;
  if v_village.is_practice then raise exception 'PRACTICE_GROUP_SPACE_FORBIDDEN'; end if;

  select course_group.* into v_group
  from public.course_groups course_group
  where course_group.id = p_group_id
    and course_group.course_id = v_project.course_id;
  if not found then raise exception 'PROJECT_GROUP_REQUIRED'; end if;

  if not public.is_group_plan_staff() and not exists (
    select 1
    from public.group_memberships membership
    where membership.course_id = v_project.course_id
      and membership.group_id = p_group_id
      and membership.student_key = public.current_profile_student_key()
  ) then
    raise exception 'GROUP_MEMBERSHIP_REQUIRED';
  end if;

  if p_snapshot_id is null then
    select snapshot.* into v_snapshot
    from public.feature_snapshots snapshot
    join public.planning_spaces source_space on source_space.id = snapshot.space_id
    where snapshot.teaching_project_id = p_teaching_project_id
      and snapshot.village_id = p_village_id
      and snapshot.recommended_for_groups
      and snapshot.is_published
      and source_space.space_type = 'formal_shared'
    order by snapshot.version_number desc nulls last, snapshot.created_at desc
    limit 1;
  else
    select snapshot.* into v_snapshot
    from public.feature_snapshots snapshot
    join public.planning_spaces source_space on source_space.id = snapshot.space_id
    where snapshot.id = p_snapshot_id
      and snapshot.teaching_project_id = p_teaching_project_id
      and snapshot.village_id = p_village_id
      and snapshot.is_published
      and source_space.space_type = 'formal_shared';
  end if;

  if not found then
    return jsonb_build_object(
      'space_id', null,
      'group_id', p_group_id,
      'base_snapshot_id', null,
      'created', false,
      'status', 'waiting_for_snapshot'
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'group-plan-space', p_teaching_project_id, p_village_id, p_group_id), 0
  ));

  select space.* into v_space
  from public.planning_spaces space
  where space.teaching_project_id = p_teaching_project_id
    and space.village_id = p_village_id
    and space.space_type = 'group_plan'
    and space.group_id = p_group_id;

  if not found then
    v_space_id := coalesce(
      nullif(btrim(v_group.space_id), ''),
      concat('group-plan-', p_group_id)
    );
    insert into public.planning_spaces(
      id, title, creator_name, created_at, readonly, edit_enabled, expanded,
      selected_layers, basemap_visible, view_mode, course_id, group_id, space_type,
      teaching_project_id, village_id, base_snapshot_id
    ) values (
      v_space_id, concat(v_group.name, ' · 小组方案空间'),
      coalesce(public.current_profile_display_name(), '系统'), now(), false, true, true,
      '["building","road","water"]'::jsonb, true, '2d', v_project.course_id,
      p_group_id, 'group_plan', p_teaching_project_id, p_village_id, v_snapshot.id
    )
    on conflict do nothing;
    get diagnostics v_inserted_count = row_count;
    v_created := v_inserted_count > 0;

    select space.* into v_space
    from public.planning_spaces space
    where space.teaching_project_id = p_teaching_project_id
      and space.village_id = p_village_id
      and space.space_type = 'group_plan'
      and space.group_id = p_group_id;
  end if;

  if v_space.id is null then raise exception 'GROUP_PLAN_SPACE_CREATE_FAILED'; end if;

  update public.course_groups
  set space_id = v_space.id, updated_at = now()
  where id = p_group_id
    and space_id is distinct from v_space.id;

  return jsonb_build_object(
    'space_id', v_space.id,
    'group_id', p_group_id,
    'base_snapshot_id', v_space.base_snapshot_id,
    'created', v_created,
    'status', case when v_created then 'created' else 'existing' end
  );
end;
$function$;

create or replace function public.ensure_group_plan_spaces_for_snapshot(
  p_snapshot_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_snapshot public.feature_snapshots;
  v_project public.teaching_projects;
  v_group record;
  v_result jsonb;
  v_created integer := 0;
  v_existing integer := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_group_plan_staff() then raise exception 'STAFF_REQUIRED'; end if;

  select snapshot.* into v_snapshot
  from public.feature_snapshots snapshot
  join public.planning_spaces source_space on source_space.id = snapshot.space_id
  where snapshot.id = p_snapshot_id
    and snapshot.is_published
    and source_space.space_type = 'formal_shared';
  if not found then raise exception 'FORMAL_SHARED_SNAPSHOT_REQUIRED'; end if;

  select project.* into v_project
  from public.teaching_projects project
  where project.id = v_snapshot.teaching_project_id
    and project.formal_village_id = v_snapshot.village_id;
  if not found then raise exception 'FORMAL_VILLAGE_PROJECT_REQUIRED'; end if;

  for v_group in
    select course_group.id
    from public.course_groups course_group
    where course_group.course_id = v_project.course_id
    order by course_group.created_at, course_group.id
  loop
    begin
      v_result := public.ensure_group_plan_space(
        v_project.id, v_snapshot.village_id, v_group.id, v_snapshot.id
      );
      if coalesce((v_result->>'created')::boolean, false) then
        v_created := v_created + 1;
      else
        v_existing := v_existing + 1;
      end if;
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'group_id', v_group.id,
        'error', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'existing', v_existing,
    'failed', v_failed,
    'snapshot_id', v_snapshot.id
  );
end;
$function$;

revoke all on function public.ensure_group_plan_space(uuid,uuid,text,uuid) from public, anon;
revoke all on function public.ensure_group_plan_spaces_for_snapshot(uuid) from public, anon;
grant execute on function public.ensure_group_plan_space(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.ensure_group_plan_spaces_for_snapshot(uuid) to authenticated;

create or replace function public.ensure_group_plan_spaces_after_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_space_type text;
begin
  select space.space_type into v_space_type
  from public.planning_spaces space
  where space.id = new.space_id
    and space.teaching_project_id = new.teaching_project_id
    and space.village_id = new.village_id;

  if new.is_published
     and v_space_type = 'formal_shared'
     and auth.uid() is not null
     and public.is_group_plan_staff() then
    perform public.ensure_group_plan_spaces_for_snapshot(new.id);
  end if;
  return new;
end;
$function$;

revoke all on function public.ensure_group_plan_spaces_after_snapshot()
  from public, anon, authenticated;

drop trigger if exists trg_ensure_group_plan_spaces_after_snapshot
  on public.feature_snapshots;
create trigger trg_ensure_group_plan_spaces_after_snapshot
after insert on public.feature_snapshots
for each row execute function public.ensure_group_plan_spaces_after_snapshot();

create or replace function public.resolve_group_plan_features(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_layer_key text default null
) returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_space public.planning_spaces;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select space.* into v_space
  from public.planning_spaces space
  where space.id = p_space_id
    and space.teaching_project_id = p_teaching_project_id
    and space.village_id = p_village_id
    and space.space_type = 'group_plan';
  if not found then raise exception 'GROUP_PLAN_SPACE_REQUIRED'; end if;
  if v_space.base_snapshot_id is null then raise exception 'GROUP_BASELINE_REQUIRED'; end if;
  if not public.is_group_plan_staff() and not public.is_group_plan_member(p_space_id) then
    raise exception 'GROUP_MEMBERSHIP_REQUIRED';
  end if;

  return query
  with latest_overrides as (
    select distinct on (
      feature.layer_key,
      coalesce(nullif(feature.base_object_code, ''), feature.object_code)
    )
      feature.*
    from public.planning_features feature
    where feature.teaching_project_id = p_teaching_project_id
      and feature.village_id = p_village_id
      and feature.space_id = p_space_id
      and feature.operation_kind is not null
      and (nullif(btrim(p_layer_key), '') is null or feature.layer_key = p_layer_key)
    order by
      feature.layer_key,
      coalesce(nullif(feature.base_object_code, ''), feature.object_code),
      feature.feature_revision desc,
      feature.updated_at desc,
      feature.id desc
  ), baseline_rows as (
    select jsonb_build_object(
      'layer_key', item.layer_key,
      'object_code', item.object_code,
      'object_name', coalesce(override.object_name, item.object_name),
      'geom', coalesce(override.geom, item.geom),
      'props', coalesce(override.props, item.props, '{}'::jsonb),
      'source', case when override.operation_kind = 'updated' then 'group_override' else 'baseline' end,
      'operation_kind', override.operation_kind,
      'feature_revision', coalesce(override.feature_revision, 0)
    ) as row_value
    from public.feature_snapshot_items item
    left join latest_overrides override
      on override.layer_key = item.layer_key
     and coalesce(nullif(override.base_object_code, ''), override.object_code) = item.object_code
    where item.snapshot_id = v_space.base_snapshot_id
      and not item.is_deleted
      and override.operation_kind is distinct from 'deleted'
      and (nullif(btrim(p_layer_key), '') is null or item.layer_key = p_layer_key)
  ), added_rows as (
    select jsonb_build_object(
      'layer_key', override.layer_key,
      'object_code', override.object_code,
      'object_name', override.object_name,
      'geom', override.geom,
      'props', coalesce(override.props, '{}'::jsonb),
      'source', 'group_override',
      'operation_kind', 'added',
      'feature_revision', override.feature_revision
    ) as row_value
    from latest_overrides override
    where override.operation_kind = 'added'
      and not override.is_deleted
  )
  select row_value from baseline_rows
  union all
  select row_value from added_rows;
end;
$function$;

revoke all on function public.resolve_group_plan_features(uuid,uuid,text,text)
  from public, anon;
grant execute on function public.resolve_group_plan_features(uuid,uuid,text,text)
  to authenticated;

create or replace function public.save_group_plan_edit_batch(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_editor_name text,
  p_summary text,
  p_changes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_editor_name text := public.current_profile_display_name();
  v_space public.planning_spaces;
  v_existing public.planning_features;
  v_batch_id uuid;
  v_change jsonb;
  v_action text;
  v_layer_key text;
  v_client_code text;
  v_object_code text;
  v_base_code text;
  v_operation text;
  v_expected_revision bigint;
  v_current_revision bigint;
  v_lock_token uuid;
  v_saved integer := 0;
  v_event_id text := gen_random_uuid()::text;
begin
  if v_user_id is null or v_editor_name is null then raise exception 'AUTH_REQUIRED'; end if;

  select space.* into v_space
  from public.planning_spaces space
  where space.id = p_space_id
    and space.teaching_project_id = p_teaching_project_id
    and space.village_id = p_village_id
    and space.space_type = 'group_plan'
  for update;
  if not found then raise exception 'GROUP_PLAN_SPACE_REQUIRED'; end if;
  if v_space.base_snapshot_id is null then raise exception 'GROUP_BASELINE_REQUIRED'; end if;
  if not public.is_group_plan_staff() and not public.is_group_plan_member(p_space_id) then
    raise exception 'GROUP_MEMBERSHIP_REQUIRED';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'GROUP_PLAN_CHANGES_REQUIRED';
  end if;

  insert into public.feature_change_batches(
    teaching_project_id, village_id, space_id,
    editor_name, editor_user_id, summary, note
  ) values (
    p_teaching_project_id, p_village_id, p_space_id,
    v_editor_name, v_user_id, coalesce(nullif(btrim(p_summary), ''), '小组方案编辑'), ''
  ) returning id into v_batch_id;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_action := btrim(v_change->>'action');
    v_layer_key := btrim(v_change->>'layerKey');
    v_client_code := btrim(v_change->>'objectCode');
    v_base_code := nullif(btrim(v_change->>'baseObjectCode'), '');
    if v_action not in ('add', 'update', 'delete') then raise exception 'GROUP_PLAN_ACTION_INVALID'; end if;
    if v_layer_key not in ('building', 'road', 'water') then raise exception 'GROUP_LAYER_READ_ONLY'; end if;
    if nullif(v_client_code, '') is null then raise exception 'GROUP_PLAN_OBJECT_REQUIRED'; end if;
    if v_action in ('update', 'delete') then
      if v_base_code is not null and v_base_code <> v_client_code then
        raise exception 'GROUP_PLAN_OBJECT_IDENTITY_MISMATCH';
      end if;
      -- Baseline identity is immutable. Locks, revisions and the override row must
      -- all address the same canonical object code.
      v_base_code := v_client_code;
    end if;
    if not (v_change ? 'expectedRevision') or not (v_change ? 'lockToken') then
      raise exception 'FEATURE_REVISION_AND_LOCK_REQUIRED';
    end if;

    v_expected_revision := (v_change->>'expectedRevision')::bigint;
    v_lock_token := (v_change->>'lockToken')::uuid;
    if not exists (
      select 1 from public.feature_edit_locks feature_lock
      where feature_lock.teaching_project_id = p_teaching_project_id
        and feature_lock.village_id = p_village_id
        and feature_lock.space_id = p_space_id
        and feature_lock.layer_key = v_layer_key
        and feature_lock.object_code = v_client_code
        and feature_lock.editor_user_id = v_user_id
        and feature_lock.lock_token = v_lock_token
        and feature_lock.expires_at > now()
    ) then raise exception 'FEATURE_LOCK_REQUIRED'; end if;

    v_existing := null;
    select feature.* into v_existing
    from public.planning_features feature
    where feature.space_id = p_space_id
      and feature.layer_key = v_layer_key
      and feature.object_code = v_client_code
    for update;

    if found then
      v_current_revision := v_existing.feature_revision;
      v_base_code := coalesce(v_existing.base_object_code, v_base_code);
    elsif exists (
      select 1 from public.feature_snapshot_items item
      where item.snapshot_id = v_space.base_snapshot_id
        and item.layer_key = v_layer_key
        and item.object_code = coalesce(v_base_code, v_client_code)
    ) then
      v_current_revision := 0;
      v_base_code := coalesce(v_base_code, v_client_code);
    else
      v_current_revision := 0;
    end if;

    if v_current_revision <> v_expected_revision then raise exception 'FEATURE_REVISION_CONFLICT'; end if;

    if v_action = 'add' then
      if v_expected_revision <> 0 then raise exception 'FEATURE_REVISION_CONFLICT'; end if;
      v_object_code := concat(
        case v_layer_key when 'building' then 'GB' when 'road' then 'GR' else 'GW' end,
        '-', replace(gen_random_uuid()::text, '-', '')
      );
      v_base_code := null;
      v_operation := 'added';
    else
      v_object_code := v_client_code;
      if v_action = 'delete' then
        v_operation := 'deleted';
      elsif v_existing.operation_kind = 'added' then
        v_operation := 'added';
      else
        v_operation := 'updated';
        v_base_code := coalesce(v_base_code, v_client_code);
      end if;
    end if;

    insert into public.feature_versions(
      batch_id, teaching_project_id, village_id, space_id,
      layer_key, object_code, action, before_geom, after_geom,
      before_props, after_props, created_by, created_by_user_id
    ) values (
      v_batch_id, p_teaching_project_id, p_village_id, p_space_id,
      v_layer_key, v_object_code, v_action,
      v_change->'beforeGeom', v_change->'afterGeom',
      v_change->'beforeProps', v_change->'afterProps',
      v_editor_name, v_user_id
    );

    insert into public.planning_features(
      teaching_project_id, village_id, space_id, layer_key, object_code,
      object_name, geom, props, is_deleted, operation_kind,
      base_object_code, base_snapshot_id, feature_revision
    ) values (
      p_teaching_project_id, p_village_id, p_space_id, v_layer_key, v_object_code,
      coalesce(v_change->>'objectName', v_object_code),
      coalesce(v_change->'afterGeom', v_change->'beforeGeom', '{}'::jsonb),
      coalesce(v_change->'afterProps', v_change->'beforeProps', '{}'::jsonb),
      v_action = 'delete', v_operation, v_base_code, v_space.base_snapshot_id,
      v_current_revision + 1
    )
    on conflict (space_id, layer_key, object_code) do update
    set object_name = excluded.object_name,
        geom = excluded.geom,
        props = excluded.props,
        is_deleted = excluded.is_deleted,
        operation_kind = excluded.operation_kind,
        base_object_code = excluded.base_object_code,
        base_snapshot_id = excluded.base_snapshot_id,
        feature_revision = excluded.feature_revision,
        updated_at = now();
    v_saved := v_saved + 1;
  end loop;

  insert into public.activity_events(
    event_id, client_event_id, occurred_at, teaching_project_id, village_id,
    space_id, student_key, student_name, course_id, group_id,
    action, target_type, target_id, metadata
  ) values (
    v_event_id, v_event_id, now(), p_teaching_project_id, p_village_id,
    p_space_id, public.current_profile_student_key(), v_editor_name, v_space.course_id,
    v_space.group_id, 'group_plan_edited', 'planning_space', p_space_id,
    jsonb_build_object('batchId', v_batch_id, 'saved', v_saved)
  );

  return jsonb_build_object('batchId', v_batch_id, 'saved', v_saved);
end;
$function$;

revoke all on function public.save_group_plan_edit_batch(uuid,uuid,text,text,text,jsonb)
  from public, anon;
grant execute on function public.save_group_plan_edit_batch(uuid,uuid,text,text,text,jsonb)
  to authenticated;

create or replace function public.assert_group_plan_context(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text
) returns public.planning_spaces
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_space public.planning_spaces;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select space.* into v_space
  from public.planning_spaces space
  where space.id = p_space_id
    and space.teaching_project_id = p_teaching_project_id
    and space.village_id = p_village_id
    and space.space_type = 'group_plan';
  if not found then raise exception 'GROUP_PLAN_SPACE_REQUIRED'; end if;
  if v_space.base_snapshot_id is null then raise exception 'GROUP_BASELINE_REQUIRED'; end if;
  if not public.is_group_plan_staff() and not public.is_group_plan_member(p_space_id) then
    raise exception 'GROUP_MEMBERSHIP_REQUIRED';
  end if;
  return v_space;
end;
$function$;

revoke all on function public.assert_group_plan_context(uuid,uuid,text)
  from public, anon, authenticated;

create or replace function public.get_group_plan_baseline_state(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_space public.planning_spaces;
  v_current public.feature_snapshots;
  v_latest public.feature_snapshots;
begin
  v_space := public.assert_group_plan_context(p_teaching_project_id, p_village_id, p_space_id);

  select snapshot.* into v_current
  from public.feature_snapshots snapshot
  where snapshot.id = v_space.base_snapshot_id;

  select snapshot.* into v_latest
  from public.feature_snapshots snapshot
  join public.planning_spaces source_space on source_space.id = snapshot.space_id
  where snapshot.teaching_project_id = p_teaching_project_id
    and snapshot.village_id = p_village_id
    and snapshot.is_published
    and snapshot.recommended_for_groups
    and source_space.space_type = 'formal_shared'
  order by snapshot.version_number desc, snapshot.created_at desc
  limit 1;

  if v_latest.id is null then v_latest := v_current; end if;
  return jsonb_build_object(
    'space', to_jsonb(v_space),
    'current', case when v_current.id is null then null else to_jsonb(v_current) end,
    'latest', case when v_latest.id is null then null else to_jsonb(v_latest) end
  );
end;
$function$;

revoke all on function public.get_group_plan_baseline_state(uuid,uuid,text) from public, anon;
grant execute on function public.get_group_plan_baseline_state(uuid,uuid,text) to authenticated;

create or replace function public.preview_group_baseline_update(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_target_snapshot_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_space public.planning_spaces;
  v_current public.feature_snapshots;
  v_target public.feature_snapshots;
  v_added integer := 0;
  v_updated integer := 0;
  v_deleted integer := 0;
  v_group_added integer := 0;
  v_group_updated integer := 0;
  v_group_deleted integer := 0;
  v_conflicts integer := 0;
begin
  v_space := public.assert_group_plan_context(p_teaching_project_id, p_village_id, p_space_id);

  select snapshot.* into v_current
  from public.feature_snapshots snapshot
  where snapshot.id = v_space.base_snapshot_id;
  select snapshot.* into v_target
  from public.feature_snapshots snapshot
  join public.planning_spaces source_space on source_space.id = snapshot.space_id
  where snapshot.id = p_target_snapshot_id
    and snapshot.teaching_project_id = p_teaching_project_id
    and snapshot.village_id = p_village_id
    and snapshot.is_published
    and source_space.space_type = 'formal_shared';
  if not found then raise exception 'TARGET_BASELINE_REQUIRED'; end if;
  if coalesce(v_target.version_number, 0) <= coalesce(v_current.version_number, 0) then
    raise exception 'TARGET_BASELINE_NOT_NEWER';
  end if;

  with old_items as (
    select * from public.feature_snapshot_items
    where snapshot_id = v_current.id and layer_key in ('building', 'road', 'water') and not is_deleted
  ), new_items as (
    select * from public.feature_snapshot_items
    where snapshot_id = v_target.id and layer_key in ('building', 'road', 'water') and not is_deleted
  ), changes as (
    select
      coalesce(old_item.layer_key, new_item.layer_key) layer_key,
      coalesce(old_item.object_code, new_item.object_code) object_code,
      old_item.object_code is null is_added,
      new_item.object_code is null is_deleted,
      old_item.object_code is not null and new_item.object_code is not null
        and (old_item.geom is distinct from new_item.geom or old_item.props is distinct from new_item.props) is_updated
    from old_items old_item
    full join new_items new_item
      on new_item.layer_key = old_item.layer_key and new_item.object_code = old_item.object_code
  )
  select
    count(*) filter (where is_added),
    count(*) filter (where is_updated),
    count(*) filter (where is_deleted)
  into v_added, v_updated, v_deleted
  from changes;

  select
    count(*) filter (where operation_kind = 'added'),
    count(*) filter (where operation_kind = 'updated'),
    count(*) filter (where operation_kind = 'deleted')
  into v_group_added, v_group_updated, v_group_deleted
  from public.planning_features feature
  where feature.space_id = p_space_id and feature.operation_kind is not null;

  with old_items as (
    select * from public.feature_snapshot_items
    where snapshot_id = v_current.id and layer_key in ('building', 'road', 'water') and not is_deleted
  ), new_items as (
    select * from public.feature_snapshot_items
    where snapshot_id = v_target.id and layer_key in ('building', 'road', 'water') and not is_deleted
  ), changed_baseline as (
    select coalesce(old_item.layer_key, new_item.layer_key) layer_key,
      coalesce(old_item.object_code, new_item.object_code) object_code
    from old_items old_item
    full join new_items new_item
      on new_item.layer_key = old_item.layer_key and new_item.object_code = old_item.object_code
    where old_item.object_code is null or new_item.object_code is null
      or old_item.geom is distinct from new_item.geom or old_item.props is distinct from new_item.props
  )
  select count(*) into v_conflicts
  from changed_baseline change
  join public.planning_features feature
    on feature.space_id = p_space_id
   and feature.layer_key = change.layer_key
   and coalesce(nullif(feature.base_object_code, ''), feature.object_code) = change.object_code
   and feature.operation_kind is not null;

  return jsonb_build_object(
    'from_snapshot_id', v_current.id,
    'to_snapshot_id', v_target.id,
    'from_version_name', v_current.version_name,
    'to_version_name', v_target.version_name,
    'baseline', jsonb_build_object('added',v_added,'updated',v_updated,'deleted',v_deleted),
    'group', jsonb_build_object('added',v_group_added,'updated',v_group_updated,'deleted',v_group_deleted),
    'potential_conflicts', v_conflicts
  );
end;
$function$;

create or replace function public.apply_group_baseline_update(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_target_snapshot_id uuid,
  p_expected_base_snapshot_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_space public.planning_spaces;
  v_preview jsonb;
  v_update_id uuid;
  v_restore_id uuid;
  v_conflict_count integer := 0;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select space.* into v_space
  from public.planning_spaces space
  where space.id = p_space_id
    and space.teaching_project_id = p_teaching_project_id
    and space.village_id = p_village_id
    and space.space_type = 'group_plan'
  for update;
  if not found then raise exception 'GROUP_PLAN_SPACE_REQUIRED'; end if;
  if not public.is_group_plan_staff() and not public.is_group_plan_member(p_space_id) then
    raise exception 'GROUP_MEMBERSHIP_REQUIRED';
  end if;
  if v_space.base_snapshot_id is distinct from p_expected_base_snapshot_id then
    raise exception 'BASELINE_VERSION_CONFLICT';
  end if;
  if exists (
    select 1 from public.feature_edit_locks feature_lock
    where feature_lock.teaching_project_id = p_teaching_project_id
      and feature_lock.village_id = p_village_id
      and feature_lock.space_id = p_space_id
      and feature_lock.expires_at > now()
  ) then raise exception 'GROUP_SPACE_BUSY'; end if;

  v_preview := public.preview_group_baseline_update(
    p_teaching_project_id, p_village_id, p_space_id, p_target_snapshot_id
  );

  insert into public.group_baseline_updates(
    teaching_project_id, village_id, space_id, group_id,
    from_snapshot_id, to_snapshot_id, status, stats, created_by
  ) values (
    p_teaching_project_id, p_village_id, p_space_id, v_space.group_id,
    v_space.base_snapshot_id, p_target_snapshot_id, 'running', v_preview, v_user_id
  ) returning id into v_update_id;

  insert into public.group_plan_restore_points(
    teaching_project_id, village_id, space_id, group_id, baseline_snapshot_id,
    overrides, source_update_id, created_by
  )
  select p_teaching_project_id, p_village_id, p_space_id, v_space.group_id,
    v_space.base_snapshot_id,
    coalesce(jsonb_agg(to_jsonb(feature) order by feature.layer_key, feature.object_code), '[]'::jsonb),
    v_update_id, v_user_id
  from public.planning_features feature
  where feature.space_id = p_space_id and feature.operation_kind is not null
  returning id into v_restore_id;

  with old_items as (
    select * from public.feature_snapshot_items
    where snapshot_id = v_space.base_snapshot_id and layer_key in ('building', 'road', 'water') and not is_deleted
  ), new_items as (
    select * from public.feature_snapshot_items
    where snapshot_id = p_target_snapshot_id and layer_key in ('building', 'road', 'water') and not is_deleted
  ), changed_baseline as (
    select coalesce(old_item.layer_key, new_item.layer_key) layer_key,
      coalesce(old_item.object_code, new_item.object_code) object_code,
      to_jsonb(old_item) old_value,
      to_jsonb(new_item) new_value,
      new_item.object_code is null baseline_deleted
    from old_items old_item
    full join new_items new_item
      on new_item.layer_key = old_item.layer_key and new_item.object_code = old_item.object_code
    where old_item.object_code is null or new_item.object_code is null
      or old_item.geom is distinct from new_item.geom or old_item.props is distinct from new_item.props
  )
  insert into public.group_baseline_conflicts(
    update_id, teaching_project_id, village_id, space_id, group_id,
    layer_key, object_code, conflict_type, baseline_change, group_change
  )
  select v_update_id, p_teaching_project_id, p_village_id, p_space_id, v_space.group_id,
    change.layer_key, change.object_code,
    case when change.baseline_deleted then 'baseline_deleted' else 'both_changed' end,
    jsonb_build_object('before',change.old_value,'after',change.new_value),
    to_jsonb(feature)
  from changed_baseline change
  join public.planning_features feature
    on feature.space_id = p_space_id
   and feature.layer_key = change.layer_key
   and coalesce(nullif(feature.base_object_code, ''), feature.object_code) = change.object_code
   and feature.operation_kind is not null;
  get diagnostics v_conflict_count = row_count;

  update public.planning_spaces
  set base_snapshot_id = p_target_snapshot_id
  where id = p_space_id;

  update public.group_baseline_updates
  set status = 'completed', completed_at = now(),
      stats = v_preview || jsonb_build_object('conflicts_created', v_conflict_count)
  where id = v_update_id;

  return jsonb_build_object(
    'update_id', v_update_id,
    'restore_point_id', v_restore_id,
    'base_snapshot_id', p_target_snapshot_id,
    'conflicts_created', v_conflict_count,
    'stats', v_preview
  );
end;
$function$;

create or replace function public.resolve_group_baseline_conflict(
  p_conflict_id uuid,
  p_resolution text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_conflict public.group_baseline_conflicts;
  v_space public.planning_spaces;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_resolution not in ('keep_group', 'use_new_baseline', 'manual_merge') then
    raise exception 'CONFLICT_RESOLUTION_INVALID';
  end if;

  select conflict.* into v_conflict
  from public.group_baseline_conflicts conflict
  where conflict.id = p_conflict_id
  for update;
  if not found then raise exception 'GROUP_BASELINE_CONFLICT_NOT_FOUND'; end if;
  if v_conflict.resolution_status = 'resolved' then raise exception 'CONFLICT_ALREADY_RESOLVED'; end if;
  if not public.is_group_plan_staff() and not public.is_group_plan_member(v_conflict.space_id) then
    raise exception 'GROUP_MEMBERSHIP_REQUIRED';
  end if;

  select space.* into v_space from public.planning_spaces space
  where space.id = v_conflict.space_id for update;

  if p_resolution = 'use_new_baseline' then
    update public.planning_features
    set operation_kind = null, is_deleted = true, updated_at = now()
    where space_id = v_conflict.space_id
      and layer_key = v_conflict.layer_key
      and coalesce(nullif(base_object_code, ''), object_code) = v_conflict.object_code;
  elsif p_resolution = 'manual_merge' then
    if not (p_payload ? 'geom') or not (p_payload ? 'props') then
      raise exception 'MANUAL_MERGE_PAYLOAD_REQUIRED';
    end if;
    update public.planning_features
    set geom = p_payload->'geom', props = p_payload->'props',
        operation_kind = 'updated', is_deleted = false,
        base_snapshot_id = v_space.base_snapshot_id,
        feature_revision = feature_revision + 1, updated_at = now()
    where space_id = v_conflict.space_id
      and layer_key = v_conflict.layer_key
      and coalesce(nullif(base_object_code, ''), object_code) = v_conflict.object_code;
  end if;

  update public.group_baseline_conflicts
  set resolution_status = 'resolved', resolution_payload = jsonb_build_object(
        'resolution', p_resolution, 'payload', coalesce(p_payload, '{}'::jsonb)
      ), resolved_by = v_user_id, resolved_at = now()
  where id = p_conflict_id;

  return jsonb_build_object('conflict_id',p_conflict_id,'resolution',p_resolution,'resolved',true);
end;
$function$;

create or replace function public.restore_group_plan_restore_point(
  p_restore_point_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_restore public.group_plan_restore_points;
  v_space public.planning_spaces;
  v_item jsonb;
  v_update_id uuid;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_group_plan_staff() then raise exception 'STAFF_REQUIRED'; end if;

  select restore_point.* into v_restore
  from public.group_plan_restore_points restore_point
  where restore_point.id = p_restore_point_id;
  if not found then raise exception 'GROUP_RESTORE_POINT_NOT_FOUND'; end if;

  select space.* into v_space
  from public.planning_spaces space
  where space.id = v_restore.space_id
    and space.space_type = 'group_plan'
  for update;
  if not found then raise exception 'GROUP_PLAN_SPACE_REQUIRED'; end if;
  if exists (
    select 1 from public.feature_edit_locks feature_lock
    where feature_lock.space_id = v_space.id and feature_lock.expires_at > now()
  ) then raise exception 'GROUP_SPACE_BUSY'; end if;

  update public.planning_features
  set operation_kind = null, is_deleted = true, updated_at = now()
  where space_id = v_space.id and operation_kind is not null;

  for v_item in select value from jsonb_array_elements(v_restore.overrides) loop
    insert into public.planning_features(
      id, teaching_project_id, village_id, space_id, layer_key, object_code,
      object_name, geom, props, is_deleted, created_at, updated_at,
      operation_kind, base_object_code, base_snapshot_id, feature_revision
    ) values (
      (v_item->>'id')::uuid, v_restore.teaching_project_id, v_restore.village_id,
      v_restore.space_id, v_item->>'layer_key', v_item->>'object_code',
      v_item->>'object_name', v_item->'geom', coalesce(v_item->'props','{}'::jsonb),
      coalesce((v_item->>'is_deleted')::boolean,false),
      coalesce((v_item->>'created_at')::timestamptz,now()), now(),
      v_item->>'operation_kind', nullif(v_item->>'base_object_code',''),
      (v_item->>'base_snapshot_id')::uuid,
      coalesce((v_item->>'feature_revision')::bigint,0)
    )
    on conflict (space_id, layer_key, object_code) do update
    set object_name = excluded.object_name, geom = excluded.geom, props = excluded.props,
        is_deleted = excluded.is_deleted, operation_kind = excluded.operation_kind,
        base_object_code = excluded.base_object_code, base_snapshot_id = excluded.base_snapshot_id,
        feature_revision = excluded.feature_revision, updated_at = now();
  end loop;

  update public.planning_spaces
  set base_snapshot_id = v_restore.baseline_snapshot_id
  where id = v_space.id;

  insert into public.group_baseline_updates(
    teaching_project_id,village_id,space_id,group_id,from_snapshot_id,to_snapshot_id,
    status,stats,created_by,completed_at
  ) values (
    v_restore.teaching_project_id,v_restore.village_id,v_restore.space_id,v_restore.group_id,
    v_space.base_snapshot_id,v_restore.baseline_snapshot_id,'restored',
    jsonb_build_object('restore_point_id',v_restore.id),v_user_id,now()
  ) returning id into v_update_id;

  return jsonb_build_object(
    'restore_point_id',v_restore.id,'update_id',v_update_id,
    'base_snapshot_id',v_restore.baseline_snapshot_id,'restored',true
  );
end;
$function$;

create or replace function public.get_group_plan_admin_dashboard(
  p_teaching_project_id uuid,
  p_village_id uuid
) returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_project public.teaching_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_group_plan_staff() then raise exception 'STAFF_REQUIRED'; end if;
  select project.* into v_project
  from public.teaching_projects project
  where project.id = p_teaching_project_id
    and project.formal_village_id = p_village_id;
  if not found then raise exception 'FORMAL_VILLAGE_PROJECT_REQUIRED'; end if;

  return query
  select jsonb_build_object(
    'group_id', course_group.id,
    'group_name', course_group.name,
    'member_count', coalesce(members.member_count, 0),
    'space_id', plan_space.id,
    'base_snapshot_id', plan_space.base_snapshot_id,
    'base_version_name', base_snapshot.version_name,
    'latest_snapshot_id', latest_snapshot.id,
    'latest_version_name', latest_snapshot.version_name,
    'last_edited_at', edits.last_edited_at,
    'unresolved_conflicts', coalesce(conflicts.unresolved_conflicts, 0),
    'latest_update_status', latest_update.status,
    'latest_restore_point_id', restore_point.id
  )
  from public.course_groups course_group
  left join lateral (
    select count(*)::integer member_count
    from public.group_memberships membership
    where membership.course_id = v_project.course_id
      and membership.group_id = course_group.id
  ) members on true
  left join public.planning_spaces plan_space
    on plan_space.teaching_project_id = p_teaching_project_id
   and plan_space.village_id = p_village_id
   and plan_space.space_type = 'group_plan'
   and plan_space.group_id = course_group.id
  left join public.feature_snapshots base_snapshot on base_snapshot.id = plan_space.base_snapshot_id
  left join lateral (
    select snapshot.id, snapshot.version_name
    from public.feature_snapshots snapshot
    join public.planning_spaces shared_space on shared_space.id = snapshot.space_id
    where snapshot.teaching_project_id = p_teaching_project_id
      and snapshot.village_id = p_village_id
      and snapshot.is_published
      and snapshot.recommended_for_groups
      and shared_space.space_type = 'formal_shared'
    order by snapshot.version_number desc, snapshot.created_at desc
    limit 1
  ) latest_snapshot on true
  left join lateral (
    select max(feature.updated_at) last_edited_at
    from public.planning_features feature
    where feature.space_id = plan_space.id and feature.operation_kind is not null
  ) edits on true
  left join lateral (
    select count(*)::integer unresolved_conflicts
    from public.group_baseline_conflicts conflict
    where conflict.space_id = plan_space.id and conflict.resolution_status = 'unresolved'
  ) conflicts on true
  left join lateral (
    select baseline_update.status
    from public.group_baseline_updates baseline_update
    where baseline_update.space_id = plan_space.id
    order by baseline_update.created_at desc
    limit 1
  ) latest_update on true
  left join lateral (
    select restore.id
    from public.group_plan_restore_points restore
    where restore.space_id = plan_space.id
    order by restore.created_at desc
    limit 1
  ) restore_point on true
  where course_group.course_id = v_project.course_id
  order by course_group.created_at, course_group.name;
end;
$function$;

create or replace function public.get_group_plan_admin_context(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_group_id text,
  p_space_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_project public.teaching_projects;
  v_village public.villages;
  v_group public.course_groups;
  v_space public.planning_spaces;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_group_plan_staff() then raise exception 'STAFF_REQUIRED'; end if;

  select project.* into v_project
  from public.teaching_projects project
  where project.id = p_teaching_project_id
    and project.formal_village_id = p_village_id;
  if not found then raise exception 'FORMAL_VILLAGE_PROJECT_REQUIRED'; end if;

  select village.* into v_village from public.villages village
  where village.id = p_village_id and not village.is_practice;
  if not found then raise exception 'FORMAL_VILLAGE_REQUIRED'; end if;

  select course_group.* into v_group from public.course_groups course_group
  where course_group.id = p_group_id and course_group.course_id = v_project.course_id;
  if not found then raise exception 'PROJECT_GROUP_REQUIRED'; end if;

  select space.* into v_space from public.planning_spaces space
  where space.id = p_space_id
    and space.teaching_project_id = p_teaching_project_id
    and space.village_id = p_village_id
    and space.group_id = p_group_id
    and space.space_type = 'group_plan';
  if not found then raise exception 'GROUP_PLAN_SPACE_REQUIRED'; end if;

  return jsonb_build_object(
    'project', to_jsonb(v_project),
    'village', to_jsonb(v_village),
    'group', to_jsonb(v_group),
    'space', to_jsonb(v_space),
    'admin_management', true
  );
end;
$function$;

revoke all on function public.preview_group_baseline_update(uuid,uuid,text,uuid) from public, anon;
revoke all on function public.apply_group_baseline_update(uuid,uuid,text,uuid,uuid) from public, anon;
revoke all on function public.resolve_group_baseline_conflict(uuid,text,jsonb) from public, anon;
revoke all on function public.restore_group_plan_restore_point(uuid) from public, anon;
revoke all on function public.get_group_plan_admin_dashboard(uuid,uuid) from public, anon;
revoke all on function public.get_group_plan_admin_context(uuid,uuid,text,text) from public, anon;
grant execute on function public.preview_group_baseline_update(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.apply_group_baseline_update(uuid,uuid,text,uuid,uuid) to authenticated;
grant execute on function public.resolve_group_baseline_conflict(uuid,text,jsonb) to authenticated;
grant execute on function public.restore_group_plan_restore_point(uuid) to authenticated;
grant execute on function public.get_group_plan_admin_dashboard(uuid,uuid) to authenticated;
grant execute on function public.get_group_plan_admin_context(uuid,uuid,text,text) to authenticated;

commit;
