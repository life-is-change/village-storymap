-- 全班共享现状校核：显式保存、要素级编辑锁、修改历史与只读快照
-- 可重复执行。执行后请同时执行 Realtime Publication Setup.sql。

create extension if not exists pgcrypto;

create table if not exists public.feature_edit_locks (
  space_id text not null,
  layer_key text not null,
  object_code text not null,
  editor_name text not null,
  lock_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (space_id, layer_key, object_code)
);

create table if not exists public.feature_change_batches (
  id uuid primary key default gen_random_uuid(),
  space_id text not null,
  editor_name text not null,
  summary text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.feature_versions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.feature_change_batches(id) on delete cascade,
  space_id text not null,
  layer_key text not null,
  object_code text not null,
  action text not null check (action in ('add', 'update', 'delete')),
  before_geom jsonb,
  after_geom jsonb,
  before_props jsonb,
  after_props jsonb,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists feature_versions_object_idx
on public.feature_versions(space_id, layer_key, object_code, created_at desc);

create table if not exists public.feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  space_id text not null,
  version_name text not null,
  version_type text not null default 'published' check (version_type in ('initial', 'published')),
  description text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  is_published boolean not null default true
);

create unique index if not exists feature_snapshots_initial_uidx
on public.feature_snapshots(space_id, version_type)
where version_type = 'initial';

create table if not exists public.feature_snapshot_items (
  snapshot_id uuid not null references public.feature_snapshots(id) on delete cascade,
  layer_key text not null,
  object_code text not null,
  object_name text,
  geom jsonb not null,
  props jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  primary key (snapshot_id, layer_key, object_code)
);

alter table public.feature_edit_locks enable row level security;
alter table public.feature_change_batches enable row level security;
alter table public.feature_versions enable row level security;
alter table public.feature_snapshots enable row level security;
alter table public.feature_snapshot_items enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'feature_edit_locks', 'feature_change_batches', 'feature_versions',
    'feature_snapshots', 'feature_snapshot_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (true)', table_name || '_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_write', table_name);
  end loop;
end $$;

-- 浏览器只可读取锁、历史和快照。所有写入必须经过下方受控 RPC，不能直接改表。
revoke all on table public.feature_edit_locks from anon, authenticated;
revoke all on table public.feature_change_batches from anon, authenticated;
revoke all on table public.feature_versions from anon, authenticated;
revoke all on table public.feature_snapshots from anon, authenticated;
revoke all on table public.feature_snapshot_items from anon, authenticated;

grant select on table public.feature_edit_locks to authenticated;
grant select on table public.feature_change_batches to authenticated;
grant select on table public.feature_versions to authenticated;
grant select on table public.feature_snapshots to authenticated;
grant select on table public.feature_snapshot_items to authenticated;

create or replace function public.acquire_feature_edit_lock(
  p_space_id text,
  p_layer_key text,
  p_object_code text,
  p_editor_name text,
  p_lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acquired public.feature_edit_locks%rowtype;
  existing public.feature_edit_locks%rowtype;
begin
  delete from public.feature_edit_locks where expires_at <= now();

  insert into public.feature_edit_locks(
    space_id, layer_key, object_code, editor_name, lock_token, expires_at, updated_at
  ) values (
    p_space_id, p_layer_key, p_object_code, p_editor_name, gen_random_uuid(),
    now() + make_interval(secs => greatest(30, p_lease_seconds)), now()
  )
  on conflict (space_id, layer_key, object_code) do update
  set editor_name = excluded.editor_name,
      lock_token = case
        when feature_edit_locks.editor_name = excluded.editor_name then feature_edit_locks.lock_token
        else excluded.lock_token
      end,
      expires_at = excluded.expires_at,
      updated_at = now()
  where feature_edit_locks.expires_at <= now()
     or feature_edit_locks.editor_name = excluded.editor_name
  returning * into acquired;

  if acquired.space_id is not null then
    return jsonb_build_object(
      'success', true,
      'spaceId', acquired.space_id,
      'layerKey', acquired.layer_key,
      'objectCode', acquired.object_code,
      'editorName', acquired.editor_name,
      'lockToken', acquired.lock_token,
      'expiresAt', acquired.expires_at
    );
  end if;

  select * into existing from public.feature_edit_locks
  where space_id = p_space_id and layer_key = p_layer_key and object_code = p_object_code;
  return jsonb_build_object(
    'success', false,
    'reason', 'locked',
    'editorName', existing.editor_name,
    'expiresAt', existing.expires_at
  );
end;
$$;

create or replace function public.heartbeat_feature_edit_lock(
  p_space_id text,
  p_layer_key text,
  p_object_code text,
  p_editor_name text,
  p_lock_token uuid,
  p_lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.feature_edit_locks
  set expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)), updated_at = now()
  where space_id = p_space_id and layer_key = p_layer_key and object_code = p_object_code
    and editor_name = p_editor_name and lock_token = p_lock_token;
  get diagnostics affected = row_count;
  return jsonb_build_object('success', affected = 1);
end;
$$;

create or replace function public.release_feature_edit_lock(
  p_space_id text,
  p_layer_key text,
  p_object_code text,
  p_editor_name text,
  p_lock_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  delete from public.feature_edit_locks
  where space_id = p_space_id and layer_key = p_layer_key and object_code = p_object_code
    and editor_name = p_editor_name and lock_token = p_lock_token;
  get diagnostics affected = row_count;
  return jsonb_build_object('success', affected = 1);
end;
$$;

create or replace function public.save_feature_edit_batch(
  p_space_id text,
  p_editor_name text,
  p_summary text,
  p_note text,
  p_changes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_uuid uuid;
  change_row jsonb;
  change_action text;
  change_layer_key text;
  change_object_code text;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'changes must be a non-empty array';
  end if;

  insert into public.feature_change_batches(space_id, editor_name, summary, note)
  values (p_space_id, p_editor_name, coalesce(nullif(p_summary, ''), '要素编辑'), coalesce(p_note, ''))
  returning id into batch_uuid;

  for change_row in select value from jsonb_array_elements(p_changes)
  loop
    change_action := change_row->>'action';
    change_layer_key := change_row->>'layerKey';
    change_object_code := change_row->>'objectCode';
    if change_action not in ('add', 'update', 'delete') then
      raise exception 'invalid feature action: %', change_action;
    end if;

    -- 新增对象还没有稳定编号，无需预先加锁；修改和删除必须持有本人的有效对象锁。
    if change_action <> 'add' and not exists (
      select 1
      from public.feature_edit_locks
      where space_id = p_space_id
        and layer_key = change_layer_key
        and object_code = change_object_code
        and editor_name = p_editor_name
        and expires_at > now()
    ) then
      raise exception 'feature lock required: %.%', change_layer_key, change_object_code;
    end if;

    insert into public.feature_versions(
      batch_id, space_id, layer_key, object_code, action,
      before_geom, after_geom, before_props, after_props, created_by
    ) values (
      batch_uuid, p_space_id, change_layer_key, change_object_code, change_action,
      change_row->'beforeGeom', change_row->'afterGeom',
      change_row->'beforeProps', change_row->'afterProps', p_editor_name
    );

    if change_action = 'delete' then
      update public.planning_features
      set is_deleted = true, updated_at = now()
      where space_id = p_space_id
        and layer_key = change_layer_key
        and object_code = change_object_code;
    else
      insert into public.planning_features(
        space_id, layer_key, object_code, object_name, geom, props, is_deleted
      ) values (
        p_space_id,
        change_layer_key,
        change_object_code,
        coalesce(change_row->>'objectName', change_object_code),
        change_row->'afterGeom',
        coalesce(change_row->'afterProps', '{}'::jsonb),
        false
      )
      on conflict (space_id, layer_key, object_code) do update
      set object_name = excluded.object_name,
          geom = excluded.geom,
          props = excluded.props,
          is_deleted = false,
          updated_at = now();
    end if;

    delete from public.feature_edit_locks
    where space_id = p_space_id
      and layer_key = change_layer_key
      and object_code = change_object_code
      and editor_name = p_editor_name;
  end loop;

  return batch_uuid;
end;
$$;

create or replace function public.freeze_feature_snapshot(
  p_space_id text,
  p_version_name text,
  p_description text,
  p_created_by text,
  p_version_type text default 'published',
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_uuid uuid;
begin
  insert into public.feature_snapshots(
    space_id, version_name, version_type, description, created_by, is_published
  ) values (
    p_space_id, p_version_name, p_version_type, coalesce(p_description, ''), p_created_by, true
  ) returning id into snapshot_uuid;

  if jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.feature_snapshot_items(
      snapshot_id, layer_key, object_code, object_name, geom, props, is_deleted
    )
    select
      snapshot_uuid,
      item->>'layerKey',
      item->>'objectCode',
      item->>'objectName',
      item->'geom',
      coalesce(item->'props', '{}'::jsonb),
      coalesce((item->>'isDeleted')::boolean, false)
    from jsonb_array_elements(p_items) item;
  else
    insert into public.feature_snapshot_items(
      snapshot_id, layer_key, object_code, object_name, geom, props, is_deleted
    )
    select snapshot_uuid, layer_key, object_code, object_name, geom, props, is_deleted
    from public.planning_features
    where space_id = p_space_id;
  end if;

  return snapshot_uuid;
end;
$$;

create or replace function public.ensure_initial_feature_baseline(p_created_by text default '系统')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_uuid uuid;
begin
  select id into snapshot_uuid from public.feature_snapshots
  where space_id = 'current' and version_type = 'initial'
  limit 1;
  if snapshot_uuid is not null then return snapshot_uuid; end if;

  return public.freeze_feature_snapshot(
    'current', 'V0 初始现状', '教师提供的初始现状底稿，永久只读。', p_created_by, 'initial'
  );
end;
$$;

-- PostgreSQL 默认会把新函数的 EXECUTE 授给 PUBLIC，必须显式撤销后再按用途开放。
revoke all on function public.acquire_feature_edit_lock(text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.heartbeat_feature_edit_lock(text,text,text,text,uuid,integer) from public, anon, authenticated;
revoke all on function public.release_feature_edit_lock(text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.save_feature_edit_batch(text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.freeze_feature_snapshot(text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.ensure_initial_feature_baseline(text) from public, anon, authenticated;

-- 前端仅能通过结构化 RPC 获取锁、续租、释放和保存，不能直接写历史表。
grant execute on function public.acquire_feature_edit_lock(text,text,text,text,integer) to authenticated;
grant execute on function public.heartbeat_feature_edit_lock(text,text,text,text,uuid,integer) to authenticated;
grant execute on function public.release_feature_edit_lock(text,text,text,text,uuid) to authenticated;
grant execute on function public.save_feature_edit_batch(text,text,text,text,jsonb) to authenticated;

-- 冻结版本和创建永久 V0 仅供可信后台调用；待接入 Supabase Auth 后再开放教师角色。
grant execute on function public.freeze_feature_snapshot(text,text,text,text,text,jsonb) to service_role;
grant execute on function public.ensure_initial_feature_baseline(text) to service_role;

-- 首次执行脚本时，将当时的现状空间保存为永久只读 V0。
select public.ensure_initial_feature_baseline('系统');
