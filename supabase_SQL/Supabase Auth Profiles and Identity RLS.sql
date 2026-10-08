-- Supabase Auth 身份、用户资料与共享现状编辑身份绑定
-- 用户自由注册，但注册触发器始终创建 student 角色；教师/管理员只能由可信 SQL 提升。

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  student_id text not null unique,
  display_name text not null,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  gender text not null default '',
  class_name text not null default '',
  grade text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_profile_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_role text := 'student';
  profile_student_id text := lower(trim(coalesce(new.raw_user_meta_data->>'student_id', '')));
  profile_display_name text := trim(coalesce(new.raw_user_meta_data->>'display_name', ''));
begin
  if profile_student_id = '' or profile_student_id !~ '^[a-z0-9_-]{2,32}$' then
    raise exception 'valid student_id is required';
  end if;
  if profile_display_name = '' or length(profile_display_name) > 20 then
    raise exception 'valid display_name is required';
  end if;

  insert into public.profiles(
    id, student_id, display_name, role, gender, class_name, grade
  ) values (
    new.id,
    profile_student_id,
    profile_display_name,
    profile_role,
    left(trim(coalesce(new.raw_user_meta_data->>'gender', '')), 12),
    left(trim(coalesce(new.raw_user_meta_data->>'class_name', '')), 30),
    left(trim(coalesce(new.raw_user_meta_data->>'grade', '')), 20)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_profile_display_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select display_name from public.profiles where id = auth.uid();
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.current_profile_role() from public, anon, authenticated;
revoke all on function public.current_profile_display_name() from public, anon, authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_display_name() to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.current_profile_role() in ('teacher', 'admin')
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, gender, class_name, grade) on table public.profiles to authenticated;

-- 旧的公开用户表不再承担认证职责，也不再允许浏览器读写。
drop policy if exists "allow all auth_users" on public.auth_users;
drop policy if exists "allow all user_sessions" on public.user_sessions;
revoke all on table public.auth_users from anon, authenticated;
revoke all on table public.user_sessions from anon, authenticated;

-- 把共享编辑记录绑定到不可伪造的 Auth UUID；旧记录保持可读。
alter table public.feature_edit_locks
  add column if not exists editor_user_id uuid references auth.users(id) on delete set null;
alter table public.feature_change_batches
  add column if not exists editor_user_id uuid references auth.users(id) on delete set null;
alter table public.feature_versions
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists feature_edit_locks_user_idx on public.feature_edit_locks(editor_user_id);
create index if not exists feature_change_batches_user_idx on public.feature_change_batches(editor_user_id, created_at desc);

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
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_editor_name text := public.current_profile_display_name();
  acquired public.feature_edit_locks%rowtype;
  existing public.feature_edit_locks%rowtype;
begin
  if v_user_id is null or v_editor_name is null then raise exception 'authentication required'; end if;
  delete from public.feature_edit_locks where expires_at <= now();

  insert into public.feature_edit_locks(
    space_id, layer_key, object_code, editor_name, editor_user_id, lock_token, expires_at, updated_at
  ) values (
    p_space_id, p_layer_key, p_object_code, v_editor_name, v_user_id, gen_random_uuid(),
    now() + make_interval(secs => greatest(30, p_lease_seconds)), now()
  )
  on conflict (space_id, layer_key, object_code) do update
  set editor_name = excluded.editor_name,
      editor_user_id = excluded.editor_user_id,
      lock_token = case
        when feature_edit_locks.editor_user_id = excluded.editor_user_id then feature_edit_locks.lock_token
        else excluded.lock_token
      end,
      expires_at = excluded.expires_at,
      updated_at = now()
  where feature_edit_locks.expires_at <= now()
     or feature_edit_locks.editor_user_id = excluded.editor_user_id
  returning * into acquired;

  if acquired.space_id is not null then
    return jsonb_build_object(
      'success', true, 'spaceId', acquired.space_id, 'layerKey', acquired.layer_key,
      'objectCode', acquired.object_code, 'editorName', acquired.editor_name,
      'lockToken', acquired.lock_token, 'expiresAt', acquired.expires_at
    );
  end if;

  select * into existing from public.feature_edit_locks
  where space_id = p_space_id and layer_key = p_layer_key and object_code = p_object_code;
  return jsonb_build_object(
    'success', false, 'reason', 'locked', 'editorName', existing.editor_name, 'expiresAt', existing.expires_at
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
set search_path = public, pg_temp
as $$
declare
  affected integer;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  update public.feature_edit_locks
  set expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)), updated_at = now()
  where space_id = p_space_id and layer_key = p_layer_key and object_code = p_object_code
    and editor_user_id = v_user_id and lock_token = p_lock_token;
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
set search_path = public, pg_temp
as $$
declare
  affected integer;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  delete from public.feature_edit_locks
  where space_id = p_space_id and layer_key = p_layer_key and object_code = p_object_code
    and editor_user_id = v_user_id and lock_token = p_lock_token;
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
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_editor_name text := public.current_profile_display_name();
  batch_uuid uuid;
  change_row jsonb;
  change_action text;
  change_layer_key text;
  change_object_code text;
begin
  if v_user_id is null or v_editor_name is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'changes must be a non-empty array';
  end if;

  insert into public.feature_change_batches(space_id, editor_name, editor_user_id, summary, note)
  values (p_space_id, v_editor_name, v_user_id, coalesce(nullif(p_summary, ''), '要素编辑'), coalesce(p_note, ''))
  returning id into batch_uuid;

  for change_row in select value from jsonb_array_elements(p_changes)
  loop
    change_action := change_row->>'action';
    change_layer_key := change_row->>'layerKey';
    change_object_code := change_row->>'objectCode';
    if change_action not in ('add', 'update', 'delete') then
      raise exception 'invalid feature action: %', change_action;
    end if;

    if change_action <> 'add' and not exists (
      select 1 from public.feature_edit_locks
      where space_id = p_space_id and layer_key = change_layer_key and object_code = change_object_code
        and editor_user_id = v_user_id and expires_at > now()
    ) then
      raise exception 'feature lock required: %.%', change_layer_key, change_object_code;
    end if;

    insert into public.feature_versions(
      batch_id, space_id, layer_key, object_code, action,
      before_geom, after_geom, before_props, after_props, created_by, created_by_user_id
    ) values (
      batch_uuid, p_space_id, change_layer_key, change_object_code, change_action,
      change_row->'beforeGeom', change_row->'afterGeom', change_row->'beforeProps', change_row->'afterProps',
      v_editor_name, v_user_id
    );

    if change_action = 'delete' then
      update public.planning_features set is_deleted = true, updated_at = now()
      where space_id = p_space_id and layer_key = change_layer_key and object_code = change_object_code;
    else
      insert into public.planning_features(
        space_id, layer_key, object_code, object_name, geom, props, is_deleted
      ) values (
        p_space_id, change_layer_key, change_object_code,
        coalesce(change_row->>'objectName', change_object_code), change_row->'afterGeom',
        coalesce(change_row->'afterProps', '{}'::jsonb), false
      )
      on conflict (space_id, layer_key, object_code) do update
      set object_name = excluded.object_name, geom = excluded.geom, props = excluded.props,
          is_deleted = false, updated_at = now();
    end if;

    delete from public.feature_edit_locks
    where space_id = p_space_id and layer_key = change_layer_key and object_code = change_object_code
      and editor_user_id = v_user_id;
  end loop;
  return batch_uuid;
end;
$$;

-- 浏览器只能在已登录状态下调用编辑 RPC，且姓名参数会被数据库忽略。
revoke all on function public.acquire_feature_edit_lock(text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.heartbeat_feature_edit_lock(text,text,text,text,uuid,integer) from public, anon, authenticated;
revoke all on function public.release_feature_edit_lock(text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.save_feature_edit_batch(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.acquire_feature_edit_lock(text,text,text,text,integer) to authenticated;
grant execute on function public.heartbeat_feature_edit_lock(text,text,text,text,uuid,integer) to authenticated;
grant execute on function public.release_feature_edit_lock(text,text,text,text,uuid) to authenticated;
grant execute on function public.save_feature_edit_batch(text,text,text,text,jsonb) to authenticated;

-- 锁、历史与快照仅向登录用户展示。
drop policy if exists feature_edit_locks_read on public.feature_edit_locks;
drop policy if exists feature_change_batches_read on public.feature_change_batches;
drop policy if exists feature_versions_read on public.feature_versions;
drop policy if exists feature_snapshots_read on public.feature_snapshots;
drop policy if exists feature_snapshot_items_read on public.feature_snapshot_items;
create policy feature_edit_locks_read on public.feature_edit_locks for select to authenticated using (true);
create policy feature_change_batches_read on public.feature_change_batches for select to authenticated using (true);
create policy feature_versions_read on public.feature_versions for select to authenticated using (true);
create policy feature_snapshots_read on public.feature_snapshots for select to authenticated using (true);
create policy feature_snapshot_items_read on public.feature_snapshot_items for select to authenticated using (true);
revoke select on table public.feature_edit_locks from anon;
revoke select on table public.feature_change_batches from anon;
revoke select on table public.feature_versions from anon;
revoke select on table public.feature_snapshots from anon;
revoke select on table public.feature_snapshot_items from anon;
