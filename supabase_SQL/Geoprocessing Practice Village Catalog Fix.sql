begin;

-- The practice catalog exposes every published practice village for the active
-- teaching project. Keep the geoprocessing authorization in step with that
-- catalog while retaining exact course, project, dataset and membership checks.
create or replace function public.submit_geoprocessing_run(
  p_course_id text, p_village_id text, p_requested_steps text[], p_aoi jsonb, p_parameters jsonb,
  p_teaching_project_id uuid, p_dataset_id uuid
) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_run_id uuid;
  v_village public.villages;
  v_dataset public.village_datasets;
  v_input_manifest jsonb;
  v_bounds jsonb;
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
  if not exists (
    select 1 from public.teaching_projects project
    where project.id = p_teaching_project_id and project.course_id = p_course_id
      and project.stage not in ('completed', 'archived')
      and v_village.status = 'published'
      and ((v_village.is_practice and v_village.status = 'published')
        or (project.formal_project_open and project.formal_village_id = v_village.id
          and not v_village.is_practice))
  ) then raise exception 'PROJECT_VILLAGE_MISMATCH'; end if;
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
  values (v_village.id::text, v_village.name, v_bounds,
    greatest(st_area(v_village.boundary::geography) / 1000000.0, 0.01), true)
  on conflict(village_id) do update set display_name = excluded.display_name,
    bounds = excluded.bounds, max_aoi_sq_km = excluded.max_aoi_sq_km, active = true;
  v_run_id := public.submit_geoprocessing_run(
    p_course_id, p_village_id, p_requested_steps, p_aoi, p_parameters
  );
  update public.geoprocessing_runs set teaching_project_id = p_teaching_project_id,
    dataset_id = p_dataset_id, input_manifest = v_input_manifest where id = v_run_id;
  return v_run_id;
end;
$$;
revoke all on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb,uuid,uuid) from public, anon;
grant execute on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb,uuid,uuid) to authenticated;

-- A missing heartbeat must not be reported as "available".
create or replace function public.get_worker_availability()
returns table(state text, last_seen_minute timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  with fresh as (
    select worker.state, worker.last_seen_at from public.worker_heartbeats worker
    where worker.last_seen_at >= now() - interval '2 minutes'
  )
  select coalesce(case when count(*) = 0 then 'offline'
    when bool_or(fresh.state = 'busy') then 'busy' else 'available' end, 'offline')::text,
    date_trunc('minute', max(fresh.last_seen_at)) from fresh;
$$;
revoke all on function public.get_worker_availability() from public, anon;
grant execute on function public.get_worker_availability() to authenticated;

commit;
