begin;

-- 阶段 2 增量迁移：正式村庄全班共享现状的对象级几何校核与冻结证据。
-- 依赖 Multi-Village Dual-Track Repair.sql，允许重复执行。

create table if not exists public.survey_feature_reviews (
  id uuid primary key default gen_random_uuid(),
  teaching_project_id uuid not null references public.teaching_projects(id) on delete restrict,
  village_id uuid not null references public.villages(id) on delete restrict,
  space_id text not null references public.planning_spaces(id) on delete cascade,
  base_dataset_id uuid not null references public.village_datasets(id) on delete restrict,
  layer_key text not null check (layer_key in ('building', 'road', 'water')),
  object_code text not null check (btrim(object_code) <> ''),
  is_v0_baseline boolean not null,
  baseline_object_code text,
  geometry_status text not null default 'pending'
    check (geometry_status in ('pending', 'confirmed_unchanged', 'modified', 'deleted', 'added')),
  geometry_revision bigint not null default 0 check (geometry_revision >= 0),
  is_deleted boolean not null default false,
  first_reviewed_by uuid references auth.users(id) on delete set null,
  first_reviewed_at timestamptz,
  latest_modified_by uuid references auth.users(id) on delete set null,
  latest_modified_at timestamptz,
  latest_geometry_batch_id uuid references public.feature_change_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teaching_project_id, village_id, space_id, layer_key, object_code),
  check (
    (is_v0_baseline and baseline_object_code is not null and btrim(baseline_object_code) <> '')
    or (not is_v0_baseline and baseline_object_code is null)
  ),
  check (
    (is_v0_baseline and geometry_status <> 'added')
    or (not is_v0_baseline and geometry_status = 'added')
  )
);

create index if not exists survey_feature_reviews_progress_idx
  on public.survey_feature_reviews(
    teaching_project_id, village_id, space_id, layer_key, geometry_status
  );

create index if not exists survey_feature_reviews_actor_idx
  on public.survey_feature_reviews(
    teaching_project_id, village_id, space_id, latest_modified_by, latest_modified_at desc
  );

alter table public.planning_spaces
  add column if not exists base_snapshot_id uuid references public.feature_snapshots(id) on delete restrict;

alter table public.feature_snapshots
  add column if not exists version_number integer,
  add column if not exists recommended_for_groups boolean not null default false,
  add column if not exists stats jsonb not null default '{}'::jsonb;

create unique index if not exists feature_snapshots_context_version_uidx
  on public.feature_snapshots(teaching_project_id, village_id, space_id, version_number)
  where version_number is not null;

create table if not exists public.community_task_versions (
  id uuid primary key default gen_random_uuid(),
  issue_id bigint not null references public.community_tasks(id) on delete restrict,
  revision bigint not null check (revision > 0),
  teaching_project_id uuid not null references public.teaching_projects(id) on delete restrict,
  village_id uuid not null references public.villages(id) on delete restrict,
  space_id text not null references public.planning_spaces(id) on delete cascade,
  frozen_payload jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (issue_id, revision)
);

create index if not exists community_task_versions_context_idx
  on public.community_task_versions(teaching_project_id, village_id, space_id, issue_id, revision desc);

create table if not exists public.survey_snapshot_photo_refs (
  snapshot_id uuid not null references public.feature_snapshots(id) on delete cascade,
  photo_id bigint not null references public.object_photos(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, photo_id)
);

create table if not exists public.survey_snapshot_issue_refs (
  snapshot_id uuid not null references public.feature_snapshots(id) on delete cascade,
  issue_version_id uuid not null references public.community_task_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, issue_version_id)
);

create or replace function public.append_community_task_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_revision bigint;
begin
  if new.teaching_project_id is null or new.village_id is null or new.space_id is null then
    return new;
  end if;
  select coalesce(max(version.revision), 0) + 1 into v_revision
  from public.community_task_versions version where version.issue_id = new.id;
  insert into public.community_task_versions(
    issue_id, revision, teaching_project_id, village_id, space_id, frozen_payload, created_by
  ) values (
    new.id, v_revision, new.teaching_project_id, new.village_id, new.space_id,
    to_jsonb(new), auth.uid()
  );
  return new;
end;
$function$;

drop trigger if exists trg_community_task_version on public.community_tasks;
create trigger trg_community_task_version
after insert or update on public.community_tasks
for each row execute function public.append_community_task_version();

insert into public.community_task_versions(
  issue_id, revision, teaching_project_id, village_id, space_id, frozen_payload, created_by
)
select issue.id, 1, issue.teaching_project_id, issue.village_id, issue.space_id, to_jsonb(issue), null
from public.community_tasks issue
where issue.teaching_project_id is not null and issue.village_id is not null and issue.space_id is not null
  and not exists (select 1 from public.community_task_versions version where version.issue_id = issue.id);

create or replace function public.assert_survey_review_context(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text
) returns public.planning_spaces
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_space public.planning_spaces;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select space.* into v_space
  from public.planning_spaces space
  where space.id = p_space_id
    and space.teaching_project_id = p_teaching_project_id
    and space.village_id = p_village_id
    and space.space_type = 'formal_shared';

  if not found then
    raise exception 'FORMAL_SHARED_SPACE_REQUIRED';
  end if;

  if not public.context_space_accessible(
    p_teaching_project_id, p_village_id, p_space_id
  ) then
    raise exception 'PROJECT_ACCESS_REQUIRED';
  end if;

  return v_space;
end;
$function$;

revoke all on function public.assert_survey_review_context(uuid,uuid,text)
  from public, anon, authenticated;

create or replace function public.initialize_shared_survey_reviews(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_dataset_id uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_space public.planning_spaces;
  v_existing_count bigint;
  v_input_count bigint;
  v_distinct_count bigint;
  v_inserted_count bigint;
begin
  v_space := public.assert_survey_review_context(
    p_teaching_project_id, p_village_id, p_space_id
  );

  if v_space.space_type <> 'formal_shared' then
    raise exception 'FORMAL_SHARED_SPACE_REQUIRED';
  end if;

  if public.current_profile_role() not in ('teacher', 'admin') then
    raise exception 'STAFF_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.village_datasets dataset
    where dataset.id = p_dataset_id
      and dataset.village_id = p_village_id
      and dataset.status = 'published'
      and v_space.base_dataset_id = dataset.id
  ) then
    raise exception 'PUBLISHED_BASE_DATASET_REQUIRED';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'SURVEY_REVIEW_ITEMS_REQUIRED';
  end if;

  with normalized_items as (
    select
      btrim(item->>'layerKey') as layer_key,
      btrim(item->>'objectCode') as object_code
    from jsonb_array_elements(p_items) item
  )
  select count(*), count(distinct (layer_key, object_code))
    into v_input_count, v_distinct_count
  from normalized_items
  where layer_key in ('building', 'road', 'water')
    and object_code <> '';

  if v_input_count <> jsonb_array_length(p_items)
     or v_distinct_count <> v_input_count then
    raise exception 'INVALID_OR_DUPLICATE_SURVEY_REVIEW_ITEMS';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(p_items) item
    where item->>'layerKey' = 'building'
  ) then
    raise exception 'BUILDING_REVIEW_ITEMS_REQUIRED';
  end if;

  select count(*) into v_existing_count
  from public.survey_feature_reviews review
  where review.teaching_project_id = p_teaching_project_id
    and review.village_id = p_village_id
    and review.space_id = p_space_id;

  if v_existing_count > 0 then
    if exists (
      select 1 from public.survey_feature_reviews review
      where review.teaching_project_id = p_teaching_project_id
        and review.village_id = p_village_id
        and review.space_id = p_space_id
        and review.base_dataset_id <> p_dataset_id
    ) or v_existing_count <> v_distinct_count
    or exists (
      select 1
      from public.survey_feature_reviews review
      where review.teaching_project_id = p_teaching_project_id
        and review.village_id = p_village_id
        and review.space_id = p_space_id
        and not exists (
          select 1 from jsonb_array_elements(p_items) item
          where item->>'layerKey' = review.layer_key
            and item->>'objectCode' = review.object_code
        )
    ) then
      raise exception 'SURVEY_REVIEW_INDEX_ALREADY_INITIALIZED';
    end if;

    return jsonb_build_object(
      'success', true,
      'alreadyInitialized', true,
      'baselineTotal', v_existing_count
    );
  end if;

  insert into public.survey_feature_reviews(
    teaching_project_id, village_id, space_id, base_dataset_id,
    layer_key, object_code, is_v0_baseline, baseline_object_code, geometry_status
  )
  select
    p_teaching_project_id, p_village_id, p_space_id, p_dataset_id,
    btrim(item->>'layerKey'), btrim(item->>'objectCode'),
    true, btrim(item->>'objectCode'), 'pending'
  from jsonb_array_elements(p_items) item
  where btrim(item->>'layerKey') in ('building', 'road', 'water')
  on conflict (
    teaching_project_id, village_id, space_id, layer_key, object_code
  ) do nothing;

  get diagnostics v_inserted_count = row_count;

  return jsonb_build_object(
    'success', true,
    'alreadyInitialized', false,
    'baselineTotal', v_inserted_count
  );
end;
$function$;

revoke all on function public.initialize_shared_survey_reviews(uuid,uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.initialize_shared_survey_reviews(uuid,uuid,text,uuid,jsonb)
  to authenticated;

create or replace function public.confirm_survey_feature_geometry(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_layer_key text,
  p_object_code text,
  p_expected_revision bigint,
  p_lock_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_review public.survey_feature_reviews%rowtype;
  v_event_id text := gen_random_uuid()::text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform public.assert_survey_review_context(
    p_teaching_project_id, p_village_id, p_space_id
  );

  if not public.context_space_mutable(
    p_teaching_project_id, p_village_id, p_space_id
  ) then
    raise exception 'SPACE_READONLY';
  end if;

  if p_layer_key not in ('building', 'road', 'water')
     or nullif(btrim(p_object_code), '') is null then
    raise exception 'INVALID_SURVEY_FEATURE';
  end if;

  select review.* into v_review
  from public.survey_feature_reviews review
  where review.teaching_project_id = p_teaching_project_id
    and review.village_id = p_village_id
    and review.space_id = p_space_id
    and review.layer_key = p_layer_key
    and review.object_code = p_object_code
  for update;

  if not found or v_review.is_deleted then
    raise exception 'SURVEY_FEATURE_NOT_FOUND';
  end if;

  if v_review.geometry_revision <> p_expected_revision then
    raise exception 'GEOMETRY_REVISION_CONFLICT';
  end if;

  if not exists (
    select 1
    from public.feature_edit_locks feature_lock
    where feature_lock.teaching_project_id = p_teaching_project_id
      and feature_lock.village_id = p_village_id
      and feature_lock.space_id = p_space_id
      and feature_lock.layer_key = p_layer_key
      and feature_lock.object_code = p_object_code
      and feature_lock.editor_user_id = v_user_id
      and feature_lock.lock_token = p_lock_token
      and feature_lock.expires_at > now()
  ) then
    raise exception 'FEATURE_LOCK_REQUIRED';
  end if;

  update public.survey_feature_reviews
  set geometry_status = 'confirmed_unchanged',
      geometry_revision = geometry_revision + 1,
      first_reviewed_by = coalesce(first_reviewed_by, v_user_id),
      first_reviewed_at = coalesce(first_reviewed_at, now()),
      latest_modified_by = v_user_id,
      latest_modified_at = now(),
      updated_at = now()
  where id = v_review.id
  returning * into v_review;

  delete from public.feature_edit_locks
  where teaching_project_id = p_teaching_project_id
    and village_id = p_village_id
    and space_id = p_space_id
    and layer_key = p_layer_key
    and object_code = p_object_code
    and editor_user_id = v_user_id
    and lock_token = p_lock_token;

  insert into public.activity_events(
    event_id, client_event_id, occurred_at,
    teaching_project_id, village_id, space_id,
    action, target_type, target_id, metadata
  ) values (
    v_event_id, v_event_id, now(),
    p_teaching_project_id, p_village_id, p_space_id,
    'survey_geometry_confirmed', p_layer_key, p_object_code,
    jsonb_build_object(
      'geometryRevision', v_review.geometry_revision,
      'geometryStatus', v_review.geometry_status,
      'actorUserId', v_user_id
    )
  );

  return jsonb_build_object(
    'layer_key', v_review.layer_key,
    'object_code', v_review.object_code,
    'geometry_status', v_review.geometry_status,
    'geometry_revision', v_review.geometry_revision,
    'first_reviewed_by', v_review.first_reviewed_by,
    'first_reviewed_at', v_review.first_reviewed_at,
    'latest_modified_by', v_review.latest_modified_by,
    'latest_modified_at', v_review.latest_modified_at
  );
end;
$function$;

revoke all on function public.confirm_survey_feature_geometry(uuid,uuid,text,text,text,bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_survey_feature_geometry(uuid,uuid,text,text,text,bigint,uuid)
  to authenticated;

-- 保持阶段 1 的签名不变，只在正式共享空间的三类校核图层中加强事务约束。
create or replace function public.save_feature_edit_batch(
  p_space_id text,
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_editor_name text,
  p_summary text,
  p_note text,
  p_changes jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_editor_name text := public.current_profile_display_name();
  v_space public.planning_spaces%rowtype;
  v_review public.survey_feature_reviews%rowtype;
  v_is_survey_change boolean;
  v_expected_revision bigint;
  v_lock_token uuid;
  v_client_object_code text;
  v_event_id text;
  batch_uuid uuid;
  change_row jsonb;
  change_action text;
  change_layer_key text;
  change_object_code text;
begin
  if v_user_id is null or v_editor_name is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform public.assert_feature_space_context(
    p_space_id, p_teaching_project_id, p_village_id
  );

  select space.* into v_space
  from public.planning_spaces space
  where space.id = p_space_id
    and space.teaching_project_id = p_teaching_project_id
    and space.village_id = p_village_id;

  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'changes must be a non-empty array';
  end if;

  insert into public.feature_change_batches(
    teaching_project_id, village_id, space_id,
    editor_name, editor_user_id, summary, note
  ) values (
    p_teaching_project_id, p_village_id, p_space_id,
    v_editor_name, v_user_id,
    coalesce(nullif(p_summary, ''), '要素编辑'), coalesce(p_note, '')
  ) returning id into batch_uuid;

  for change_row in select value from jsonb_array_elements(p_changes) loop
    change_action := btrim(change_row->>'action');
    change_layer_key := btrim(change_row->>'layerKey');
    v_client_object_code := btrim(change_row->>'objectCode');
    change_object_code := v_client_object_code;
    v_is_survey_change := v_space.space_type = 'formal_shared'
      and change_layer_key in ('building', 'road', 'water');

    if change_action not in ('add', 'update', 'delete') then
      raise exception 'invalid feature action: %', change_action;
    end if;
    if nullif(change_layer_key, '') is null or nullif(v_client_object_code, '') is null then
      raise exception 'INVALID_SURVEY_FEATURE';
    end if;

    if v_is_survey_change then
      if not (change_row ? 'expectedGeometryRevision')
         or not (change_row ? 'lockToken') then
        raise exception 'GEOMETRY_REVISION_AND_LOCK_REQUIRED';
      end if;
      v_expected_revision := (change_row->>'expectedGeometryRevision')::bigint;
      v_lock_token := (change_row->>'lockToken')::uuid;

      if not exists (
        select 1
        from public.feature_edit_locks feature_lock
        where feature_lock.teaching_project_id = p_teaching_project_id
          and feature_lock.village_id = p_village_id
          and feature_lock.space_id = p_space_id
          and feature_lock.layer_key = change_layer_key
          and feature_lock.object_code = v_client_object_code
          and feature_lock.editor_user_id = v_user_id
          and feature_lock.lock_token = v_lock_token
          and feature_lock.expires_at > now()
      ) then
        raise exception 'FEATURE_LOCK_REQUIRED';
      end if;

      if change_action = 'add' then
        if v_expected_revision <> 0 then
          raise exception 'GEOMETRY_REVISION_CONFLICT';
        end if;
        change_object_code := concat(
          case change_layer_key
            when 'building' then 'B'
            when 'road' then 'R'
            when 'water' then 'W'
          end,
          '-N-', replace(gen_random_uuid()::text, '-', '')
        );
      else
        select review.* into v_review
        from public.survey_feature_reviews review
        where review.teaching_project_id = p_teaching_project_id
          and review.village_id = p_village_id
          and review.space_id = p_space_id
          and review.layer_key = change_layer_key
          and review.object_code = change_object_code
        for update;

        if not found or v_review.is_deleted then
          raise exception 'SURVEY_FEATURE_NOT_FOUND';
        end if;
        if v_review.geometry_revision <> v_expected_revision then
          raise exception 'GEOMETRY_REVISION_CONFLICT';
        end if;
      end if;
    elsif change_action <> 'add' and not exists (
      select 1
      from public.feature_edit_locks feature_lock
      where feature_lock.teaching_project_id = p_teaching_project_id
        and feature_lock.village_id = p_village_id
        and feature_lock.space_id = p_space_id
        and feature_lock.layer_key = change_layer_key
        and feature_lock.object_code = change_object_code
        and feature_lock.editor_user_id = v_user_id
        and feature_lock.expires_at > now()
    ) then
      raise exception 'feature lock required: %.%', change_layer_key, change_object_code;
    end if;

    insert into public.feature_versions(
      batch_id, teaching_project_id, village_id, space_id,
      layer_key, object_code, action,
      before_geom, after_geom, before_props, after_props,
      created_by, created_by_user_id
    ) values (
      batch_uuid, p_teaching_project_id, p_village_id, p_space_id,
      change_layer_key, change_object_code, change_action,
      change_row->'beforeGeom', change_row->'afterGeom',
      change_row->'beforeProps', change_row->'afterProps',
      v_editor_name, v_user_id
    );

    if change_action = 'delete' then
      insert into public.planning_features(
        teaching_project_id, village_id, space_id,
        layer_key, object_code, object_name, geom, props, is_deleted
      ) values (
        p_teaching_project_id, p_village_id, p_space_id,
        change_layer_key, change_object_code,
        coalesce(change_row->>'objectName', change_object_code),
        coalesce(change_row->'beforeGeom', change_row->'afterGeom'),
        coalesce(change_row->'beforeProps', change_row->'afterProps', '{}'::jsonb), true
      )
      on conflict (space_id, layer_key, object_code) do update
      set object_name = excluded.object_name,
          geom = excluded.geom,
          props = excluded.props,
          is_deleted = true,
          updated_at = now();
    else
      insert into public.planning_features(
        teaching_project_id, village_id, space_id,
        layer_key, object_code, object_name, geom, props, is_deleted
      ) values (
        p_teaching_project_id, p_village_id, p_space_id,
        change_layer_key, change_object_code,
        coalesce(change_row->>'objectName', change_object_code),
        change_row->'afterGeom',
        coalesce(change_row->'afterProps', '{}'::jsonb), false
      )
      on conflict (space_id, layer_key, object_code) do update
      set object_name = excluded.object_name,
          geom = excluded.geom,
          props = excluded.props,
          is_deleted = false,
          updated_at = now();
    end if;

    if v_is_survey_change and change_action = 'add' then
      insert into public.survey_feature_reviews(
        teaching_project_id, village_id, space_id, base_dataset_id,
        layer_key, object_code, is_v0_baseline, baseline_object_code,
        geometry_status, geometry_revision, is_deleted,
        first_reviewed_by, first_reviewed_at,
        latest_modified_by, latest_modified_at, latest_geometry_batch_id
      ) values (
        p_teaching_project_id, p_village_id, p_space_id, v_space.base_dataset_id,
        change_layer_key, change_object_code, false, null,
        'added', 1, false,
        v_user_id, now(), v_user_id, now(), batch_uuid
      );
    elsif v_is_survey_change then
      update public.survey_feature_reviews
      set geometry_status = case
            when not is_v0_baseline then 'added'
            when change_action = 'delete' then 'deleted'
            else 'modified'
          end,
          geometry_revision = geometry_revision + 1,
          is_deleted = (change_action = 'delete'),
          first_reviewed_by = coalesce(first_reviewed_by, v_user_id),
          first_reviewed_at = coalesce(first_reviewed_at, now()),
          latest_modified_by = v_user_id,
          latest_modified_at = now(),
          latest_geometry_batch_id = batch_uuid,
          updated_at = now()
      where id = v_review.id;
    end if;

    if v_is_survey_change then
      v_event_id := gen_random_uuid()::text;
      insert into public.activity_events(
        event_id, client_event_id, occurred_at,
        teaching_project_id, village_id, space_id,
        action, target_type, target_id, metadata
      ) values (
        v_event_id, v_event_id, now(),
        p_teaching_project_id, p_village_id, p_space_id,
        concat('survey_geometry_', change_action),
        change_layer_key, change_object_code,
        jsonb_build_object(
          'batchId', batch_uuid,
          'actorUserId', v_user_id,
          'clientObjectCode', v_client_object_code
        )
      );
    end if;

    delete from public.feature_edit_locks
    where teaching_project_id = p_teaching_project_id
      and village_id = p_village_id
      and space_id = p_space_id
      and layer_key = change_layer_key
      and object_code = v_client_object_code
      and editor_user_id = v_user_id
      and (not v_is_survey_change or lock_token = v_lock_token);
  end loop;

  return batch_uuid;
end;
$function$;

revoke all on function public.save_feature_edit_batch(text,uuid,uuid,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_feature_edit_batch(text,uuid,uuid,text,text,text,jsonb)
  to authenticated;

create or replace function public.get_shared_survey_dashboard(
  p_teaching_project_id uuid, p_village_id uuid, p_space_id text
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $function$
declare v_result jsonb;
begin
  perform public.assert_survey_review_context(p_teaching_project_id, p_village_id, p_space_id);
  select jsonb_build_object(
    'baseline_total', count(*) filter (where review.is_v0_baseline),
    'reviewed_baseline', count(*) filter (where review.is_v0_baseline and review.geometry_status <> 'pending'),
    'added', count(*) filter (where not review.is_v0_baseline and review.geometry_status = 'added'),
    'deleted', count(*) filter (where review.is_v0_baseline and review.geometry_status = 'deleted'),
    'current_active', count(*) filter (where not review.is_deleted),
    'photo_count', (select count(*) from public.object_photos photo where photo.teaching_project_id = p_teaching_project_id and photo.village_id = p_village_id and photo.space_id = p_space_id),
    'unresolved_issue_count', (select count(*) from public.community_tasks issue where issue.teaching_project_id = p_teaching_project_id and issue.village_id = p_village_id and issue.space_id = p_space_id and issue.target_layer_key is not null and issue.status = 'pending')
  ) into v_result
  from public.survey_feature_reviews review
  where review.teaching_project_id = p_teaching_project_id
    and review.village_id = p_village_id and review.space_id = p_space_id;
  return v_result;
end;
$function$;

revoke all on function public.get_shared_survey_dashboard(uuid,uuid,text) from public, anon;
grant execute on function public.get_shared_survey_dashboard(uuid,uuid,text) to authenticated;

create or replace function public.list_shared_survey_features(
  p_teaching_project_id uuid, p_village_id uuid, p_space_id text,
  p_layer_key text default null, p_geometry_status text default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $function$
declare v_result jsonb;
begin
  perform public.assert_survey_review_context(p_teaching_project_id, p_village_id, p_space_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', review.id,
    'layer_key', review.layer_key,
    'object_code', review.object_code,
    'geometry_status', review.geometry_status,
    'geometry_revision', review.geometry_revision,
    'is_v0_baseline', review.is_v0_baseline,
    'is_deleted', review.is_deleted,
    'latest_modified_by', review.latest_modified_by,
    'latest_modified_at', review.latest_modified_at,
    'locked_by', feature_lock.editor_user_id,
    'lock_expires_at', feature_lock.expires_at
  ) order by review.layer_key, review.object_code), '[]'::jsonb)
  into v_result
  from public.survey_feature_reviews review
  left join public.feature_edit_locks feature_lock
    on feature_lock.teaching_project_id = review.teaching_project_id
   and feature_lock.village_id = review.village_id
   and feature_lock.space_id = review.space_id
   and feature_lock.layer_key = review.layer_key
   and feature_lock.object_code = review.object_code
   and feature_lock.expires_at > now()
  where review.teaching_project_id = p_teaching_project_id
    and review.village_id = p_village_id
    and review.space_id = p_space_id
    and (p_layer_key is null or review.layer_key = p_layer_key)
    and (p_geometry_status is null or review.geometry_status = p_geometry_status)
    and (p_actor_id is null or review.latest_modified_by = p_actor_id);
  return v_result;
end;
$function$;

revoke all on function public.list_shared_survey_features(uuid,uuid,text,text,text,uuid)
  from public, anon;
grant execute on function public.list_shared_survey_features(uuid,uuid,text,text,text,uuid)
  to authenticated;

create or replace function public.restore_survey_feature_version(
  p_teaching_project_id uuid, p_village_id uuid, p_space_id text,
  p_layer_key text, p_object_code text, p_feature_version_id uuid,
  p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := public.current_profile_display_name();
  v_review public.survey_feature_reviews%rowtype;
  v_version public.feature_versions%rowtype;
  v_current public.planning_features%rowtype;
  v_batch_id uuid;
  v_deleted boolean;
begin
  perform public.assert_survey_review_context(p_teaching_project_id, p_village_id, p_space_id);
  if public.current_profile_role() not in ('teacher', 'admin') then raise exception 'STAFF_REQUIRED'; end if;
  if not public.context_space_mutable(p_teaching_project_id, p_village_id, p_space_id) then raise exception 'SPACE_READONLY'; end if;
  if exists (select 1 from public.feature_edit_locks feature_lock where feature_lock.teaching_project_id = p_teaching_project_id and feature_lock.village_id = p_village_id and feature_lock.space_id = p_space_id and feature_lock.layer_key = p_layer_key and feature_lock.object_code = p_object_code and feature_lock.expires_at > now()) then raise exception 'ACTIVE_FEATURE_LOCK'; end if;

  select * into v_review from public.survey_feature_reviews review
  where review.teaching_project_id = p_teaching_project_id and review.village_id = p_village_id
    and review.space_id = p_space_id and review.layer_key = p_layer_key and review.object_code = p_object_code
  for update;
  if not found then raise exception 'SURVEY_FEATURE_NOT_FOUND'; end if;
  if v_review.geometry_revision <> p_expected_revision then raise exception 'GEOMETRY_REVISION_CONFLICT'; end if;

  select * into v_version from public.feature_versions version
  where version.id = p_feature_version_id and version.teaching_project_id = p_teaching_project_id
    and version.village_id = p_village_id and version.space_id = p_space_id
    and version.layer_key = p_layer_key and version.object_code = p_object_code;
  if not found then raise exception 'FEATURE_VERSION_NOT_FOUND'; end if;
  select * into v_current from public.planning_features feature
  where feature.teaching_project_id = p_teaching_project_id and feature.village_id = p_village_id
    and feature.space_id = p_space_id and feature.layer_key = p_layer_key and feature.object_code = p_object_code;

  v_deleted := v_version.action = 'delete';
  insert into public.feature_change_batches(teaching_project_id,village_id,space_id,editor_name,editor_user_id,summary,note)
  values(p_teaching_project_id,p_village_id,p_space_id,v_name,v_user_id,'恢复历史版本',concat('恢复 ',p_feature_version_id)) returning id into v_batch_id;
  insert into public.feature_versions(batch_id,teaching_project_id,village_id,space_id,layer_key,object_code,action,before_geom,after_geom,before_props,after_props,created_by,created_by_user_id)
  values(v_batch_id,p_teaching_project_id,p_village_id,p_space_id,p_layer_key,p_object_code,case when v_deleted then 'delete' else 'update' end,v_current.geom,case when v_deleted then null else coalesce(v_version.after_geom,v_version.before_geom) end,v_current.props,case when v_deleted then null else coalesce(v_version.after_props,v_version.before_props) end,v_name,v_user_id);

  insert into public.planning_features(
    teaching_project_id,village_id,space_id,layer_key,object_code,object_name,geom,props,is_deleted
  ) values(
    p_teaching_project_id,p_village_id,p_space_id,p_layer_key,p_object_code,
    coalesce(v_current.object_name,p_object_code),
    coalesce(v_version.after_geom,v_version.before_geom),
    coalesce(v_version.after_props,v_version.before_props,'{}'::jsonb),v_deleted
  )
  on conflict(space_id,layer_key,object_code) do update set
    geom=excluded.geom,props=excluded.props,is_deleted=excluded.is_deleted,updated_at=now();
  update public.survey_feature_reviews set geometry_status=case when not is_v0_baseline then 'added' when v_deleted then 'deleted' else 'modified' end,geometry_revision=geometry_revision+1,is_deleted=v_deleted,latest_modified_by=v_user_id,latest_modified_at=now(),latest_geometry_batch_id=v_batch_id,updated_at=now() where id=v_review.id returning * into v_review;
  return jsonb_build_object('batchId',v_batch_id,'geometryRevision',v_review.geometry_revision,'geometryStatus',v_review.geometry_status);
end;
$function$;

revoke all on function public.restore_survey_feature_version(uuid,uuid,text,text,text,uuid,bigint) from public, anon, authenticated;
grant execute on function public.restore_survey_feature_version(uuid,uuid,text,text,text,uuid,bigint) to authenticated;

create or replace function public.assert_survey_photo_deletable(p_photo_id bigint)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $function$
declare v_photo public.object_photos%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_photo from public.object_photos where id = p_photo_id;
  if not found then raise exception 'PHOTO_NOT_FOUND'; end if;
  if v_photo.teaching_project_id is null or v_photo.village_id is null or v_photo.space_id is null then
    if public.current_profile_role() not in ('teacher', 'admin') then raise exception 'STAFF_REQUIRED'; end if;
  elsif not public.context_space_accessible(v_photo.teaching_project_id, v_photo.village_id, v_photo.space_id) then
    raise exception 'PROJECT_ACCESS_REQUIRED';
  end if;
  if exists (select 1 from public.survey_snapshot_photo_refs ref where ref.photo_id = p_photo_id) then
    raise exception 'SNAPSHOT_PHOTO_IMMUTABLE';
  end if;
  return true;
end;
$function$;

revoke all on function public.assert_survey_photo_deletable(bigint) from public, anon;
grant execute on function public.assert_survey_photo_deletable(bigint) to authenticated;

create or replace function public.freeze_shared_survey_snapshot(
  p_teaching_project_id uuid, p_village_id uuid, p_space_id text,
  p_version_name text, p_description text default '',
  p_recommended_for_groups boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_created_by text := public.current_profile_display_name();
  v_snapshot_id uuid;
  v_event_id text := gen_random_uuid()::text;
  v_version_number integer;
  v_stats jsonb;
  v_group_spaces jsonb;
begin
  perform public.assert_survey_review_context(p_teaching_project_id, p_village_id, p_space_id);
  if public.current_profile_role() not in ('teacher', 'admin') then raise exception 'STAFF_REQUIRED'; end if;
  if nullif(btrim(p_version_name), '') is null then raise exception 'SNAPSHOT_NAME_REQUIRED'; end if;
  if exists (
    select 1 from public.feature_edit_locks feature_lock
    where feature_lock.teaching_project_id = p_teaching_project_id
      and feature_lock.village_id = p_village_id and feature_lock.space_id = p_space_id
      and feature_lock.expires_at > now()
  ) then raise exception 'ACTIVE_FEATURE_LOCKS'; end if;

  if exists (
    select 1 from public.survey_feature_reviews review
    where review.teaching_project_id = p_teaching_project_id
      and review.village_id = p_village_id and review.space_id = p_space_id
      and not exists (
        select 1 from public.planning_features feature
        where feature.teaching_project_id = review.teaching_project_id
          and feature.village_id = review.village_id and feature.space_id = review.space_id
          and feature.layer_key = review.layer_key and feature.object_code = review.object_code
      )
  ) then raise exception 'INCOMPLETE_SERVER_SURVEY_STATE'; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','survey-freeze',p_teaching_project_id,p_village_id,p_space_id),0));
  select coalesce(max(snapshot.version_number), 0) + 1 into v_version_number
  from public.feature_snapshots snapshot
  where snapshot.teaching_project_id = p_teaching_project_id
    and snapshot.village_id = p_village_id and snapshot.space_id = p_space_id;
  v_stats := public.get_shared_survey_dashboard(p_teaching_project_id, p_village_id, p_space_id);

  if p_recommended_for_groups then
    update public.feature_snapshots set recommended_for_groups = false
    where teaching_project_id = p_teaching_project_id and village_id = p_village_id
      and space_id = p_space_id and recommended_for_groups;
  end if;
  insert into public.feature_snapshots(
    teaching_project_id,village_id,space_id,version_name,version_type,description,
    created_by,is_published,version_number,recommended_for_groups,stats
  ) values (
    p_teaching_project_id,p_village_id,p_space_id,btrim(p_version_name),'published',
    coalesce(p_description,''),coalesce(v_created_by,'管理员'),true,v_version_number,
    coalesce(p_recommended_for_groups,false),v_stats
  ) returning id into v_snapshot_id;

  insert into public.feature_snapshot_items(
    snapshot_id,layer_key,object_code,object_name,geom,props,is_deleted
  )
  select v_snapshot_id, feature.layer_key, feature.object_code, feature.object_name,
    feature.geom, feature.props, feature.is_deleted
  from public.planning_features feature
  where feature.teaching_project_id = p_teaching_project_id
    and feature.village_id = p_village_id and feature.space_id = p_space_id;

  insert into public.survey_snapshot_photo_refs(snapshot_id, photo_id)
  select v_snapshot_id, photo.id from public.object_photos photo
  where photo.teaching_project_id = p_teaching_project_id and photo.village_id = p_village_id
    and photo.space_id = p_space_id and photo.survey_layer_key is not null;

  insert into public.survey_snapshot_issue_refs(snapshot_id, issue_version_id)
  select v_snapshot_id, latest.id
  from public.community_tasks issue
  join lateral (
    select version.id from public.community_task_versions version
    where version.issue_id = issue.id order by version.revision desc limit 1
  ) latest on true
  where issue.teaching_project_id = p_teaching_project_id and issue.village_id = p_village_id
    and issue.space_id = p_space_id and issue.target_layer_key is not null;

  insert into public.activity_events(
    event_id,client_event_id,occurred_at,teaching_project_id,village_id,space_id,
    student_key,student_name,course_id,action,target_type,target_id,metadata
  ) select v_event_id,v_event_id,now(),p_teaching_project_id,p_village_id,p_space_id,
    public.current_profile_student_key(),coalesce(v_created_by,'管理员'),project.course_id,
    'survey_snapshot_frozen','feature_snapshot',v_snapshot_id::text,
    jsonb_build_object('versionNumber',v_version_number)
  from public.teaching_projects project where project.id = p_teaching_project_id;

  v_group_spaces := public.ensure_group_plan_spaces_for_snapshot(v_snapshot_id);

  return jsonb_build_object(
    'snapshotId',v_snapshot_id,
    'versionNumber',v_version_number,
    'stats',v_stats,
    'groupSpaces',v_group_spaces
  );
end;
$function$;

revoke all on function public.freeze_shared_survey_snapshot(uuid,uuid,text,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.freeze_shared_survey_snapshot(uuid,uuid,text,text,text,boolean)
  to authenticated;

alter table public.object_attribute_edits
  add column if not exists survey_layer_key text
    check (survey_layer_key is null or survey_layer_key in ('building', 'road', 'water'));
alter table public.object_photos
  add column if not exists survey_layer_key text
    check (survey_layer_key is null or survey_layer_key in ('building', 'road', 'water'));
alter table public.object_comments
  add column if not exists survey_layer_key text
    check (survey_layer_key is null or survey_layer_key in ('building', 'road', 'water'));
alter table public.community_tasks
  add column if not exists target_layer_key text
    check (target_layer_key is null or target_layer_key in ('building', 'road', 'water')),
  add column if not exists target_object_code text;

create or replace function public.survey_feature_downstream_ready(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_layer_key text,
  p_object_code text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select auth.uid() is not null
    and public.context_space_accessible(
      p_teaching_project_id, p_village_id, p_space_id
    )
    and exists (
      select 1
      from public.survey_feature_reviews review
      where review.teaching_project_id = p_teaching_project_id
        and review.village_id = p_village_id
        and review.space_id = p_space_id
        and review.layer_key = p_layer_key
        and review.object_code = p_object_code
        and review.geometry_status in ('confirmed_unchanged', 'modified', 'added')
        and review.is_deleted = false
    );
$function$;

revoke all on function public.survey_feature_downstream_ready(uuid,uuid,text,text,text)
  from public, anon;
grant execute on function public.survey_feature_downstream_ready(uuid,uuid,text,text,text)
  to authenticated;

create or replace function public.enforce_survey_downstream_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_space_type text;
  v_layer_key text;
  v_object_code text;
begin
  select space.space_type into v_space_type
  from public.planning_spaces space
  where space.id = new.space_id
    and space.teaching_project_id = new.teaching_project_id
    and space.village_id = new.village_id;

  if v_space_type is null then
    raise exception 'PROJECT_SPACE_CONTEXT_MISMATCH';
  end if;

  if v_space_type <> 'formal_shared' then
    return new;
  end if;

  if tg_table_name = 'community_tasks' then
    v_layer_key := new.target_layer_key;
    v_object_code := new.target_object_code;
  else
    v_layer_key := new.survey_layer_key;
    v_object_code := new.object_code;
  end if;

  -- 普通地图留言、互动元数据以及非三类图层没有对象级校核语义。
  if v_layer_key is null or v_layer_key not in ('building', 'road', 'water') then
    return new;
  end if;

  if nullif(btrim(v_object_code), '') is null
     or not public.survey_feature_downstream_ready(
       new.teaching_project_id,
       new.village_id,
       new.space_id,
       v_layer_key,
       v_object_code
     ) then
    raise exception 'GEOMETRY_REVIEW_REQUIRED';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_survey_downstream_gate()
  from public, anon, authenticated;

drop trigger if exists trg_object_attribute_edits_survey_gate
  on public.object_attribute_edits;
create trigger trg_object_attribute_edits_survey_gate
before insert or update on public.object_attribute_edits
for each row execute function public.enforce_survey_downstream_gate();

drop trigger if exists trg_object_photos_survey_gate
  on public.object_photos;
create trigger trg_object_photos_survey_gate
before insert or update on public.object_photos
for each row execute function public.enforce_survey_downstream_gate();

drop trigger if exists trg_object_comments_survey_gate
  on public.object_comments;
create trigger trg_object_comments_survey_gate
before insert or update on public.object_comments
for each row execute function public.enforce_survey_downstream_gate();

drop trigger if exists trg_community_tasks_survey_gate
  on public.community_tasks;
create trigger trg_community_tasks_survey_gate
before insert or update on public.community_tasks
for each row execute function public.enforce_survey_downstream_gate();

alter table public.survey_feature_reviews enable row level security;
alter table public.community_task_versions enable row level security;
alter table public.survey_snapshot_photo_refs enable row level security;
alter table public.survey_snapshot_issue_refs enable row level security;

drop policy if exists survey_feature_reviews_read on public.survey_feature_reviews;
create policy survey_feature_reviews_read
on public.survey_feature_reviews for select to authenticated
using (public.context_space_accessible(teaching_project_id, village_id, space_id));

drop policy if exists community_task_versions_read on public.community_task_versions;
create policy community_task_versions_read
on public.community_task_versions for select to authenticated
using (public.context_space_accessible(teaching_project_id, village_id, space_id));

drop policy if exists survey_snapshot_photo_refs_read on public.survey_snapshot_photo_refs;
create policy survey_snapshot_photo_refs_read
on public.survey_snapshot_photo_refs for select to authenticated
using (
  exists (
    select 1 from public.feature_snapshots snapshot
    where snapshot.id = snapshot_id
      and public.context_space_accessible(
        snapshot.teaching_project_id, snapshot.village_id, snapshot.space_id
      )
  )
);

drop policy if exists survey_snapshot_issue_refs_read on public.survey_snapshot_issue_refs;
create policy survey_snapshot_issue_refs_read
on public.survey_snapshot_issue_refs for select to authenticated
using (
  exists (
    select 1 from public.feature_snapshots snapshot
    where snapshot.id = snapshot_id
      and public.context_space_accessible(
        snapshot.teaching_project_id, snapshot.village_id, snapshot.space_id
      )
  )
);

revoke all on table public.survey_feature_reviews from public, anon;
revoke all on table public.community_task_versions from public, anon;
revoke all on table public.survey_snapshot_photo_refs from public, anon;
revoke all on table public.survey_snapshot_issue_refs from public, anon;
revoke insert, update, delete on table public.survey_feature_reviews from authenticated;
revoke insert, update, delete on table public.community_task_versions from authenticated;
revoke insert, update, delete on table public.survey_snapshot_photo_refs from authenticated;
revoke insert, update, delete on table public.survey_snapshot_issue_refs from authenticated;
grant select on table public.survey_feature_reviews to authenticated;
grant select on table public.community_task_versions to authenticated;
grant select on table public.survey_snapshot_photo_refs to authenticated;
grant select on table public.survey_snapshot_issue_refs to authenticated;

commit;
