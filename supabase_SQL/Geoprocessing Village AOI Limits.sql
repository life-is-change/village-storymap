-- Run after Geoprocessing Local Source Inputs.sql. Re-runnable.
-- The configured limit is shared by the source-status response and submission RPC.
begin;

with desired(village_id, max_aoi_sq_km) as (
  values ('00000000-0000-4000-8000-000000000001'::uuid, 2::numeric),
         ('79ea2696-baf9-4194-acf0-fb29667bd874'::uuid, 10::numeric)
)
insert into public.geoprocessing_villages(village_id, display_name, bounds, max_aoi_sq_km, active)
select village.id::text, village.name,
  coalesce(source.bounds, existing.bounds), desired.max_aoi_sq_km, true
from desired
join public.villages village on village.id = desired.village_id
left join public.geoprocessing_source_status source on source.village_id = village.id::text
left join public.geoprocessing_villages existing on existing.village_id = village.id::text
on conflict(village_id) do update set
  display_name = excluded.display_name,
  bounds = excluded.bounds,
  max_aoi_sq_km = excluded.max_aoi_sq_km,
  active = true;

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
  s.bounds, coalesce(g.max_aoi_sq_km, 2), s.checked_at
  from (select p_village_id as village_id) requested
  left join public.geoprocessing_source_status s on s.village_id = requested.village_id
  left join public.worker_heartbeats h on h.worker_id = s.worker_id
  left join public.geoprocessing_villages g on g.village_id = requested.village_id;
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
  v_max_area numeric;
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
  v_max_area := v_source.max_aoi_sq_km;
  if jsonb_typeof(v_bounds) <> 'array' or jsonb_array_length(v_bounds) <> 4 then
    raise exception 'INVALID_SOURCE_BOUNDS';
  end if;
  if v_max_area is null or v_max_area <= 0 then raise exception 'INVALID_AOI_LIMIT'; end if;
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
