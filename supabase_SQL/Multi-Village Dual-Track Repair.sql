-- Recovery for the already-recorded multi-village foundation migration.
-- This is deliberately standalone: do not replay the foundation migration remotely.
begin;

create extension if not exists pgcrypto;
create extension if not exists postgis;

alter table public.feature_edit_locks
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists village_id uuid references public.villages(id) on delete restrict,
  add column if not exists editor_user_id uuid references auth.users(id) on delete set null;
alter table public.feature_change_batches
  add column if not exists editor_user_id uuid references auth.users(id) on delete set null;
alter table public.feature_versions
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.legacy_personal_space_scopes (
  space_id text primary key,
  teaching_project_id uuid not null references public.teaching_projects(id) on delete restrict,
  village_id uuid not null references public.villages(id) on delete restrict,
  owner_id uuid references auth.users(id) on delete set null,
  source_student_key text,
  ownership_status text not null check (ownership_status in ('owned', 'archival')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.legacy_personal_space_scopes enable row level security;

do $$
declare
  v_admin_id uuid;
  v_mibu_id constant uuid := '00000000-0000-4000-8000-000000000001';
  v_dataset_id uuid := '00000000-0000-4000-8000-000000000002';
  v_project_id uuid := '00000000-0000-4000-8000-000000000003';
  v_reality_id constant uuid := '00000000-0000-4000-8000-000000000004';
  v_practice_shared constant text := 'practice-shared-00000000-0000-4000-8000-000000000003';
  v_legacy_scope constant text := 'legacy-unscoped-00000000-0000-4000-8000-000000000003';
  v_feature_total_before bigint;
  v_feature_total_after bigint;
  v_current_before bigint;
  v_shared_before bigint;
  v_shared_after bigint;
  v_copy_before bigint;
  v_copy_after bigint;
  v_copy_identity_before jsonb;
  v_copy_identity_after jsonb;
begin
  select id into v_admin_id from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin_id is null then raise exception 'MIBU_SEED_ADMIN_REQUIRED'; end if;
  if not exists (select 1 from public.courses where id = 'mibu-village-planning') then
    raise exception 'MIBU_COURSE_REQUIRED';
  end if;

  insert into public.villages(id, name, is_practice, boundary, default_crs, status, created_by)
  values (
    v_mibu_id, '米埗村', true,
    st_multi(st_makeenvelope(113.6578225, 23.6739555, 113.6695615, 23.6806181, 4326)),
    'EPSG:4326', 'published', v_admin_id
  ) on conflict(id) do update set
    name = excluded.name, is_practice = true, boundary = excluded.boundary,
    default_crs = excluded.default_crs, status = 'published';

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
    'ready', jsonb_build_object('valid', true, 'migration', 'mibu_repair_v0'), v_admin_id, null
  ) on conflict(village_id, version_number) do update set
    village_id = excluded.village_id, version_label = 'V0', status = 'ready',
    validation_summary = excluded.validation_summary, published_at = null
  returning id into v_dataset_id;
  -- The partial one-published-dataset index permits exactly one published dataset per village.
  -- Preserve any previous publication as a ready historical version before publishing V0.
  update public.village_datasets set status = 'ready', published_at = null
  where village_id = v_mibu_id and status = 'published' and id <> v_dataset_id;
  update public.village_datasets set status = 'published', published_at = coalesce(published_at, now())
  where id = v_dataset_id;

  insert into public.teaching_projects(id, course_id, name, practice_village_id, stage, created_by)
  values (v_project_id, 'mibu-village-planning', '米埗村规划实践（当届）', v_mibu_id, 'preparing', v_admin_id)
  on conflict(course_id) do update set
    name = excluded.name, practice_village_id = excluded.practice_village_id,
    stage = case when public.teaching_projects.stage = 'archived' then 'preparing' else public.teaching_projects.stage end
  returning id into v_project_id;

  insert into public.village_reality_models(
    id, village_id, ion_asset_id, title, height_offset, terrain_enabled, status, created_by, published_at
  ) values (v_reality_id, v_mibu_id, 5133927, '米埗村实景模型', 0, true, 'published', v_admin_id, now())
  on conflict (village_id) where status = 'published' do update set
    ion_asset_id = excluded.ion_asset_id, title = excluded.title, height_offset = excluded.height_offset,
    terrain_enabled = excluded.terrain_enabled, published_at = coalesce(public.village_reality_models.published_at, now());

  insert into public.planning_spaces(
    id, title, creator_name, created_at, readonly, edit_enabled, expanded, selected_layers,
    basemap_visible, view_mode, course_id, space_type, teaching_project_id, village_id, base_dataset_id
  ) values (
    v_practice_shared, '全班共享现状空间', '管理员', now(), false, true, true,
    '["building","road","water","contours"]'::jsonb, true, '2d', 'mibu-village-planning',
    'practice_shared', v_project_id, v_mibu_id, v_dataset_id
  ) on conflict(id) do update set
    title = excluded.title, space_type = 'practice_shared', teaching_project_id = excluded.teaching_project_id,
    village_id = excluded.village_id, base_dataset_id = excluded.base_dataset_id;

  -- Ambiguous attribute rows are retained in an explicit non-shared legacy scope.
  insert into public.planning_spaces(
    id, title, creator_name, created_at, readonly, edit_enabled, expanded, selected_layers,
    basemap_visible, view_mode, course_id, space_type, teaching_project_id, village_id, base_dataset_id
  ) values (
    v_legacy_scope, '待归属旧协作记录', '系统', now(), true, false, false, '[]'::jsonb,
    false, '2d', 'mibu-village-planning', 'legacy_unscoped', v_project_id, v_mibu_id, v_dataset_id
  ) on conflict(id) do update set
    teaching_project_id = excluded.teaching_project_id, village_id = excluded.village_id,
    base_dataset_id = excluded.base_dataset_id;

  select count(*) into v_feature_total_before from public.planning_features;
  select count(*) into v_current_before from public.planning_features where space_id = 'current';
  select count(*) into v_shared_before from public.planning_features where space_id = v_practice_shared;
  select count(*) into v_copy_before from public.planning_features where space_id like 'copy_%';
  select coalesce(jsonb_agg(jsonb_build_array(id, space_id) order by id), '[]'::jsonb)
  into v_copy_identity_before from public.planning_features where space_id like 'copy_%';

  -- Only this exact legacy shared space may be promoted. copy_* rows deliberately keep their own space ids.
  update public.planning_features
  set space_id = v_practice_shared, teaching_project_id = v_project_id, village_id = v_mibu_id, updated_at = now()
  where space_id = 'current';

  update public.community_tasks
  set space_id = v_practice_shared, teaching_project_id = v_project_id, village_id = v_mibu_id
  where space_id = 'current';
  update public.object_photos
  set space_id = v_practice_shared, teaching_project_id = v_project_id, village_id = v_mibu_id
  where space_id = 'current';
  update public.object_comments
  set space_id = v_practice_shared, teaching_project_id = v_project_id, village_id = v_mibu_id
  where space_id = 'current';
  update public.object_attribute_edits
  set space_id = v_practice_shared, teaching_project_id = v_project_id, village_id = v_mibu_id
  where space_id = 'current';
  update public.feature_snapshots
  set space_id = v_practice_shared, teaching_project_id = v_project_id, village_id = v_mibu_id
  where space_id = 'current';
  update public.activity_events
  set space_id = v_practice_shared, teaching_project_id = v_project_id, village_id = v_mibu_id
  where space_id = 'current';

  -- object_attribute_edits had a global key. Remaining ambiguous records receive a stable legacy scope,
  -- never the shared space, before its context columns become non-null.
  update public.object_attribute_edits
  set teaching_project_id = coalesce(teaching_project_id, v_project_id),
      village_id = coalesce(village_id, v_mibu_id),
      space_id = coalesce(nullif(space_id, ''), v_legacy_scope)
  where teaching_project_id is null or village_id is null or nullif(space_id, '') is null;

  -- Retain old lock rows for audit/expiry while assigning their key a deterministic context.
  update public.feature_edit_locks
  set teaching_project_id = v_project_id, village_id = v_mibu_id
  where space_id = 'current';
  update public.feature_edit_locks
  set teaching_project_id = coalesce(teaching_project_id, v_project_id),
      village_id = coalesce(village_id, v_mibu_id)
  where teaching_project_id is null or village_id is null;

  -- A legacy copy becomes owner-visible only when its activity history identifies exactly one profile.
  -- Every ambiguous copy remains a staff-only archive; no copy is promoted into shared current state.
  with copy_spaces as (
    select distinct feature.space_id
    from public.planning_features feature
    where feature.space_id like 'copy_%'
  ), candidates as (
    select copy.space_id,
      count(profile.id) as matched_profile_count,
      case when count(profile.id) = 1 then min(profile.id::text)::uuid else null end as owner_id,
      case when count(profile.id) = 1 then min(event.student_key) else null end as source_student_key
    from copy_spaces copy
    left join (
      select distinct space_id, student_key
      from public.activity_events
      where space_id like 'copy_%' and nullif(student_key, '') is not null
    ) event on event.space_id = copy.space_id
    left join public.profiles profile
      on event.student_key = profile.student_id || '::' || profile.display_name
    group by copy.space_id
  )
  insert into public.legacy_personal_space_scopes(
    space_id, teaching_project_id, village_id, owner_id, source_student_key, ownership_status
  )
  select space_id, v_project_id, v_mibu_id, owner_id, source_student_key,
    case when matched_profile_count = 1 then 'owned' else 'archival' end
  from candidates
  on conflict(space_id) do update set
    teaching_project_id = excluded.teaching_project_id,
    village_id = excluded.village_id,
    owner_id = excluded.owner_id,
    source_student_key = excluded.source_student_key,
    ownership_status = excluded.ownership_status,
    updated_at = now();

  insert into public.planning_spaces(
    id, title, creator_name, created_at, readonly, edit_enabled, expanded, selected_layers,
    basemap_visible, view_mode, course_id, group_id, space_type,
    teaching_project_id, village_id, base_dataset_id, owner_id
  )
  select scope.space_id, '历史个人体验空间', coalesce(profile.display_name, '待认领'), now(),
    scope.ownership_status = 'archival', scope.ownership_status = 'owned', false, '[]'::jsonb,
    false, '2d', 'mibu-village-planning', scope.space_id, 'legacy_personal',
    scope.teaching_project_id, scope.village_id, v_dataset_id, scope.owner_id
  from public.legacy_personal_space_scopes scope
  left join public.profiles profile on profile.id = scope.owner_id
  on conflict(id) do update set
    teaching_project_id = excluded.teaching_project_id, village_id = excluded.village_id,
    base_dataset_id = excluded.base_dataset_id, owner_id = excluded.owner_id,
    group_id = excluded.group_id, space_type = excluded.space_type,
    readonly = excluded.readonly, edit_enabled = excluded.edit_enabled;

  update public.planning_features feature
  set teaching_project_id = scope.teaching_project_id, village_id = scope.village_id
  from public.legacy_personal_space_scopes scope
  where feature.space_id = scope.space_id;

  update public.activity_events event
  set teaching_project_id = scope.teaching_project_id, village_id = scope.village_id
  from public.legacy_personal_space_scopes scope
  where event.space_id = scope.space_id
    and (event.teaching_project_id is null or event.village_id is null);

  -- Rows created before spaces existed cannot be safely attributed to a student. Preserve them in the
  -- staff-only legacy archive instead of leaving them unreachable behind the contextual RLS predicate.
  update public.object_photos
  set teaching_project_id = coalesce(teaching_project_id, v_project_id),
      village_id = coalesce(village_id, v_mibu_id),
      space_id = coalesce(nullif(space_id, ''), v_legacy_scope)
  where teaching_project_id is null or village_id is null or nullif(space_id, '') is null;
  update public.object_comments
  set teaching_project_id = coalesce(teaching_project_id, v_project_id),
      village_id = coalesce(village_id, v_mibu_id),
      space_id = coalesce(nullif(space_id, ''), v_legacy_scope)
  where teaching_project_id is null or village_id is null or nullif(space_id, '') is null;
  update public.activity_events
  set teaching_project_id = coalesce(teaching_project_id, v_project_id),
      village_id = coalesce(village_id, v_mibu_id),
      space_id = coalesce(nullif(space_id, ''), v_legacy_scope)
  where teaching_project_id is null or village_id is null or nullif(space_id, '') is null;

  select count(*) into v_feature_total_after from public.planning_features;
  select count(*) into v_shared_after from public.planning_features where space_id = v_practice_shared;
  select count(*) into v_copy_after from public.planning_features where space_id like 'copy_%';
  select coalesce(jsonb_agg(jsonb_build_array(id, space_id) order by id), '[]'::jsonb)
  into v_copy_identity_after from public.planning_features where space_id like 'copy_%';
  if v_feature_total_after <> v_feature_total_before then
    raise exception 'FEATURE_COUNT_ASSERTION_FAILED';
  end if;
  if exists (select 1 from public.planning_features where space_id = 'current')
     or v_shared_after <> v_shared_before + v_current_before then
    raise exception 'CURRENT_FEATURE_PROMOTION_ASSERTION_FAILED';
  end if;
  if v_copy_after <> v_copy_before then
    raise exception 'COPY_FEATURE_COUNT_ASSERTION_FAILED';
  end if;
  if v_copy_identity_after <> v_copy_identity_before then
    raise exception 'COPY_FEATURE_IDENTITY_ASSERTION_FAILED';
  end if;
end;
$$;

do $$
declare
  v_constraint name;
  v_object_code_attnum smallint;
  v_object_type_attnum smallint;
begin
  select attnum into v_object_code_attnum from pg_attribute
  where attrelid = 'public.object_attribute_edits'::regclass and attname = 'object_code' and not attisdropped;
  select attnum into v_object_type_attnum from pg_attribute
  where attrelid = 'public.object_attribute_edits'::regclass and attname = 'object_type' and not attisdropped;
  for v_constraint in
    select conname from pg_constraint
    where conrelid = 'public.object_attribute_edits'::regclass and contype = 'u'
      and conkey = array[v_object_code_attnum, v_object_type_attnum]::smallint[]
  loop
    execute format('alter table public.object_attribute_edits drop constraint %I', v_constraint);
  end loop;
end;
$$;
drop index if exists public.object_attribute_edits_code_type_idx;
alter table public.object_attribute_edits
  alter column teaching_project_id set not null,
  alter column village_id set not null,
  alter column space_id set not null;
do $$ begin
  alter table public.object_attribute_edits
    add constraint object_attribute_edits_context_key
    unique (teaching_project_id, village_id, space_id, object_code, object_type);
exception when duplicate_object then null;
end $$;

do $$
declare v_primary_key name;
begin
  select conname into v_primary_key from pg_constraint
  where conrelid = 'public.feature_edit_locks'::regclass and contype = 'p';
  if v_primary_key is not null then
    execute format('alter table public.feature_edit_locks drop constraint %I', v_primary_key);
  end if;
end;
$$;
alter table public.feature_edit_locks
  alter column teaching_project_id set not null,
  alter column village_id set not null,
  add primary key (teaching_project_id, village_id, space_id, layer_key, object_code);
do $$ begin
  alter table public.feature_edit_locks add constraint feature_edit_locks_legacy_identity_key
    unique (space_id, layer_key, object_code);
exception when duplicate_object then null;
end $$;

create or replace function public.is_service_role_request()
returns boolean
language sql stable security definer set search_path = public, auth, pg_temp
as $$
  select coalesce(
    auth.role(),
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  ) = 'service_role';
$$;

create or replace function public.assert_feature_space_exists(
  p_space_id text, p_teaching_project_id uuid, p_village_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_teaching_project_id is null or p_village_id is null or nullif(trim(p_space_id), '') is null
     or not exists (
       select 1 from public.planning_spaces
       where id = p_space_id and teaching_project_id = p_teaching_project_id and village_id = p_village_id
         and space_type is distinct from 'legacy_unscoped'
     ) then
    raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH';
  end if;
end;
$$;

create or replace function public.assert_feature_space_context(
  p_space_id text, p_teaching_project_id uuid, p_village_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_teaching_project_id is null or p_village_id is null or nullif(trim(p_space_id), '') is null
     or not exists (
       select 1 from public.planning_spaces
       where id = p_space_id and teaching_project_id = p_teaching_project_id and village_id = p_village_id
         and space_type <> 'legacy_unscoped'
     ) then
    raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH';
  end if;
end;
$$;

create or replace function public.acquire_feature_edit_lock(
  p_space_id text, p_teaching_project_id uuid, p_village_id uuid, p_layer_key text,
  p_object_code text, p_editor_name text, p_lease_seconds integer default 90
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_editor_name text := public.current_profile_display_name();
  acquired public.feature_edit_locks%rowtype;
  existing public.feature_edit_locks%rowtype;
begin
  if v_user_id is null or v_editor_name is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_feature_space_context(p_space_id, p_teaching_project_id, p_village_id);
  delete from public.feature_edit_locks where expires_at <= now();
  insert into public.feature_edit_locks(
    teaching_project_id, village_id, space_id, layer_key, object_code, editor_name, editor_user_id, lock_token, expires_at, updated_at
  ) values (
    p_teaching_project_id, p_village_id, p_space_id, p_layer_key, p_object_code, v_editor_name, v_user_id, gen_random_uuid(),
    now() + make_interval(secs => greatest(30, p_lease_seconds)), now()
  ) on conflict (teaching_project_id, village_id, space_id, layer_key, object_code) do update
    set editor_name = excluded.editor_name, editor_user_id = excluded.editor_user_id,
        lock_token = case when public.feature_edit_locks.editor_user_id = excluded.editor_user_id
          then public.feature_edit_locks.lock_token else excluded.lock_token end,
        expires_at = excluded.expires_at, updated_at = now()
    where public.feature_edit_locks.expires_at <= now()
       or public.feature_edit_locks.editor_user_id = excluded.editor_user_id
  returning * into acquired;
  if acquired.space_id is not null then
    return jsonb_build_object('success', true, 'spaceId', acquired.space_id, 'layerKey', acquired.layer_key,
      'objectCode', acquired.object_code, 'editorName', acquired.editor_name,
      'lockToken', acquired.lock_token, 'expiresAt', acquired.expires_at);
  end if;
  select * into existing from public.feature_edit_locks
  where teaching_project_id = p_teaching_project_id and village_id = p_village_id and space_id = p_space_id
    and layer_key = p_layer_key and object_code = p_object_code;
  return jsonb_build_object('success', false, 'reason', 'locked', 'editorName', existing.editor_name,
    'expiresAt', existing.expires_at);
end;
$$;

create or replace function public.heartbeat_feature_edit_lock(
  p_space_id text, p_teaching_project_id uuid, p_village_id uuid, p_layer_key text,
  p_object_code text, p_editor_name text, p_lock_token uuid, p_lease_seconds integer default 90
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare affected integer; v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_feature_space_context(p_space_id, p_teaching_project_id, p_village_id);
  update public.feature_edit_locks set expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)), updated_at = now()
  where teaching_project_id = p_teaching_project_id and village_id = p_village_id and space_id = p_space_id
    and layer_key = p_layer_key and object_code = p_object_code and editor_user_id = v_user_id and lock_token = p_lock_token;
  get diagnostics affected = row_count;
  return jsonb_build_object('success', affected = 1);
end;
$$;

create or replace function public.release_feature_edit_lock(
  p_space_id text, p_teaching_project_id uuid, p_village_id uuid, p_layer_key text,
  p_object_code text, p_editor_name text, p_lock_token uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare affected integer; v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_feature_space_context(p_space_id, p_teaching_project_id, p_village_id);
  delete from public.feature_edit_locks
  where teaching_project_id = p_teaching_project_id and village_id = p_village_id and space_id = p_space_id
    and layer_key = p_layer_key and object_code = p_object_code and editor_user_id = v_user_id and lock_token = p_lock_token;
  get diagnostics affected = row_count;
  return jsonb_build_object('success', affected = 1);
end;
$$;

create or replace function public.save_feature_edit_batch(
  p_space_id text, p_teaching_project_id uuid, p_village_id uuid, p_editor_name text,
  p_summary text, p_note text, p_changes jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_editor_name text := public.current_profile_display_name();
  batch_uuid uuid; change_row jsonb; change_action text; change_layer_key text; change_object_code text;
begin
  if v_user_id is null or v_editor_name is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_feature_space_context(p_space_id, p_teaching_project_id, p_village_id);
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'changes must be a non-empty array';
  end if;
  insert into public.feature_change_batches(teaching_project_id, village_id, space_id, editor_name, editor_user_id, summary, note)
  values (p_teaching_project_id, p_village_id, p_space_id, v_editor_name, v_user_id,
    coalesce(nullif(p_summary, ''), '要素编辑'), coalesce(p_note, '')) returning id into batch_uuid;
  for change_row in select value from jsonb_array_elements(p_changes) loop
    change_action := change_row->>'action'; change_layer_key := change_row->>'layerKey'; change_object_code := change_row->>'objectCode';
    if change_action not in ('add', 'update', 'delete') then raise exception 'invalid feature action: %', change_action; end if;
    if change_action <> 'add' and not exists (
      select 1 from public.feature_edit_locks where teaching_project_id = p_teaching_project_id
        and village_id = p_village_id and space_id = p_space_id and layer_key = change_layer_key
        and object_code = change_object_code and editor_user_id = v_user_id and expires_at > now()
    ) then raise exception 'feature lock required: %.%', change_layer_key, change_object_code; end if;
    insert into public.feature_versions(
      batch_id, teaching_project_id, village_id, space_id, layer_key, object_code, action,
      before_geom, after_geom, before_props, after_props, created_by, created_by_user_id
    ) values (batch_uuid, p_teaching_project_id, p_village_id, p_space_id, change_layer_key, change_object_code,
      change_action, change_row->'beforeGeom', change_row->'afterGeom', change_row->'beforeProps',
      change_row->'afterProps', v_editor_name, v_user_id);
    if change_action = 'delete' then
      update public.planning_features set is_deleted = true, updated_at = now()
      where teaching_project_id = p_teaching_project_id and village_id = p_village_id and space_id = p_space_id
        and layer_key = change_layer_key and object_code = change_object_code;
    else
      insert into public.planning_features(
        teaching_project_id, village_id, space_id, layer_key, object_code, object_name, geom, props, is_deleted
      ) values (p_teaching_project_id, p_village_id, p_space_id, change_layer_key, change_object_code,
        coalesce(change_row->>'objectName', change_object_code), change_row->'afterGeom',
        coalesce(change_row->'afterProps', '{}'::jsonb), false)
      on conflict (space_id, layer_key, object_code) do update set object_name = excluded.object_name,
        geom = excluded.geom, props = excluded.props, is_deleted = false, updated_at = now();
    end if;
    delete from public.feature_edit_locks where teaching_project_id = p_teaching_project_id and village_id = p_village_id
      and space_id = p_space_id and layer_key = change_layer_key and object_code = change_object_code and editor_user_id = v_user_id;
  end loop;
  return batch_uuid;
end;
$$;

create or replace function public.freeze_feature_snapshot(
  p_space_id text, p_teaching_project_id uuid, p_village_id uuid, p_version_name text,
  p_description text, p_created_by text, p_version_type text default 'published', p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  snapshot_uuid uuid;
  v_is_service_role boolean := public.is_service_role_request();
begin
  if v_is_service_role then
    -- Service jobs do not necessarily carry a user subject, but must still name a real context.
    perform public.assert_feature_space_exists(p_space_id, p_teaching_project_id, p_village_id);
  end if;
  if not v_is_service_role then
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if public.current_profile_role() not in ('teacher', 'admin') then raise exception 'STAFF_REQUIRED'; end if;
    perform public.assert_feature_space_context(p_space_id, p_teaching_project_id, p_village_id);
  end if;
  insert into public.feature_snapshots(
    teaching_project_id, village_id, space_id, version_name, version_type, description, created_by, is_published
  ) values (p_teaching_project_id, p_village_id, p_space_id, p_version_name, p_version_type,
    coalesce(p_description, ''), p_created_by, true) returning id into snapshot_uuid;
  if jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.feature_snapshot_items(snapshot_id, layer_key, object_code, object_name, geom, props, is_deleted)
    select snapshot_uuid, item->>'layerKey', item->>'objectCode', item->>'objectName', item->'geom',
      coalesce(item->'props', '{}'::jsonb), coalesce((item->>'isDeleted')::boolean, false)
    from jsonb_array_elements(p_items) item;
  else
    insert into public.feature_snapshot_items(snapshot_id, layer_key, object_code, object_name, geom, props, is_deleted)
    select snapshot_uuid, layer_key, object_code, object_name, geom, props, is_deleted
    from public.planning_features where teaching_project_id = p_teaching_project_id and village_id = p_village_id
      and space_id = p_space_id;
  end if;
  return snapshot_uuid;
end;
$$;

revoke all on function public.is_service_role_request() from public, anon, authenticated;
revoke all on function public.assert_feature_space_exists(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.assert_feature_space_context(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.acquire_feature_edit_lock(text,uuid,uuid,text,text,text,integer) from public, anon;
revoke all on function public.heartbeat_feature_edit_lock(text,uuid,uuid,text,text,text,uuid,integer) from public, anon;
revoke all on function public.release_feature_edit_lock(text,uuid,uuid,text,text,text,uuid) from public, anon;
revoke all on function public.save_feature_edit_batch(text,uuid,uuid,text,text,text,jsonb) from public, anon;
revoke all on function public.freeze_feature_snapshot(text,uuid,uuid,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.acquire_feature_edit_lock(text,uuid,uuid,text,text,text,integer) to authenticated;
grant execute on function public.heartbeat_feature_edit_lock(text,uuid,uuid,text,text,text,uuid,integer) to authenticated;
grant execute on function public.release_feature_edit_lock(text,uuid,uuid,text,text,text,uuid) to authenticated;
grant execute on function public.save_feature_edit_batch(text,uuid,uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.freeze_feature_snapshot(text,uuid,uuid,text,text,text,text,jsonb) to authenticated;
grant execute on function public.freeze_feature_snapshot(text,uuid,uuid,text,text,text,text,jsonb) to service_role;

-- Context-bearing records are no longer publicly writable. Shared spaces remain visible to authenticated
-- students, while personal/group spaces additionally require ownership, membership, or staff status.
create or replace function public.context_space_accessible(
  p_teaching_project_id uuid, p_village_id uuid, p_space_id text
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.planning_spaces space
    join public.teaching_projects project on project.id = space.teaching_project_id
    where space.id = p_space_id and space.teaching_project_id = p_teaching_project_id
      and space.village_id = p_village_id and space.space_type <> 'legacy_unscoped'
      and (
        space.space_type in ('practice_shared', 'formal_shared')
        or space.owner_id = auth.uid()
        or public.current_profile_role() in ('teacher', 'admin')
        or (space.group_id is not null and exists (
          select 1 from public.group_memberships membership
          where membership.course_id = project.course_id and membership.group_id = space.group_id
            and membership.student_key = public.current_profile_student_key()
        ))
      )
  );
$$;
revoke all on function public.context_space_accessible(uuid,uuid,text) from public, anon;
grant execute on function public.context_space_accessible(uuid,uuid,text) to authenticated;

do $$
declare policy_row record;
begin
  for policy_row in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename = any(array[
      'planning_spaces', 'planning_features', 'community_tasks', 'object_photos', 'object_comments',
      'object_attribute_edits', 'feature_edit_locks', 'feature_change_batches', 'feature_versions',
      'feature_snapshots', 'feature_snapshot_items', 'activity_events'
    ])
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end;
$$;

alter table public.planning_spaces enable row level security;
alter table public.planning_features enable row level security;
alter table public.community_tasks enable row level security;
alter table public.object_photos enable row level security;
alter table public.object_comments enable row level security;
alter table public.object_attribute_edits enable row level security;
alter table public.feature_edit_locks enable row level security;
alter table public.feature_change_batches enable row level security;
alter table public.feature_versions enable row level security;
alter table public.feature_snapshots enable row level security;
alter table public.feature_snapshot_items enable row level security;
alter table public.activity_events enable row level security;

revoke all on table public.planning_spaces, public.planning_features, public.community_tasks,
  public.object_photos, public.object_comments, public.object_attribute_edits, public.feature_edit_locks,
  public.feature_change_batches, public.feature_versions, public.feature_snapshots, public.feature_snapshot_items,
  public.activity_events
  from public, anon;
revoke insert, update, delete on table public.planning_spaces, public.planning_features, public.community_tasks,
  public.object_photos, public.object_comments, public.object_attribute_edits, public.feature_edit_locks,
  public.feature_change_batches, public.feature_versions, public.feature_snapshots, public.feature_snapshot_items,
  public.activity_events from authenticated;
grant select on table public.planning_spaces, public.planning_features, public.community_tasks,
  public.object_photos, public.object_comments, public.object_attribute_edits, public.feature_edit_locks,
  public.feature_change_batches, public.feature_versions, public.feature_snapshots, public.feature_snapshot_items,
  public.activity_events
  to authenticated;
grant insert, update on table public.community_tasks, public.object_photos, public.object_comments,
  public.object_attribute_edits, public.activity_events to authenticated;

create policy context_rows_read on public.planning_spaces for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, id));
create policy context_rows_read on public.planning_features for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_read on public.feature_edit_locks for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_read on public.feature_change_batches for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_read on public.feature_versions for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_read on public.feature_snapshots for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_read on public.feature_snapshot_items for select to authenticated
  using (exists (
    select 1 from public.feature_snapshots snapshot
    where snapshot.id = snapshot_id
      and public.context_space_accessible(snapshot.teaching_project_id, snapshot.village_id, snapshot.space_id)
  ));

create policy context_rows_read on public.community_tasks for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_insert on public.community_tasks for insert to authenticated
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.community_tasks for update to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id))
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));

create policy context_rows_read on public.object_photos for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_insert on public.object_photos for insert to authenticated
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.object_photos for update to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id))
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));

create policy context_rows_read on public.object_comments for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_insert on public.object_comments for insert to authenticated
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.object_comments for update to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id))
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));

create policy context_rows_read on public.object_attribute_edits for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_insert on public.object_attribute_edits for insert to authenticated
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.object_attribute_edits for update to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id))
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));

create policy context_rows_read on public.activity_events for select to authenticated
  using (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_insert on public.activity_events for insert to authenticated
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.activity_events for update to authenticated
  using (public.current_profile_role() in ('teacher', 'admin'))
  with check (public.context_space_accessible(teaching_project_id, village_id, space_id));

-- A shared-space read requires a participant in the project's course (or staff); it is not global to all users.
create or replace function public.context_space_accessible(
  p_teaching_project_id uuid, p_village_id uuid, p_space_id text
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.planning_spaces space
    join public.teaching_projects project on project.id = space.teaching_project_id
    where space.id = p_space_id and space.teaching_project_id = p_teaching_project_id
      and space.village_id = p_village_id and space.space_type <> 'legacy_unscoped'
      and (
        public.current_profile_role() in ('teacher', 'admin')
        or space.owner_id = auth.uid()
        or exists (
          select 1 from public.group_memberships membership
          where membership.course_id = project.course_id
            and membership.student_key = public.current_profile_student_key()
            and (space.space_type in ('practice_shared', 'formal_shared')
              or membership.group_id = space.group_id)
        )
      )
  );
$$;

create or replace function public.context_space_mutable(
  p_teaching_project_id uuid, p_village_id uuid, p_space_id text
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.planning_spaces space
    join public.teaching_projects project on project.id = space.teaching_project_id
    where space.id = p_space_id and space.teaching_project_id = p_teaching_project_id
      and space.village_id = p_village_id and space.readonly = false and space.edit_enabled = true
      and space.space_type in ('practice_shared', 'formal_shared', 'practice_personal', 'formal_personal', 'group_plan')
      and (
        public.current_profile_role() in ('teacher', 'admin')
        or (space.space_type in ('practice_personal', 'formal_personal') and space.owner_id = auth.uid())
        or (space.space_type in ('practice_shared', 'formal_shared') and exists (
          select 1 from public.group_memberships membership
          where membership.course_id = project.course_id
            and membership.student_key = public.current_profile_student_key()
        ))
        or (space.space_type = 'group_plan' and exists (
          select 1 from public.group_memberships membership
          where membership.course_id = project.course_id and membership.group_id = space.group_id
            and membership.student_key = public.current_profile_student_key()
        ))
      )
  );
$$;

create or replace function public.assert_feature_space_context(
  p_space_id text, p_teaching_project_id uuid, p_village_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null and not public.is_service_role_request() then raise exception 'AUTH_REQUIRED'; end if;
  if not public.context_space_mutable(p_teaching_project_id, p_village_id, p_space_id) then
    raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH';
  end if;
end;
$$;

revoke all on function public.context_space_mutable(uuid,uuid,text) from public, anon;
grant execute on function public.context_space_mutable(uuid,uuid,text) to authenticated;
grant delete on table public.community_tasks, public.object_photos,
  public.object_comments, public.object_attribute_edits to authenticated;

create or replace function public.resolve_legacy_feature_context(p_space_id text)
returns table(resolved_space_id text, teaching_project_id uuid, village_id uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null and not public.is_service_role_request() then raise exception 'AUTH_REQUIRED'; end if;
  return query
    select space.id, space.teaching_project_id, space.village_id
    from public.planning_spaces space
    where space.id = p_space_id
    union all
    select space.id, space.teaching_project_id, space.village_id
    from public.planning_spaces space
    where p_space_id = 'current' and space.course_id = 'mibu-village-planning'
      and space.space_type = 'practice_shared'
    limit 1;
end;
$$;

create or replace function public.acquire_feature_edit_lock(
  p_space_id text, p_layer_key text, p_object_code text, p_editor_name text, p_lease_seconds integer default 90
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$ declare context_row record;
begin
  select * into context_row from public.resolve_legacy_feature_context(p_space_id);
  if not found then raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH'; end if;
  return public.acquire_feature_edit_lock(context_row.resolved_space_id, context_row.teaching_project_id,
    context_row.village_id, p_layer_key, p_object_code, p_editor_name, p_lease_seconds);
end; $$;

create or replace function public.heartbeat_feature_edit_lock(
  p_space_id text, p_layer_key text, p_object_code text, p_editor_name text, p_lock_token uuid, p_lease_seconds integer default 90
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$ declare context_row record;
begin
  select * into context_row from public.resolve_legacy_feature_context(p_space_id);
  if not found then raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH'; end if;
  return public.heartbeat_feature_edit_lock(context_row.resolved_space_id, context_row.teaching_project_id,
    context_row.village_id, p_layer_key, p_object_code, p_editor_name, p_lock_token, p_lease_seconds);
end; $$;

create or replace function public.release_feature_edit_lock(
  p_space_id text, p_layer_key text, p_object_code text, p_editor_name text, p_lock_token uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$ declare context_row record;
begin
  select * into context_row from public.resolve_legacy_feature_context(p_space_id);
  if not found then raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH'; end if;
  return public.release_feature_edit_lock(context_row.resolved_space_id, context_row.teaching_project_id,
    context_row.village_id, p_layer_key, p_object_code, p_editor_name, p_lock_token);
end; $$;

create or replace function public.save_feature_edit_batch(
  p_space_id text, p_editor_name text, p_summary text, p_note text, p_changes jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$ declare context_row record;
begin
  select * into context_row from public.resolve_legacy_feature_context(p_space_id);
  if not found then raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH'; end if;
  return public.save_feature_edit_batch(context_row.resolved_space_id, context_row.teaching_project_id,
    context_row.village_id, p_editor_name, p_summary, p_note, p_changes);
end; $$;

revoke all on function public.resolve_legacy_feature_context(text) from public, anon;
revoke all on function public.acquire_feature_edit_lock(text,text,text,text,integer) from public, anon;
revoke all on function public.heartbeat_feature_edit_lock(text,text,text,text,uuid,integer) from public, anon;
revoke all on function public.release_feature_edit_lock(text,text,text,text,uuid) from public, anon;
revoke all on function public.save_feature_edit_batch(text,text,text,text,jsonb) from public, anon;
grant execute on function public.acquire_feature_edit_lock(text,text,text,text,integer) to authenticated;
grant execute on function public.heartbeat_feature_edit_lock(text,text,text,text,uuid,integer) to authenticated;
grant execute on function public.release_feature_edit_lock(text,text,text,text,uuid) to authenticated;
grant execute on function public.save_feature_edit_batch(text,text,text,text,jsonb) to authenticated;

-- Keep the legacy snapshot signature usable after `current` was promoted to the seeded shared space.
create or replace function public.freeze_feature_snapshot(
  p_space_id text, p_version_name text, p_description text, p_created_by text,
  p_version_type text default 'published', p_items jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare context_row record; v_items jsonb := p_items;
begin
  select * into context_row from public.resolve_legacy_feature_context(p_space_id);
  if not found then raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH'; end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'layerKey', layer_key, 'objectCode', object_code, 'objectName', object_name,
      'geom', geom, 'props', props, 'isDeleted', is_deleted
    ) order by layer_key, object_code), '[]'::jsonb) into v_items
    from public.planning_features
    where teaching_project_id = context_row.teaching_project_id and village_id = context_row.village_id
      and space_id = context_row.resolved_space_id;
  end if;
  if jsonb_array_length(v_items) = 0 then raise exception 'SNAPSHOT_ITEMS_REQUIRED'; end if;
  return public.freeze_feature_snapshot(context_row.resolved_space_id, context_row.teaching_project_id,
    context_row.village_id, p_version_name, p_description, p_created_by, p_version_type, v_items);
end; $$;
revoke all on function public.freeze_feature_snapshot(text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.freeze_feature_snapshot(text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.freeze_feature_snapshot(text,text,text,text,text,jsonb) to service_role;

create or replace function public.legacy_personal_space_owned(
  p_space_id text, p_teaching_project_id uuid default null, p_village_id uuid default null
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.legacy_personal_space_scopes scope
    where scope.space_id = p_space_id
      and scope.owner_id = auth.uid()
      and scope.ownership_status = 'owned'
      and (p_teaching_project_id is null or scope.teaching_project_id = p_teaching_project_id)
      and (p_village_id is null or scope.village_id = p_village_id)
  );
$$;
revoke all on function public.legacy_personal_space_owned(text,uuid,uuid) from public, anon;
grant execute on function public.legacy_personal_space_owned(text,uuid,uuid) to authenticated;

create or replace function public.prepare_legacy_personal_planning_space()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  scope public.legacy_personal_space_scopes%rowtype;
  project_row public.teaching_projects%rowtype;
  dataset_uuid uuid;
begin
  if new.id not like 'copy_%' then return new; end if;
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into scope from public.legacy_personal_space_scopes where space_id = new.id;
  if found and (scope.ownership_status <> 'owned' or scope.owner_id <> auth.uid()) then
    raise exception 'LEGACY_PERSONAL_SPACE_FORBIDDEN';
  end if;
  select * into project_row from public.teaching_projects
    where stage <> 'archived' order by created_at desc limit 1;
  if project_row.id is null then raise exception 'PROJECT_REQUIRED'; end if;
  select id into dataset_uuid from public.village_datasets
    where village_id = project_row.practice_village_id and status = 'published' limit 1;

  insert into public.legacy_personal_space_scopes(
    space_id, teaching_project_id, village_id, owner_id, source_student_key, ownership_status
  ) values (
    new.id, project_row.id, project_row.practice_village_id, auth.uid(),
    public.current_profile_student_key(), 'owned'
  ) on conflict(space_id) do update set
    teaching_project_id = excluded.teaching_project_id, village_id = excluded.village_id,
    owner_id = excluded.owner_id, source_student_key = excluded.source_student_key,
    ownership_status = 'owned', updated_at = now();

  new.teaching_project_id := project_row.id;
  new.village_id := project_row.practice_village_id;
  new.base_dataset_id := dataset_uuid;
  new.owner_id := auth.uid();
  new.course_id := project_row.course_id;
  new.group_id := new.id;
  new.space_type := 'legacy_personal';
  return new;
end;
$$;
drop trigger if exists trg_prepare_legacy_personal_planning_space on public.planning_spaces;
create trigger trg_prepare_legacy_personal_planning_space
before insert or update on public.planning_spaces
for each row execute function public.prepare_legacy_personal_planning_space();
revoke all on function public.prepare_legacy_personal_planning_space() from public, anon, authenticated;

create or replace function public.prepare_legacy_personal_planning_feature()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare scope public.legacy_personal_space_scopes%rowtype;
begin
  if new.space_id not like 'copy_%' then return new; end if;
  select * into scope from public.legacy_personal_space_scopes where space_id = new.space_id;
  if not found or scope.ownership_status <> 'owned' or scope.owner_id <> auth.uid() then
    raise exception 'LEGACY_PERSONAL_SPACE_FORBIDDEN';
  end if;
  new.teaching_project_id := scope.teaching_project_id;
  new.village_id := scope.village_id;
  return new;
end;
$$;
drop trigger if exists trg_prepare_legacy_personal_planning_feature on public.planning_features;
create trigger trg_prepare_legacy_personal_planning_feature
before insert or update on public.planning_features
for each row execute function public.prepare_legacy_personal_planning_feature();
revoke all on function public.prepare_legacy_personal_planning_feature() from public, anon, authenticated;

-- Final read predicate: ordinary project spaces follow course membership; legacy copies are owner-only,
-- while ambiguous archives are visible only to staff for recovery.
create or replace function public.context_space_accessible(
  p_teaching_project_id uuid, p_village_id uuid, p_space_id text
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.planning_spaces space
      join public.teaching_projects project on project.id = space.teaching_project_id
      where space.id = p_space_id and space.teaching_project_id = p_teaching_project_id
        and space.village_id = p_village_id
        and space.space_type not in ('legacy_unscoped', 'legacy_personal')
        and (
          public.current_profile_role() in ('teacher', 'admin')
          or space.owner_id = auth.uid()
          or exists (
            select 1 from public.group_memberships membership
            where membership.course_id = project.course_id
              and membership.student_key = public.current_profile_student_key()
              and (space.space_type in ('practice_shared', 'formal_shared')
                or membership.group_id = space.group_id)
          )
        )
    )
    or exists (
      select 1 from public.legacy_personal_space_scopes scope
      where scope.space_id = p_space_id
        and scope.teaching_project_id = p_teaching_project_id
        and scope.village_id = p_village_id
        and (
          (scope.ownership_status = 'owned' and scope.owner_id = auth.uid())
          or (scope.ownership_status = 'archival'
            and public.current_profile_role() in ('teacher', 'admin'))
        )
    )
  );
$$;

drop policy if exists legacy_personal_scope_read on public.legacy_personal_space_scopes;
create policy legacy_personal_scope_read on public.legacy_personal_space_scopes for select to authenticated
  using ((ownership_status = 'owned' and owner_id = auth.uid())
    or (ownership_status = 'archival' and public.current_profile_role() in ('teacher', 'admin')));
revoke all on table public.legacy_personal_space_scopes from public, anon;
grant select on table public.legacy_personal_space_scopes to authenticated;

grant insert, update, delete on table public.planning_spaces to authenticated;
drop policy if exists legacy_personal_spaces_insert on public.planning_spaces;
drop policy if exists legacy_personal_spaces_update on public.planning_spaces;
drop policy if exists legacy_personal_spaces_delete on public.planning_spaces;
create policy legacy_personal_spaces_insert on public.planning_spaces for insert to authenticated
  with check (public.legacy_personal_space_owned(id, teaching_project_id, village_id));
create policy legacy_personal_spaces_update on public.planning_spaces for update to authenticated
  using (public.legacy_personal_space_owned(id, teaching_project_id, village_id))
  with check (public.legacy_personal_space_owned(id, teaching_project_id, village_id));
create policy legacy_personal_spaces_delete on public.planning_spaces for delete to authenticated
  using (public.legacy_personal_space_owned(id, teaching_project_id, village_id));

grant insert, update on table public.planning_features to authenticated;
drop policy if exists legacy_personal_features_insert on public.planning_features;
drop policy if exists legacy_personal_features_update on public.planning_features;
create policy legacy_personal_features_insert on public.planning_features for insert to authenticated
  with check (public.legacy_personal_space_owned(space_id, teaching_project_id, village_id));
create policy legacy_personal_features_update on public.planning_features for update to authenticated
  using (public.legacy_personal_space_owned(space_id, teaching_project_id, village_id))
  with check (public.legacy_personal_space_owned(space_id, teaching_project_id, village_id));

-- Collaboration content cannot be changed through a read-only or edit-disabled space.
drop policy if exists context_rows_insert on public.community_tasks;
drop policy if exists context_rows_update on public.community_tasks;
create policy context_rows_insert on public.community_tasks for insert to authenticated
  with check (public.context_space_mutable(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.community_tasks for update to authenticated
  using (public.context_space_mutable(teaching_project_id, village_id, space_id))
  with check (public.context_space_mutable(teaching_project_id, village_id, space_id));
drop policy if exists context_rows_insert on public.object_photos;
drop policy if exists context_rows_update on public.object_photos;
create policy context_rows_insert on public.object_photos for insert to authenticated
  with check (public.context_space_mutable(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.object_photos for update to authenticated
  using (public.context_space_mutable(teaching_project_id, village_id, space_id))
  with check (public.context_space_mutable(teaching_project_id, village_id, space_id));
drop policy if exists context_rows_insert on public.object_comments;
drop policy if exists context_rows_update on public.object_comments;
create policy context_rows_insert on public.object_comments for insert to authenticated
  with check (public.context_space_mutable(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.object_comments for update to authenticated
  using (public.context_space_mutable(teaching_project_id, village_id, space_id))
  with check (public.context_space_mutable(teaching_project_id, village_id, space_id));
drop policy if exists context_rows_insert on public.object_attribute_edits;
drop policy if exists context_rows_update on public.object_attribute_edits;
create policy context_rows_insert on public.object_attribute_edits for insert to authenticated
  with check (public.context_space_mutable(teaching_project_id, village_id, space_id));
create policy context_rows_update on public.object_attribute_edits for update to authenticated
  using (public.context_space_mutable(teaching_project_id, village_id, space_id))
  with check (public.context_space_mutable(teaching_project_id, village_id, space_id));

-- Legacy collaboration records have no stable author UUIDs, so only staff may delete them.
drop policy if exists context_rows_delete on public.community_tasks;
drop policy if exists context_rows_delete on public.object_photos;
drop policy if exists context_rows_delete on public.object_comments;
drop policy if exists context_rows_delete on public.object_attribute_edits;
create policy context_rows_delete on public.community_tasks for delete to authenticated
  using (public.current_profile_role() in ('teacher', 'admin')
    and public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_delete on public.object_photos for delete to authenticated
  using (public.current_profile_role() in ('teacher', 'admin')
    and public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_delete on public.object_comments for delete to authenticated
  using (public.current_profile_role() in ('teacher', 'admin')
    and public.context_space_accessible(teaching_project_id, village_id, space_id));
create policy context_rows_delete on public.object_attribute_edits for delete to authenticated
  using (public.current_profile_role() in ('teacher', 'admin')
    and public.context_space_accessible(teaching_project_id, village_id, space_id));
revoke delete on table public.planning_features from authenticated;

alter table public.geoprocessing_runs
  add column if not exists teaching_project_id uuid references public.teaching_projects(id) on delete restrict,
  add column if not exists dataset_id uuid references public.village_datasets(id) on delete restrict,
  add column if not exists input_manifest jsonb;

create or replace function public.submit_geoprocessing_run(
  p_course_id text, p_village_id text, p_requested_steps text[], p_aoi jsonb, p_parameters jsonb,
  p_teaching_project_id uuid, p_dataset_id uuid
) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_run_id uuid; v_village public.villages; v_dataset public.village_datasets; v_input_manifest jsonb; v_bounds jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_teaching_project_id is null then raise exception 'TEACHING_PROJECT_REQUIRED'; end if;
  if p_dataset_id is null then raise exception 'DATASET_REQUIRED'; end if;
  select * into v_village from public.villages where id::text = p_village_id;
  select * into v_dataset from public.village_datasets where id = p_dataset_id;
  if v_village.id is null or v_dataset.id is null or v_dataset.village_id <> v_village.id then
    raise exception 'DATASET_VILLAGE_MISMATCH';
  end if;
  if v_dataset.status <> 'published' and public.current_profile_role() not in ('teacher', 'admin') then
    raise exception 'PUBLISHED_DATASET_REQUIRED';
  end if;
  if not exists (select 1 from public.teaching_projects where id = p_teaching_project_id and course_id = p_course_id
    and v_village.id in (practice_village_id, formal_village_id)) then raise exception 'PROJECT_VILLAGE_MISMATCH'; end if;
  if public.current_profile_role() not in ('teacher', 'admin') and not exists (
    select 1 from public.group_memberships membership
    where membership.course_id = p_course_id
      and membership.student_key = public.current_profile_student_key()
  ) then raise exception 'PROJECT_ACCESS_REQUIRED'; end if;
  v_input_manifest := v_dataset.layer_manifest->'worker_manifest';
  if jsonb_typeof(v_input_manifest) <> 'object' or jsonb_typeof(v_input_manifest->'files') <> 'object'
    or v_input_manifest::text ~* 'https?://' then raise exception 'WORKER_MANIFEST_REQUIRED'; end if;
  v_bounds := jsonb_build_array(st_xmin(box2d(v_village.boundary)), st_ymin(box2d(v_village.boundary)),
    st_xmax(box2d(v_village.boundary)), st_ymax(box2d(v_village.boundary)));
  insert into public.geoprocessing_villages(village_id, display_name, bounds, max_aoi_sq_km, active)
  values (v_village.id::text, v_village.name, v_bounds, greatest(st_area(v_village.boundary::geography) / 1000000.0, 0.01), true)
  on conflict(village_id) do update set display_name = excluded.display_name, bounds = excluded.bounds,
    max_aoi_sq_km = excluded.max_aoi_sq_km, active = true;
  v_run_id := public.submit_geoprocessing_run(p_course_id, p_village_id, p_requested_steps, p_aoi, p_parameters);
  update public.geoprocessing_runs set teaching_project_id = p_teaching_project_id, dataset_id = p_dataset_id,
    input_manifest = v_input_manifest where id = v_run_id;
  return v_run_id;
end;
$$;
revoke all on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb,uuid,uuid) from public, anon;
grant execute on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb,uuid,uuid) to authenticated;

-- The legacy Minecraft bridge is still account-scoped rather than project-scoped. Enable RLS now without
-- breaking the signed-in export workflow; a later MC-specific migration can add project UUIDs and tighter scope.
alter table public.mc_sync_config enable row level security;
alter table public.mc_building_state enable row level security;
revoke all on table public.mc_sync_config from public, anon;
revoke all on table public.mc_building_state from public, anon;
revoke all on table public.mc_sync_config from authenticated;
revoke all on table public.mc_building_state from authenticated;
grant select on table public.mc_sync_config, public.mc_building_state to authenticated;
grant insert, update on table public.mc_building_state to authenticated;

drop policy if exists mc_sync_config_authenticated_read on public.mc_sync_config;
create policy mc_sync_config_authenticated_read on public.mc_sync_config for select to authenticated
  using (true);
drop policy if exists mc_building_state_authenticated_read on public.mc_building_state;
create policy mc_building_state_authenticated_read on public.mc_building_state for select to authenticated
  using (true);
drop policy if exists mc_building_state_authenticated_write on public.mc_building_state;
create policy mc_building_state_authenticated_write on public.mc_building_state for insert to authenticated
  with check (auth.uid() is not null);
drop policy if exists mc_building_state_authenticated_update on public.mc_building_state;
create policy mc_building_state_authenticated_update on public.mc_building_state for update to authenticated
  using (auth.uid() is not null) with check (auth.uid() is not null);

alter function public.set_updated_at() set search_path = public, pg_temp;

commit;
