-- Secure outbound-worker queue for the village geoprocessing platform.
-- Run after "Supabase Auth Profiles and Identity RLS.sql".

create extension if not exists postgis with schema extensions;

create table if not exists public.geoprocessing_villages (
  village_id text primary key,
  display_name text not null,
  bounds jsonb not null,
  max_aoi_sq_km numeric not null check (max_aoi_sq_km > 0),
  active boolean not null default false
);

create table if not exists public.geoprocessing_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  village_id text not null references public.geoprocessing_villages(village_id),
  teaching_project_id uuid,
  dataset_id uuid,
  input_manifest jsonb,
  requested_steps text[] not null,
  aoi jsonb not null,
  parameters jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in
    ('queued','claimed','running','completed','failed','cancel_requested','canceled')),
  current_stage text,
  progress smallint not null default 0 check (progress between 0 and 100),
  warnings jsonb not null default '[]'::jsonb,
  worker_id text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.geoprocessing_runs
  add column if not exists teaching_project_id uuid,
  add column if not exists dataset_id uuid,
  add column if not exists input_manifest jsonb;

do $$ begin
  alter table public.geoprocessing_runs
    add constraint geoprocessing_runs_teaching_project_fk
    foreign key (teaching_project_id) references public.teaching_projects(id) on delete restrict;
exception when duplicate_object or undefined_table then null;
end $$;
do $$ begin
  alter table public.geoprocessing_runs
    add constraint geoprocessing_runs_dataset_fk
    foreign key (dataset_id) references public.village_datasets(id) on delete restrict;
exception when duplicate_object or undefined_table then null;
end $$;

create index if not exists geoprocessing_runs_queue_idx
  on public.geoprocessing_runs(status, created_at);
create index if not exists geoprocessing_runs_owner_idx
  on public.geoprocessing_runs(owner_id, created_at desc);

create table if not exists public.geoprocessing_artifacts (
  run_id uuid not null references public.geoprocessing_runs(id) on delete cascade,
  artifact_type text not null,
  storage_path text not null,
  feature_count integer not null default 0,
  bbox jsonb not null,
  sha256 text not null,
  source jsonb not null default '{}'::jsonb,
  warning_code text,
  created_at timestamptz not null default now(),
  primary key (run_id, artifact_type)
);

create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  state text not null check (state in ('available','busy','offline')),
  version text,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.geoprocessing_queue_control (
  singleton boolean primary key default true check (singleton),
  paused boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.geoprocessing_queue_control(singleton, paused)
values (true, false) on conflict (singleton) do nothing;

insert into public.geoprocessing_villages(village_id, display_name, bounds, max_aoi_sq_km, active)
values ('mibu', '米埗村', '[113.6578225,23.6739555,113.6695615,23.6806181]'::jsonb, 2, true)
on conflict (village_id) do update set
  display_name = excluded.display_name,
  bounds = excluded.bounds,
  max_aoi_sq_km = excluded.max_aoi_sq_km,
  active = excluded.active;

alter table public.geoprocessing_villages enable row level security;
alter table public.geoprocessing_runs enable row level security;
alter table public.geoprocessing_artifacts enable row level security;
alter table public.worker_heartbeats enable row level security;
alter table public.geoprocessing_queue_control enable row level security;

drop policy if exists geoprocessing_villages_read_active on public.geoprocessing_villages;
create policy geoprocessing_villages_read_active on public.geoprocessing_villages
for select to authenticated using (active or public.current_profile_role() in ('teacher','admin'));

drop policy if exists geoprocessing_runs_read_own on public.geoprocessing_runs;
create policy geoprocessing_runs_read_own on public.geoprocessing_runs
for select to authenticated using (
  owner_id = auth.uid() or public.current_profile_role() in ('teacher','admin')
);

drop policy if exists geoprocessing_artifacts_read_own on public.geoprocessing_artifacts;
create policy geoprocessing_artifacts_read_own on public.geoprocessing_artifacts
for select to authenticated using (exists (
  select 1 from public.geoprocessing_runs r
  where r.id = run_id and (r.owner_id = auth.uid() or public.current_profile_role() in ('teacher','admin'))
));

revoke insert, update, delete on public.geoprocessing_runs from anon, authenticated;
revoke insert, update, delete on public.geoprocessing_artifacts from anon, authenticated;
revoke update on public.geoprocessing_runs from authenticated;
grant select on public.geoprocessing_villages, public.geoprocessing_runs, public.geoprocessing_artifacts to authenticated;

create or replace function public.submit_geoprocessing_run(
  p_course_id text, p_village_id text, p_requested_steps text[], p_aoi jsonb, p_parameters jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_bounds jsonb;
  v_max_area numeric;
  v_geom geometry;
  v_envelope geometry;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select bounds, max_aoi_sq_km into v_bounds, v_max_area
  from public.geoprocessing_villages where village_id = p_village_id and active;
  if not found then raise exception 'VILLAGE_NOT_AVAILABLE'; end if;
  if coalesce(array_length(p_requested_steps, 1), 0) = 0
     or not p_requested_steps <@ array['buildings','roads_water','contours']::text[]
  then raise exception 'INVALID_PROCESSING_STEP'; end if;
  if p_parameters - array['building_threshold','contour_interval','contour_smoothing']::text[] <> '{}'::jsonb
  then raise exception 'INVALID_PARAMETERS'; end if;
  begin v_geom := st_setsrid(st_geomfromgeojson(p_aoi::text), 4326);
  exception when others then raise exception 'INVALID_AOI'; end;
  if geometrytype(v_geom) not in ('POLYGON','MULTIPOLYGON') or st_npoints(v_geom) > 500 or not st_isvalid(v_geom)
  then raise exception 'INVALID_AOI'; end if;
  v_envelope := st_makeenvelope(
    (v_bounds->>0)::double precision, (v_bounds->>1)::double precision,
    (v_bounds->>2)::double precision, (v_bounds->>3)::double precision, 4326
  );
  if not st_coveredby(v_geom, v_envelope) then raise exception 'AOI_OUTSIDE_VILLAGE'; end if;
  if st_area(v_geom::geography) > v_max_area * 1000000 then raise exception 'AOI_TOO_LARGE'; end if;
  if (select count(*) from public.geoprocessing_runs
      where owner_id = auth.uid() and status in ('queued','claimed','running','cancel_requested')) >= 2
  then raise exception 'TOO_MANY_ACTIVE_RUNS'; end if;
  insert into public.geoprocessing_runs(owner_id, course_id, village_id, requested_steps, aoi, parameters)
  values (auth.uid(), p_course_id, p_village_id, p_requested_steps, p_aoi, p_parameters)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.submit_geoprocessing_run(
  p_course_id text, p_village_id text, p_requested_steps text[], p_aoi jsonb, p_parameters jsonb,
  p_teaching_project_id uuid, p_dataset_id uuid
) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_bounds jsonb;
  v_max_area numeric;
  v_geom geometry;
  v_envelope geometry;
  v_input_manifest jsonb;
  v_village public.villages;
  v_dataset public.village_datasets;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_teaching_project_id is null then raise exception 'TEACHING_PROJECT_REQUIRED'; end if;
  if p_dataset_id is null then raise exception 'DATASET_REQUIRED'; end if;

  select * into v_dataset from public.village_datasets where id = p_dataset_id;
  select * into v_village from public.villages where id::text = p_village_id;
  if v_dataset.id is null or v_village.id is null or v_dataset.village_id <> v_village.id then
    raise exception 'DATASET_VILLAGE_MISMATCH';
  end if;
  if v_dataset.status <> 'published' and public.current_profile_role() not in ('teacher','admin') then
    raise exception 'PUBLISHED_DATASET_REQUIRED';
  end if;
  if not exists (
    select 1 from public.teaching_projects project
    where project.id = p_teaching_project_id and project.course_id = p_course_id
      and v_village.id in (project.practice_village_id, project.formal_village_id)
  ) then raise exception 'PROJECT_VILLAGE_MISMATCH'; end if;

  v_input_manifest := v_dataset.layer_manifest->'worker_manifest';
  if jsonb_typeof(v_input_manifest) <> 'object' or jsonb_typeof(v_input_manifest->'files') <> 'object' then
    raise exception 'WORKER_MANIFEST_REQUIRED';
  end if;
  if v_input_manifest::text ~* 'https?://' then raise exception 'ARBITRARY_DATASET_URL_FORBIDDEN'; end if;

  v_bounds := jsonb_build_array(
    st_xmin(box2d(v_village.boundary)), st_ymin(box2d(v_village.boundary)),
    st_xmax(box2d(v_village.boundary)), st_ymax(box2d(v_village.boundary))
  );
  v_max_area := greatest(st_area(v_village.boundary::geography) / 1000000.0, 0.01);
  insert into public.geoprocessing_villages(village_id, display_name, bounds, max_aoi_sq_km, active)
  values(v_village.id::text, v_village.name, v_bounds, v_max_area, true)
  on conflict(village_id) do update set display_name=excluded.display_name,
    bounds=excluded.bounds,max_aoi_sq_km=excluded.max_aoi_sq_km,active=true;

  if coalesce(array_length(p_requested_steps, 1), 0) = 0
     or not p_requested_steps <@ array['buildings','roads_water','contours']::text[]
  then raise exception 'INVALID_PROCESSING_STEP'; end if;
  if p_parameters - array['building_threshold','contour_interval','contour_smoothing']::text[] <> '{}'::jsonb
  then raise exception 'INVALID_PARAMETERS'; end if;
  begin v_geom := st_setsrid(st_geomfromgeojson(p_aoi::text), 4326);
  exception when others then raise exception 'INVALID_AOI'; end;
  if geometrytype(v_geom) not in ('POLYGON','MULTIPOLYGON') or st_npoints(v_geom) > 500 or not st_isvalid(v_geom)
  then raise exception 'INVALID_AOI'; end if;
  v_envelope := st_makeenvelope(
    (v_bounds->>0)::double precision, (v_bounds->>1)::double precision,
    (v_bounds->>2)::double precision, (v_bounds->>3)::double precision, 4326
  );
  if not st_coveredby(v_geom, v_envelope) then raise exception 'AOI_OUTSIDE_VILLAGE'; end if;
  if st_area(v_geom::geography) > v_max_area * 1000000 then raise exception 'AOI_TOO_LARGE'; end if;
  if (select count(*) from public.geoprocessing_runs
      where owner_id = auth.uid() and status in ('queued','claimed','running','cancel_requested')) >= 2
  then raise exception 'TOO_MANY_ACTIVE_RUNS'; end if;

  insert into public.geoprocessing_runs(
    owner_id, course_id, village_id, teaching_project_id, dataset_id, input_manifest,
    requested_steps, aoi, parameters
  ) values (
    auth.uid(), p_course_id, p_village_id, p_teaching_project_id, p_dataset_id, v_input_manifest,
    p_requested_steps, p_aoi, p_parameters
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.claim_next_geoprocessing_run(p_worker_id text)
returns setof public.geoprocessing_runs
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if (select paused from public.geoprocessing_queue_control where singleton) then return; end if;
  select id into v_id
  from public.geoprocessing_runs
  where (status = 'queued' or (status in ('claimed','running') and lease_expires_at < now()))
    and attempt_count < 3
  order by created_at
  for update skip locked
  limit 1;
  if v_id is null then return; end if;
  return query update public.geoprocessing_runs set
    status='claimed', worker_id=p_worker_id, lease_expires_at=now()+interval '90 seconds',
    attempt_count=attempt_count+1, updated_at=now()
  where id=v_id returning *;
end; $$;

create or replace function public.renew_geoprocessing_lease(p_run_id uuid, p_worker_id text)
returns boolean language sql security definer set search_path = public as $$
  update public.geoprocessing_runs set lease_expires_at=now()+interval '90 seconds', updated_at=now()
  where id=p_run_id and worker_id=p_worker_id and status in ('claimed','running') returning true;
$$;

create or replace function public.set_geoprocessing_run_state(
  p_run_id uuid, p_worker_id text, p_status text, p_stage text default null,
  p_progress smallint default null, p_error_code text default null,
  p_error_message text default null, p_warnings jsonb default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('running','completed','failed','canceled') then raise exception 'INVALID_STATUS'; end if;
  update public.geoprocessing_runs set status=p_status, current_stage=p_stage,
    progress=coalesce(p_progress,progress), error_code=p_error_code, error_message=p_error_message,
    warnings=coalesce(p_warnings,warnings), started_at=case when p_status='running' then coalesce(started_at,now()) else started_at end,
    completed_at=case when p_status in ('completed','failed','canceled') then now() else completed_at end,
    lease_expires_at=case when p_status in ('completed','failed','canceled') then null else lease_expires_at end,
    updated_at=now()
  where id=p_run_id and worker_id=p_worker_id;
  return found;
end; $$;

create or replace function public.record_geoprocessing_artifact(
  p_run_id uuid, p_worker_id text, p_artifact_type text, p_storage_path text,
  p_feature_count integer, p_bbox jsonb, p_sha256 text, p_source jsonb, p_warning_code text default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.geoprocessing_runs where id=p_run_id and worker_id=p_worker_id)
  then return false; end if;
  insert into public.geoprocessing_artifacts(run_id,artifact_type,storage_path,feature_count,bbox,sha256,source,warning_code)
  values(p_run_id,p_artifact_type,p_storage_path,p_feature_count,p_bbox,p_sha256,p_source,p_warning_code)
  on conflict(run_id,artifact_type) do update set storage_path=excluded.storage_path,
    feature_count=excluded.feature_count,bbox=excluded.bbox,sha256=excluded.sha256,
    source=excluded.source,warning_code=excluded.warning_code,created_at=now();
  return true;
end; $$;

create or replace function public.request_geoprocessing_cancel(p_run_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.geoprocessing_runs set status=case when status='queued' then 'canceled' else 'cancel_requested' end,
    completed_at=case when status='queued' then now() else completed_at end, updated_at=now()
  where id=p_run_id and owner_id=auth.uid() and status in ('queued','claimed','running');
  return found;
end; $$;

create or replace function public.teacher_cancel_geoprocessing_run(p_run_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if public.current_profile_role() not in ('teacher','admin') then raise exception 'FORBIDDEN'; end if;
  update public.geoprocessing_runs set status=case when status='queued' then 'canceled' else 'cancel_requested' end,
    updated_at=now() where id=p_run_id and status in ('queued','claimed','running');
  return found;
end; $$;

create or replace function public.set_geoprocessing_queue_paused(p_paused boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if public.current_profile_role() not in ('teacher','admin') then raise exception 'FORBIDDEN'; end if;
  update public.geoprocessing_queue_control set paused=p_paused,updated_at=now(),updated_by=auth.uid() where singleton;
  return true;
end; $$;

create or replace function public.get_worker_availability()
returns table(state text, last_seen_minute timestamptz)
language sql security definer set search_path = public as $$
  select case when max(last_seen_at) < now()-interval '2 minutes' then 'offline'
              when bool_or(state='busy') then 'busy' else 'available' end,
         date_trunc('minute',max(last_seen_at)) from public.worker_heartbeats;
$$;

create or replace function public.upsert_worker_heartbeat(p_worker_id text,p_state text,p_version text)
returns void language sql security definer set search_path = public as $$
  insert into public.worker_heartbeats(worker_id,state,version,last_seen_at)
  values(p_worker_id,p_state,p_version,now()) on conflict(worker_id) do update
  set state=excluded.state,version=excluded.version,last_seen_at=now();
$$;

revoke all on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb) from public, anon;
grant execute on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb) to authenticated;
revoke all on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb,uuid,uuid) from public, anon;
grant execute on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb,uuid,uuid) to authenticated;
revoke all on function public.claim_next_geoprocessing_run(text) from public, anon, authenticated;
grant execute on function public.claim_next_geoprocessing_run(text) to service_role;
revoke all on function public.renew_geoprocessing_lease(uuid,text) from public, anon, authenticated;
grant execute on function public.renew_geoprocessing_lease(uuid,text) to service_role;
revoke all on function public.set_geoprocessing_run_state(uuid,text,text,text,smallint,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.set_geoprocessing_run_state(uuid,text,text,text,smallint,text,text,jsonb) to service_role;
revoke all on function public.record_geoprocessing_artifact(uuid,text,text,text,integer,jsonb,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.record_geoprocessing_artifact(uuid,text,text,text,integer,jsonb,text,jsonb,text) to service_role;
revoke all on function public.upsert_worker_heartbeat(text,text,text) from public, anon, authenticated;
grant execute on function public.upsert_worker_heartbeat(text,text,text) to service_role;
revoke all on function public.request_geoprocessing_cancel(uuid) from public, anon;
grant execute on function public.request_geoprocessing_cancel(uuid) to authenticated;
revoke all on function public.teacher_cancel_geoprocessing_run(uuid) from public, anon;
grant execute on function public.teacher_cancel_geoprocessing_run(uuid) to authenticated;
revoke all on function public.set_geoprocessing_queue_paused(boolean) from public, anon;
grant execute on function public.set_geoprocessing_queue_paused(boolean) to authenticated;
revoke all on function public.get_worker_availability() from public, anon;
grant execute on function public.get_worker_availability() to authenticated;

insert into storage.buckets(id,name,public)
values('geoprocessing-results','geoprocessing-results',false)
on conflict(id) do update set public=false;

drop policy if exists geoprocessing_results_read_own on storage.objects;
create policy geoprocessing_results_read_own on storage.objects
for select to authenticated using (
  bucket_id='geoprocessing-results' and (storage.foldername(name))[1]=auth.uid()::text
);

drop policy if exists geoprocessing_results_service_write on storage.objects;
create policy geoprocessing_results_service_write on storage.objects
for all to service_role using (bucket_id='geoprocessing-results')
with check (bucket_id='geoprocessing-results');

do $$ begin
  alter publication supabase_realtime add table public.geoprocessing_runs;
exception when duplicate_object then null;
end $$;
