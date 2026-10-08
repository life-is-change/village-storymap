-- Personal figure-ground spaces and immutable import versions.
-- Run after:
--   1. Supabase Auth Profiles and Identity RLS.sql
--   2. Geoprocessing Worker Queue.sql

create table if not exists public.course_personal_spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  village_id text not null references public.geoprocessing_villages(village_id),
  space_type text not null default 'course_personal' check (space_type = 'course_personal'),
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, course_id, village_id, space_type)
);

create table if not exists public.personal_result_bundles (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.course_personal_spaces(id) on delete cascade,
  source_run_id uuid not null references public.geoprocessing_runs(id),
  imported_at timestamptz not null default now(),
  unique(space_id, source_run_id)
);

create table if not exists public.personal_layer_versions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.course_personal_spaces(id) on delete cascade,
  bundle_id uuid not null references public.personal_result_bundles(id) on delete cascade,
  layer_key text not null check (layer_key in ('building','road','water','contours')),
  version_number integer not null check (version_number > 0),
  source_run_id uuid not null references public.geoprocessing_runs(id),
  artifact_types text[] not null default '{}'::text[],
  feature_count integer not null default 0 check (feature_count >= 0),
  editable boolean not null default true,
  created_at timestamptz not null default now(),
  unique(space_id, layer_key, version_number),
  unique(space_id, layer_key, source_run_id)
);

create table if not exists public.personal_layer_features (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.course_personal_spaces(id) on delete cascade,
  layer_version_id uuid not null references public.personal_layer_versions(id) on delete cascade,
  layer_key text not null check (layer_key in ('building','road','water','contours')),
  object_code text not null,
  object_name text,
  geom jsonb not null,
  props jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(layer_version_id, object_code)
);

create table if not exists public.personal_layer_selections (
  space_id uuid not null references public.course_personal_spaces(id) on delete cascade,
  layer_key text not null check (layer_key in ('building','road','water','contours')),
  current_version_id uuid not null references public.personal_layer_versions(id) on delete restrict,
  comparison_version_id uuid references public.personal_layer_versions(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(space_id, layer_key)
);

create index if not exists personal_layer_versions_space_idx
  on public.personal_layer_versions(space_id, layer_key, version_number desc);
create index if not exists personal_layer_features_version_idx
  on public.personal_layer_features(layer_version_id, object_code);

alter table public.course_personal_spaces enable row level security;
alter table public.personal_result_bundles enable row level security;
alter table public.personal_layer_versions enable row level security;
alter table public.personal_layer_features enable row level security;
alter table public.personal_layer_selections enable row level security;

drop policy if exists course_personal_spaces_read on public.course_personal_spaces;
create policy course_personal_spaces_read on public.course_personal_spaces
for select to authenticated using (
  owner_id = (select auth.uid()) or (select public.current_profile_role()) in ('teacher','admin')
);

drop policy if exists personal_result_bundles_read on public.personal_result_bundles;
create policy personal_result_bundles_read on public.personal_result_bundles
for select to authenticated using (exists (
  select 1 from public.course_personal_spaces s
  where s.id = public.personal_result_bundles.space_id
    and (s.owner_id = (select auth.uid()) or (select public.current_profile_role()) in ('teacher','admin'))
));

drop policy if exists personal_layer_versions_read on public.personal_layer_versions;
create policy personal_layer_versions_read on public.personal_layer_versions
for select to authenticated using (exists (
  select 1 from public.course_personal_spaces s
  where s.id = public.personal_layer_versions.space_id
    and (s.owner_id = (select auth.uid()) or (select public.current_profile_role()) in ('teacher','admin'))
));

drop policy if exists personal_layer_features_read on public.personal_layer_features;
create policy personal_layer_features_read on public.personal_layer_features
for select to authenticated using (exists (
  select 1 from public.course_personal_spaces s
  where s.id = public.personal_layer_features.space_id
    and (s.owner_id = (select auth.uid()) or (select public.current_profile_role()) in ('teacher','admin'))
));

drop policy if exists personal_layer_features_owner_insert on public.personal_layer_features;
create policy personal_layer_features_owner_insert on public.personal_layer_features
for insert to authenticated with check (exists (
  select 1 from public.course_personal_spaces s
  join public.personal_layer_versions v on v.space_id = s.id
  where s.id = public.personal_layer_features.space_id
    and v.id = public.personal_layer_features.layer_version_id
    and v.layer_key = public.personal_layer_features.layer_key
    and v.editable and s.owner_id = (select auth.uid())
));

drop policy if exists personal_layer_features_owner_update on public.personal_layer_features;
create policy personal_layer_features_owner_update on public.personal_layer_features
for update to authenticated using (exists (
  select 1 from public.course_personal_spaces s
  join public.personal_layer_versions v on v.space_id = s.id
  where s.id = public.personal_layer_features.space_id
    and v.id = public.personal_layer_features.layer_version_id
    and v.layer_key = public.personal_layer_features.layer_key
    and v.editable and s.owner_id = (select auth.uid())
)) with check (exists (
  select 1 from public.course_personal_spaces s
  join public.personal_layer_versions v on v.space_id = s.id
  where s.id = public.personal_layer_features.space_id
    and v.id = public.personal_layer_features.layer_version_id
    and v.layer_key = public.personal_layer_features.layer_key
    and v.editable and s.owner_id = (select auth.uid())
));

drop policy if exists personal_layer_features_owner_delete on public.personal_layer_features;
create policy personal_layer_features_owner_delete on public.personal_layer_features
for delete to authenticated using (exists (
  select 1 from public.course_personal_spaces s
  join public.personal_layer_versions v on v.space_id = s.id
  where s.id = public.personal_layer_features.space_id
    and v.id = public.personal_layer_features.layer_version_id
    and v.layer_key = public.personal_layer_features.layer_key
    and v.editable and s.owner_id = (select auth.uid())
));

drop policy if exists personal_layer_selections_read on public.personal_layer_selections;
create policy personal_layer_selections_read on public.personal_layer_selections
for select to authenticated using (exists (
  select 1 from public.course_personal_spaces s
  where s.id = public.personal_layer_selections.space_id
    and (s.owner_id = (select auth.uid()) or (select public.current_profile_role()) in ('teacher','admin'))
));

revoke all on public.course_personal_spaces, public.personal_result_bundles,
  public.personal_layer_versions, public.personal_layer_features,
  public.personal_layer_selections from anon;
revoke insert, update, delete on public.course_personal_spaces,
  public.personal_result_bundles, public.personal_layer_versions,
  public.personal_layer_selections from authenticated;
grant select on public.course_personal_spaces, public.personal_result_bundles,
  public.personal_layer_versions, public.personal_layer_features,
  public.personal_layer_selections to authenticated;
grant insert, update, delete on public.personal_layer_features to authenticated;

create or replace function public.ensure_course_personal_space(
  p_course_id text,
  p_village_id text,
  p_title text default null
) returns public.course_personal_spaces
language plpgsql security definer set search_path = ''
as $$
declare
  v_space public.course_personal_spaces;
  v_user_id uuid := auth.uid();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(trim(p_course_id), '') is null then raise exception 'COURSE_REQUIRED'; end if;
  if not exists(select 1 from public.geoprocessing_villages where village_id=p_village_id and active)
  then raise exception 'VILLAGE_NOT_AVAILABLE'; end if;

  insert into public.course_personal_spaces(owner_id,course_id,village_id,title)
  values(
    v_user_id, trim(p_course_id), p_village_id,
    coalesce(nullif(trim(p_title),''), '我的个人图底空间')
  )
  on conflict(owner_id,course_id,village_id,space_type)
  do update set updated_at=now()
  returning * into v_space;
  return v_space;
end;
$$;

create or replace function public.import_geoprocessing_result(
  p_run_id uuid,
  p_layers jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.geoprocessing_runs;
  v_space public.course_personal_spaces;
  v_bundle_id uuid;
  v_version_id uuid;
  v_layer record;
  v_feature jsonb;
  v_version_number integer;
  v_counter integer;
  v_object_code text;
  v_artifact_types text[];
  v_user_id uuid := auth.uid();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_layers) <> 'object' then raise exception 'INVALID_LAYER_PAYLOAD'; end if;
  if exists(select 1 from jsonb_object_keys(p_layers) as keys(layer_key)
            where keys.layer_key not in ('building','road','water','contours'))
  then raise exception 'INVALID_LAYER_KEY'; end if;

  select r.* into v_run from public.geoprocessing_runs r
  where r.id=p_run_id and r.owner_id=v_user_id and r.status='completed';
  if not found then raise exception 'COMPLETED_OWNED_RUN_REQUIRED'; end if;

  insert into public.course_personal_spaces(owner_id,course_id,village_id,title)
  values(v_user_id,v_run.course_id,v_run.village_id,'我的个人图底空间')
  on conflict(owner_id,course_id,village_id,space_type)
  do update set updated_at=now()
  returning * into v_space;

  perform 1 from public.course_personal_spaces where id=v_space.id for update;
  select id into v_bundle_id from public.personal_result_bundles
  where space_id=v_space.id and source_run_id=p_run_id;
  if v_bundle_id is not null then return v_bundle_id; end if;

  insert into public.personal_result_bundles(space_id,source_run_id)
  values(v_space.id,p_run_id) returning id into v_bundle_id;

  for v_layer in select key, value from jsonb_each(p_layers)
  loop
    if jsonb_typeof(v_layer.value) <> 'object'
       or jsonb_typeof(coalesce(v_layer.value->'features','[]'::jsonb)) <> 'array'
    then raise exception 'INVALID_GEOJSON_FEATURE_COLLECTION'; end if;

    select array_agg(a.artifact_type order by a.artifact_type) into v_artifact_types
    from public.geoprocessing_artifacts a
    where a.run_id=p_run_id and (
      (v_layer.key='building' and a.artifact_type='buildings') or
      (v_layer.key='road' and a.artifact_type='roads') or
      (v_layer.key='water' and a.artifact_type in ('waterways','water_areas')) or
      (v_layer.key='contours' and a.artifact_type='contours')
    );
    if coalesce(array_length(v_artifact_types,1),0)=0
    then raise exception 'SOURCE_ARTIFACT_REQUIRED'; end if;

    select coalesce(max(version_number),0)+1 into v_version_number
    from public.personal_layer_versions
    where space_id=v_space.id and layer_key=v_layer.key;

    insert into public.personal_layer_versions(
      space_id,bundle_id,layer_key,version_number,source_run_id,
      artifact_types,feature_count,editable
    ) values(
      v_space.id,v_bundle_id,v_layer.key,v_version_number,p_run_id,
      v_artifact_types,jsonb_array_length(coalesce(v_layer.value->'features','[]'::jsonb)),
      v_layer.key <> 'contours'
    ) returning id into v_version_id;

    v_counter := 0;
    for v_feature in select value from jsonb_array_elements(coalesce(v_layer.value->'features','[]'::jsonb))
    loop
      v_counter := v_counter + 1;
      if jsonb_typeof(v_feature->'geometry') <> 'object' then raise exception 'INVALID_FEATURE_GEOMETRY'; end if;
      v_object_code := coalesce(
        nullif(v_feature->>'id',''),
        nullif(v_feature->'properties'->>'object_code',''),
        nullif(v_feature->'properties'->>'code',''),
        nullif(v_feature->'properties'->>'id',''),
        format('%s-v%s-%s',v_layer.key,v_version_number,v_counter)
      );
      insert into public.personal_layer_features(
        space_id,layer_version_id,layer_key,object_code,object_name,geom,props
      ) values(
        v_space.id,v_version_id,v_layer.key,v_object_code,
        coalesce(nullif(v_feature->'properties'->>'name',''),v_object_code),
        v_feature->'geometry',coalesce(v_feature->'properties','{}'::jsonb)
      );
    end loop;

    insert into public.personal_layer_selections(space_id,layer_key,current_version_id,comparison_version_id)
    values(v_space.id,v_layer.key,v_version_id,null)
    on conflict(space_id,layer_key) do update set
      current_version_id=excluded.current_version_id,
      comparison_version_id=null,
      updated_at=now();
  end loop;

  return v_bundle_id;
end;
$$;

create or replace function public.set_personal_layer_version(
  p_space_id uuid,
  p_layer_key text,
  p_version_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.course_personal_spaces
                where id=p_space_id and owner_id=v_user_id)
  then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.personal_layer_versions
                where id=p_version_id and space_id=p_space_id and layer_key=p_layer_key)
  then raise exception 'VERSION_NOT_IN_LAYER'; end if;
  insert into public.personal_layer_selections(space_id,layer_key,current_version_id,comparison_version_id)
  values(p_space_id,p_layer_key,p_version_id,null)
  on conflict(space_id,layer_key) do update set
    current_version_id=excluded.current_version_id,
    comparison_version_id=null,
    updated_at=now();
  return true;
end;
$$;

create or replace function public.delete_personal_layer_version(
  p_version_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_version public.personal_layer_versions;
  v_user_id uuid := auth.uid();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select v.* into v_version from public.personal_layer_versions v
  join public.course_personal_spaces s on s.id=v.space_id
  where v.id=p_version_id and s.owner_id=v_user_id;
  if not found then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.personal_layer_selections
            where current_version_id=p_version_id)
  then raise exception 'CURRENT_VERSION_DELETE_FORBIDDEN'; end if;
  delete from public.personal_layer_versions where id=p_version_id;
  delete from public.personal_result_bundles b
  where b.id=v_version.bundle_id
    and not exists(select 1 from public.personal_layer_versions v where v.bundle_id=b.id);
  return true;
end;
$$;

create or replace function public.save_personal_feature_edit_batch(
  p_space_id uuid,
  p_changes jsonb
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_change jsonb;
  v_layer_key text;
  v_action text;
  v_object_code text;
  v_version_id uuid;
  v_saved integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'INVALID_CHANGES'; end if;
  if not exists(select 1 from public.course_personal_spaces
                where id=p_space_id and owner_id=v_user_id)
  then raise exception 'FORBIDDEN'; end if;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_action := v_change->>'action';
    v_layer_key := v_change->>'layerKey';
    v_object_code := nullif(trim(v_change->>'objectCode'), '');
    if v_action not in ('add','update','delete')
       or v_layer_key not in ('building','road','water')
       or v_object_code is null
    then raise exception 'INVALID_CHANGE'; end if;

    select s.current_version_id into v_version_id
    from public.personal_layer_selections s
    join public.personal_layer_versions v on v.id=s.current_version_id
    where s.space_id=p_space_id and s.layer_key=v_layer_key
      and v.space_id=p_space_id and v.layer_key=v_layer_key and v.editable;
    if v_version_id is null then raise exception 'EDITABLE_CURRENT_VERSION_REQUIRED'; end if;

    if v_action='delete' then
      update public.personal_layer_features
      set is_deleted=true, updated_at=now()
      where space_id=p_space_id and layer_version_id=v_version_id
        and layer_key=v_layer_key and object_code=v_object_code;
      if not found then raise exception 'FEATURE_NOT_FOUND'; end if;
    else
      if jsonb_typeof(v_change->'afterGeom') <> 'object'
      then raise exception 'INVALID_FEATURE_GEOMETRY'; end if;
      insert into public.personal_layer_features(
        space_id,layer_version_id,layer_key,object_code,object_name,geom,props,is_deleted,updated_at
      ) values(
        p_space_id,v_version_id,v_layer_key,v_object_code,
        coalesce(nullif(v_change->>'objectName',''),v_object_code),
        v_change->'afterGeom',coalesce(v_change->'afterProps','{}'::jsonb),false,now()
      )
      on conflict(layer_version_id,object_code) do update set
        object_name=excluded.object_name,
        geom=excluded.geom,
        props=excluded.props,
        is_deleted=false,
        updated_at=now();
    end if;
    v_saved := v_saved + 1;
  end loop;
  update public.personal_layer_versions v
  set feature_count=(
    select count(*) from public.personal_layer_features f
    where f.layer_version_id=v.id and not f.is_deleted
  )
  where v.id in (
    select s.current_version_id from public.personal_layer_selections s
    where s.space_id=p_space_id
  );
  return v_saved;
end;
$$;

revoke all on function public.ensure_course_personal_space(text,text,text) from public, anon, authenticated;
grant execute on function public.ensure_course_personal_space(text,text,text) to authenticated;
revoke all on function public.import_geoprocessing_result(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.import_geoprocessing_result(uuid,jsonb) to authenticated;
revoke all on function public.set_personal_layer_version(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.set_personal_layer_version(uuid,text,uuid) to authenticated;
revoke all on function public.delete_personal_layer_version(uuid) from public, anon, authenticated;
grant execute on function public.delete_personal_layer_version(uuid) to authenticated;
revoke all on function public.save_personal_feature_edit_batch(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_personal_feature_edit_batch(uuid,jsonb) to authenticated;
