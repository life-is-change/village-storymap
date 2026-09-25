-- Apply after Geoprocessing Worker Queue.sql and Multi-Village Dual-Track Repair.sql.
-- This definition includes the published practice-village authorization fix;
-- never reapply older submit_geoprocessing_run definitions afterward.
-- This migration changes STUDENT processing inputs only. Published shared datasets stay untouched.
begin;

create table if not exists public.geoprocessing_source_status (
  village_id text primary key,
  ready boolean not null,
  error_code text,
  bounds jsonb,
  worker_id text not null,
  checked_at timestamptz not null default now(),
  constraint geoprocessing_source_status_error_check check (
    error_code is null or error_code in (
      'LOCAL_IMAGERY_MISSING', 'LOCAL_SHARED_SOURCE_MISSING', 'LOCAL_SOURCE_NOT_REGISTERED'
    )
  ),
  constraint geoprocessing_source_status_ready_check check (not ready or bounds is not null)
);
alter table public.geoprocessing_source_status enable row level security;
revoke all on public.geoprocessing_source_status from public, anon, authenticated;

create or replace function public.upsert_geoprocessing_source_status(
  p_village_id text, p_ready boolean, p_error_code text, p_worker_id text, p_bounds jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if nullif(trim(p_village_id), '') is null or nullif(trim(p_worker_id), '') is null then
    raise exception 'INVALID_SOURCE_STATUS';
  end if;
  if p_error_code is not null and p_error_code not in (
    'LOCAL_IMAGERY_MISSING', 'LOCAL_SHARED_SOURCE_MISSING', 'LOCAL_SOURCE_NOT_REGISTERED'
  ) then raise exception 'INVALID_SOURCE_STATUS'; end if;
  if p_ready is null or (p_ready and p_error_code is not null)
     or (not p_ready and p_error_code is null) then
    raise exception 'INVALID_SOURCE_STATUS';
  end if;
  if p_bounds is not null and (jsonb_typeof(p_bounds) <> 'array' or jsonb_array_length(p_bounds) <> 4) then
    raise exception 'INVALID_SOURCE_BOUNDS';
  end if;
  if p_ready and p_bounds is null then raise exception 'INVALID_SOURCE_BOUNDS'; end if;
  if p_bounds is not null then
    if exists (select 1 from jsonb_array_elements(p_bounds) item where jsonb_typeof(item) <> 'number')
    then raise exception 'INVALID_SOURCE_BOUNDS'; end if;
    if (p_bounds->>0)::numeric < -180 or (p_bounds->>2)::numeric > 180
       or (p_bounds->>1)::numeric < -90 or (p_bounds->>3)::numeric > 90
       or (p_bounds->>0)::numeric >= (p_bounds->>2)::numeric
       or (p_bounds->>1)::numeric >= (p_bounds->>3)::numeric
    then raise exception 'INVALID_SOURCE_BOUNDS'; end if;
  end if;
  insert into public.geoprocessing_source_status(village_id, ready, error_code, bounds, worker_id, checked_at)
  values(p_village_id, p_ready, p_error_code, p_bounds, p_worker_id, now())
  on conflict(village_id) do update set ready = excluded.ready, error_code = excluded.error_code,
    bounds = excluded.bounds, worker_id = excluded.worker_id, checked_at = excluded.checked_at;
end;
$$;
revoke all on function public.upsert_geoprocessing_source_status(text,boolean,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.upsert_geoprocessing_source_status(text,boolean,text,text,jsonb) to service_role;

create or replace function public.get_geoprocessing_source_status(p_village_id text)
returns table(state text, error_code text, bounds jsonb, max_aoi_sq_km numeric, checked_at timestamptz)
language sql security definer set search_path = public, pg_temp
as $$
  select case
    when s.village_id is null then 'missing'
    when s.checked_at < now() - interval '2 minutes' then 'stale'
    when h.last_seen_at is null or h.last_seen_at < now() - interval '2 minutes'
      or h.state = 'offline' then 'offline'
    when not s.ready then 'missing'
    else 'ready'
  end::text,
  case
    when s.village_id is null then 'LOCAL_SOURCE_NOT_REGISTERED'
    when s.checked_at < now() - interval '2 minutes' then 'SOURCE_STATUS_STALE'
    when h.last_seen_at is null or h.last_seen_at < now() - interval '2 minutes'
      or h.state = 'offline' then 'WORKER_OFFLINE'
    else s.error_code
  end::text,
  s.bounds, 2::numeric, s.checked_at
  from (select p_village_id as village_id) requested
  left join public.geoprocessing_source_status s on s.village_id = requested.village_id
  left join public.worker_heartbeats h on h.worker_id = s.worker_id;
$$;
revoke all on function public.get_geoprocessing_source_status(text) from public, anon;
grant execute on function public.get_geoprocessing_source_status(text) to authenticated, service_role;

create or replace function public.submit_geoprocessing_run(
  p_course_id text, p_village_id text, p_requested_steps text[], p_aoi jsonb, p_parameters jsonb,
  p_teaching_project_id uuid, p_dataset_id uuid
) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_run_id uuid;
  v_village public.villages;
  v_source record;
  v_bounds jsonb;
  v_geom geometry;
  v_max_area numeric := 2;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_teaching_project_id is null then raise exception 'TEACHING_PROJECT_REQUIRED'; end if;
  select * into v_village from public.villages where id::text = p_village_id;
  if v_village.id is null or not exists (
    select 1 from public.teaching_projects project
    where project.id = p_teaching_project_id and project.course_id = p_course_id
      and project.stage not in ('completed', 'archived')
      and v_village.status = 'published'
      and (v_village.is_practice or (
        project.formal_project_open and project.formal_village_id = v_village.id
        and not v_village.is_practice
      ))
  ) then raise exception 'PROJECT_VILLAGE_MISMATCH'; end if;
  if public.current_profile_role() not in ('teacher', 'admin') and not exists (
    select 1 from public.group_memberships membership
    where membership.course_id = p_course_id
      and membership.student_key = public.current_profile_student_key()
  ) then raise exception 'PROJECT_ACCESS_REQUIRED'; end if;

  select * into v_source from public.get_geoprocessing_source_status(p_village_id);
  if v_source.state <> 'ready' then
    raise exception '%', coalesce(v_source.error_code, 'LOCAL_SOURCE_NOT_READY');
  end if;
  v_bounds := v_source.bounds;
  if jsonb_typeof(v_bounds) <> 'array' or jsonb_array_length(v_bounds) <> 4 then
    raise exception 'INVALID_SOURCE_BOUNDS';
  end if;
  if coalesce(array_length(p_requested_steps, 1), 0) = 0
     or not p_requested_steps <@ array['buildings','roads_water','contours']::text[]
  then raise exception 'INVALID_PROCESSING_STEP'; end if;
  if coalesce(p_parameters, '{}'::jsonb) - array['building_threshold','contour_interval','contour_smoothing']::text[] <> '{}'::jsonb
  then raise exception 'INVALID_PARAMETERS'; end if;
  begin
    v_geom := st_setsrid(st_geomfromgeojson(p_aoi::text), 4326);
  exception when others then raise exception 'INVALID_AOI'; end;
  if v_geom is null or geometrytype(v_geom) not in ('POLYGON','MULTIPOLYGON')
     or st_npoints(v_geom) > 500 or not st_isvalid(v_geom)
  then raise exception 'INVALID_AOI'; end if;
  if not st_coveredby(v_geom, v_village.boundary) then raise exception 'AOI_OUTSIDE_VILLAGE'; end if;
  if not st_coveredby(v_geom, st_makeenvelope(
    (v_bounds->>0)::double precision, (v_bounds->>1)::double precision,
    (v_bounds->>2)::double precision, (v_bounds->>3)::double precision, 4326
  )) then raise exception 'AOI_OUTSIDE_SOURCE'; end if;
  if st_area(v_geom::geography) > v_max_area * 1000000 then raise exception 'AOI_TOO_LARGE'; end if;
  if (select count(*) from public.geoprocessing_runs
      where owner_id = auth.uid() and status in ('queued','claimed','running','cancel_requested')) >= 2
  then raise exception 'TOO_MANY_ACTIVE_RUNS'; end if;

  insert into public.geoprocessing_villages(village_id, display_name, bounds, max_aoi_sq_km, active)
  values(p_village_id, v_village.name, v_bounds, v_max_area, true)
  on conflict(village_id) do update set display_name = excluded.display_name,
    bounds = excluded.bounds, max_aoi_sq_km = excluded.max_aoi_sq_km, active = true;
  insert into public.geoprocessing_runs(
    owner_id, course_id, village_id, teaching_project_id, dataset_id, input_manifest,
    requested_steps, aoi, parameters
  ) values (
    auth.uid(), p_course_id, p_village_id, p_teaching_project_id, null, null,
    p_requested_steps, p_aoi, coalesce(p_parameters, '{}'::jsonb)
  ) returning id into v_run_id;
  return v_run_id;
end;
$$;
revoke all on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb,uuid,uuid) from public, anon;
grant execute on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb,uuid,uuid) to authenticated;

commit;
