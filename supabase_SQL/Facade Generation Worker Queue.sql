-- MIGRATION - Two-stage facade generation queue
-- Apply after the multi-village repair migrations and Object Photos migrations.

create extension if not exists pgcrypto;

create table if not exists public.facade_generation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  space_id text not null,
  object_code text not null,
  photo_id bigint not null references public.object_photos(id) on delete restrict,
  source_photo_path text,
  source_photo_url text,
  status text not null default 'queued_rectification' check (status in (
    'queued_rectification','claimed_rectification','rectifying','awaiting_crop',
    'queued_generation','claimed_generation','generating','completed',
    'failed','cancel_requested','canceled'
  )),
  crop_top double precision check (crop_top between 0 and 0.65),
  roof_type text check (roof_type in ('hip','gable','flat')),
  building_width double precision check (building_width > 0 and building_width <= 500),
  building_depth double precision check (building_depth > 0 and building_depth <= 500),
  generation_revision integer not null default 0 check (generation_revision >= 0),
  progress smallint not null default 0 check (progress between 0 and 100),
  current_stage text,
  worker_id text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  rectification_attempt_count integer not null default 0,
  generation_attempt_count integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.facade_generation_runs
  add column if not exists source_photo_path text,
  add column if not exists source_photo_url text,
  add column if not exists rectification_attempt_count integer not null default 0,
  add column if not exists generation_attempt_count integer not null default 0;

create table if not exists public.facade_generation_artifacts (
  run_id uuid not null references public.facade_generation_runs(id) on delete cascade,
  artifact_type text not null,
  storage_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  generation_revision integer not null default 0 check (generation_revision >= 0),
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, artifact_type)
);

create index if not exists facade_generation_runs_queue_idx
  on public.facade_generation_runs(status, created_at);
create index if not exists facade_generation_runs_owner_idx
  on public.facade_generation_runs(owner_id, created_at desc);
create index if not exists facade_generation_artifacts_run_idx
  on public.facade_generation_artifacts(run_id, generation_revision);

alter table public.facade_generation_runs enable row level security;
alter table public.facade_generation_artifacts enable row level security;

drop policy if exists facade_generation_runs_read_own on public.facade_generation_runs;
create policy facade_generation_runs_read_own on public.facade_generation_runs
for select to authenticated using (
  owner_id = auth.uid() or public.current_profile_role() in ('teacher','admin')
);

drop policy if exists facade_generation_artifacts_read_own on public.facade_generation_artifacts;
create policy facade_generation_artifacts_read_own on public.facade_generation_artifacts
for select to authenticated using (exists (
  select 1 from public.facade_generation_runs run
  where run.id = run_id
    and (run.owner_id = auth.uid() or public.current_profile_role() in ('teacher','admin'))
));

revoke all on table public.facade_generation_runs from public, anon;
revoke all on table public.facade_generation_artifacts from public, anon;
revoke insert, update, delete on table public.facade_generation_runs from authenticated;
revoke insert, update, delete on table public.facade_generation_artifacts from authenticated;
grant select on table public.facade_generation_runs, public.facade_generation_artifacts to authenticated;

create or replace function public.submit_facade_run(
  p_course_id text,
  p_space_id text,
  p_object_code text,
  p_photo_id bigint
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_object_code text;
  v_object_type text;
  v_teaching_project_id uuid;
  v_village_id uuid;
  v_space_id text;
  v_photo_path text;
  v_photo_url text;
  v_context_prefix text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(btrim(p_course_id), '') is null
     or nullif(btrim(p_space_id), '') is null
     or nullif(btrim(p_object_code), '') is null
  then raise exception 'INVALID_FACADE_CONTEXT'; end if;

  select object_code, object_type, teaching_project_id, village_id, space_id,
         photo_path, photo_url
    into v_object_code, v_object_type, v_teaching_project_id, v_village_id, v_space_id,
         v_photo_path, v_photo_url
  from public.object_photos where id = p_photo_id;
  if not found then raise exception 'PHOTO_NOT_FOUND'; end if;
  if v_object_code <> p_object_code
     or v_object_type not in ('building', 'building__' || p_space_id)
  then raise exception 'PHOTO_BUILDING_MISMATCH'; end if;
  if v_teaching_project_id is null or v_village_id is null or v_space_id is null
     or v_space_id <> p_space_id
     or not public.context_space_accessible(v_teaching_project_id, v_village_id, v_space_id)
  then raise exception 'PHOTO_NOT_ACCESSIBLE'; end if;
  if not exists (
    select 1 from public.teaching_projects project
    where project.id = v_teaching_project_id and project.course_id = p_course_id
  ) then raise exception 'PHOTO_COURSE_MISMATCH'; end if;

  v_context_prefix := v_teaching_project_id::text || '/' || v_village_id::text || '/' || v_space_id || '/';
  if nullif(btrim(v_photo_path), '') is not null
     and v_photo_path like v_context_prefix || 'building/' ||
       regexp_replace(v_object_code, '[^a-zA-Z0-9_-]', '-', 'g') || '\_%' escape '\'
     and position('..' in v_photo_path) = 0
  then
    v_photo_url := null;
  elsif nullif(btrim(v_photo_url), '') is not null then
    -- Historical records are retained, but the worker independently restricts
    -- this URL to this project's public house-photos endpoint.
    v_photo_path := null;
  else
    raise exception 'PHOTO_LOCATOR_INVALID';
  end if;

  if (select count(*) from public.facade_generation_runs
      where owner_id = auth.uid()
        and status in ('queued_rectification','claimed_rectification','rectifying',
                       'awaiting_crop','queued_generation','claimed_generation',
                       'generating','cancel_requested')) >= 2
  then raise exception 'TOO_MANY_ACTIVE_FACADE_RUNS'; end if;

  insert into public.facade_generation_runs(
    owner_id, course_id, space_id, object_code, photo_id,
    source_photo_path, source_photo_url
  ) values (
    auth.uid(), p_course_id, p_space_id, p_object_code, p_photo_id,
    v_photo_path, v_photo_url
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.confirm_facade_crop(
  p_run_id uuid,
  p_crop_top double precision,
  p_roof_type text,
  p_building_width double precision,
  p_building_depth double precision
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_crop_top is null or p_crop_top < 0 or p_crop_top > 0.65
     or p_roof_type not in ('hip','gable','flat')
     or p_building_width is null or p_building_width <= 0 or p_building_width > 500
     or p_building_depth is null or p_building_depth <= 0 or p_building_depth > 500
  then raise exception 'INVALID_FACADE_PARAMETERS'; end if;

  update public.facade_generation_runs set
    crop_top = p_crop_top,
    roof_type = p_roof_type,
    building_width = p_building_width,
    building_depth = p_building_depth,
    generation_revision = generation_revision + 1,
    generation_attempt_count = 0,
    status = 'queued_generation',
    current_stage = 'queued_generation',
    progress = 55,
    worker_id = null,
    lease_expires_at = null,
    error_code = null,
    error_message = null,
    completed_at = null,
    updated_at = now()
  where id = p_run_id and owner_id = auth.uid()
    and status in ('awaiting_crop','completed');
  return found;
end;
$$;

create or replace function public.retry_failed_facade_run(p_run_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_can_generate boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select crop_top is not null and roof_type is not null
      and building_width is not null and building_depth is not null
      and exists(select 1 from public.facade_generation_artifacts artifact
                 where artifact.run_id=p_run_id and artifact.artifact_type='rectified_source')
      and exists(select 1 from public.facade_generation_artifacts artifact
                 where artifact.run_id=p_run_id and artifact.artifact_type='building_mask')
    into v_can_generate
  from public.facade_generation_runs
  where id=p_run_id and owner_id=auth.uid() and status='failed';
  if not found then return false; end if;

  update public.facade_generation_runs set
    status=case when v_can_generate then 'queued_generation' else 'queued_rectification' end,
    current_stage=case when v_can_generate then 'queued_generation' else 'queued_rectification' end,
    generation_attempt_count=case when v_can_generate then 0 else generation_attempt_count end,
    rectification_attempt_count=case when v_can_generate then rectification_attempt_count else 0 end,
    progress=case when v_can_generate then 55 else 0 end,
    worker_id=null, lease_expires_at=null, error_code=null, error_message=null,
    completed_at=null, updated_at=now()
  where id=p_run_id;
  return true;
end;
$$;

create or replace function public.claim_next_facade_run(p_worker_id text)
returns setof public.facade_generation_runs
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_status text;
begin
  if nullif(btrim(p_worker_id), '') is null then raise exception 'INVALID_WORKER_ID'; end if;

  update public.facade_generation_runs set
    status='failed', current_stage='failed', completed_at=now(), lease_expires_at=null,
    worker_id=null, error_code='RETRY_LIMIT_EXCEEDED',
    error_message='任务自动重试三次后仍未完成，请检查照片或联系管理员。', updated_at=now()
  where lease_expires_at < now()
    and (
      (status in ('claimed_rectification','rectifying') and rectification_attempt_count >= 3)
      or (status in ('claimed_generation','generating') and generation_attempt_count >= 3)
    );

  select id, status into v_id, v_status
  from public.facade_generation_runs
  where (
      status in ('queued_rectification','queued_generation')
      or (status in ('claimed_rectification','rectifying','claimed_generation','generating')
          and lease_expires_at < now())
    )
    and case
      when status in ('queued_rectification','claimed_rectification','rectifying')
        then rectification_attempt_count < 3
      else generation_attempt_count < 3
    end
  order by created_at
  for update skip locked
  limit 1;
  if v_id is null then return; end if;

  return query update public.facade_generation_runs set
    status = case
      when v_status in ('queued_rectification','claimed_rectification','rectifying')
        then 'claimed_rectification'
      else 'claimed_generation'
    end,
    current_stage = case
      when v_status in ('queued_rectification','claimed_rectification','rectifying')
        then 'claimed_rectification'
      else 'claimed_generation'
    end,
    worker_id = p_worker_id,
    lease_expires_at = now() + interval '90 seconds',
    attempt_count = attempt_count + 1,
    rectification_attempt_count = rectification_attempt_count +
      case when v_status in ('queued_rectification','claimed_rectification','rectifying') then 1 else 0 end,
    generation_attempt_count = generation_attempt_count +
      case when v_status in ('queued_generation','claimed_generation','generating') then 1 else 0 end,
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = v_id returning *;
end;
$$;

create or replace function public.retry_or_fail_facade_run(
  p_run_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text
) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_run public.facade_generation_runs%rowtype;
  v_next text;
begin
  select * into v_run from public.facade_generation_runs
  where id=p_run_id and worker_id=p_worker_id
    and lease_expires_at > now()
    and status in ('claimed_rectification','rectifying','claimed_generation','generating')
  for update;
  if not found then return 'lease_lost'; end if;

  if v_run.status in ('claimed_rectification','rectifying') then
    v_next := case when v_run.rectification_attempt_count < 3 then 'queued_rectification' else 'failed' end;
  else
    v_next := case when v_run.generation_attempt_count < 3 then 'queued_generation' else 'failed' end;
  end if;

  update public.facade_generation_runs set
    status=v_next,
    current_stage=case when v_next='failed' then 'failed' else 'retrying' end,
    worker_id=null,
    lease_expires_at=null,
    error_code=left(p_error_code,100),
    error_message=left(p_error_message,500),
    completed_at=case when v_next='failed' then now() else null end,
    updated_at=now()
  where id=p_run_id;
  return v_next;
end;
$$;

create or replace function public.renew_facade_run_lease(
  p_run_id uuid,
  p_worker_id text
) returns boolean
language sql security definer set search_path = public, pg_temp
as $$
  update public.facade_generation_runs
  set lease_expires_at = now() + interval '90 seconds', updated_at = now()
  where id = p_run_id and worker_id = p_worker_id
    and lease_expires_at > now()
    and status in ('claimed_rectification','rectifying','claimed_generation','generating')
  returning true;
$$;

create or replace function public.record_facade_artifact(
  p_run_id uuid,
  p_worker_id text,
  p_artifact_type text,
  p_storage_path text,
  p_content_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_generation_revision integer,
  p_source jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from public.facade_generation_runs
  where id = p_run_id and worker_id = p_worker_id
    and lease_expires_at > now()
    and status in ('claimed_rectification','rectifying','claimed_generation','generating');
  if not found then return false; end if;
  if p_artifact_type not in ('rectified_preview','rectified_source','building_mask','diagnostics','building_glb')
     or p_storage_path not like v_owner_id::text || '/' || p_run_id::text || '/%'
     or nullif(btrim(p_content_type), '') is null
     or p_size_bytes < 0
     or p_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'INVALID_FACADE_ARTIFACT'; end if;

  insert into public.facade_generation_artifacts(
    run_id, artifact_type, storage_path, content_type, size_bytes, sha256,
    generation_revision, source
  ) values (
    p_run_id, p_artifact_type, p_storage_path, p_content_type, p_size_bytes, p_sha256,
    p_generation_revision, coalesce(p_source, '{}'::jsonb)
  ) on conflict(run_id, artifact_type) do update set
    storage_path = excluded.storage_path,
    content_type = excluded.content_type,
    size_bytes = excluded.size_bytes,
    sha256 = excluded.sha256,
    generation_revision = excluded.generation_revision,
    source = excluded.source,
    created_at = now();
  return true;
end;
$$;

create or replace function public.publish_facade_rectification(
  p_run_id uuid,
  p_worker_id text,
  p_artifacts jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_artifact jsonb;
  v_types text[] := '{}'::text[];
begin
  select owner_id into v_owner_id from public.facade_generation_runs
  where id = p_run_id and worker_id = p_worker_id
    and lease_expires_at > now()
    and status in ('claimed_rectification','rectifying') for update;
  if not found then return false; end if;
  if jsonb_typeof(p_artifacts) <> 'array' then raise exception 'INVALID_RECTIFICATION_ARTIFACTS'; end if;

  for v_artifact in select value from jsonb_array_elements(p_artifacts)
  loop
    if v_artifact->>'artifact_type' not in ('rectified_preview','rectified_source','building_mask','diagnostics')
       or v_artifact->>'storage_path' not like v_owner_id::text || '/' || p_run_id::text || '/%'
       or coalesce((v_artifact->>'size_bytes')::bigint, -1) < 0
       or coalesce(v_artifact->>'sha256','') !~ '^[0-9a-f]{64}$'
    then raise exception 'INVALID_RECTIFICATION_ARTIFACTS'; end if;
    v_types := array_append(v_types, v_artifact->>'artifact_type');
    insert into public.facade_generation_artifacts(
      run_id, artifact_type, storage_path, content_type, size_bytes, sha256,
      generation_revision, source
    ) values (
      p_run_id, v_artifact->>'artifact_type', v_artifact->>'storage_path',
      v_artifact->>'content_type', (v_artifact->>'size_bytes')::bigint,
      v_artifact->>'sha256', 0, coalesce(v_artifact->'source','{}'::jsonb)
    ) on conflict(run_id, artifact_type) do update set
      storage_path=excluded.storage_path, content_type=excluded.content_type,
      size_bytes=excluded.size_bytes, sha256=excluded.sha256,
      generation_revision=0, source=excluded.source, created_at=now();
  end loop;
  if not array['rectified_preview','rectified_source','building_mask']::text[] <@ v_types
  then raise exception 'RECTIFICATION_ARTIFACTS_INCOMPLETE'; end if;

  update public.facade_generation_runs set
    status='awaiting_crop', current_stage='awaiting_crop', progress=50,
    worker_id=null, lease_expires_at=null, updated_at=now()
  where id=p_run_id;
  return true;
end;
$$;

create or replace function public.publish_facade_generation(
  p_run_id uuid,
  p_worker_id text,
  p_storage_path text,
  p_content_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_generation_revision integer,
  p_source jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_run public.facade_generation_runs%rowtype;
begin
  select * into v_run from public.facade_generation_runs
  where id=p_run_id and worker_id=p_worker_id and lease_expires_at > now()
    and status='generating' for update;
  if not found then return false; end if;
  if p_generation_revision <> v_run.generation_revision
     or p_storage_path not like v_run.owner_id::text || '/' || p_run_id::text || '/generation-r' || p_generation_revision::text || '/%'
     or p_content_type <> 'model/gltf-binary'
     or p_size_bytes <= 0
     or p_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'INVALID_GENERATION_ARTIFACT'; end if;

  insert into public.facade_generation_artifacts(
    run_id, artifact_type, storage_path, content_type, size_bytes, sha256,
    generation_revision, source
  ) values (
    p_run_id, 'building_glb', p_storage_path, p_content_type, p_size_bytes, p_sha256,
    p_generation_revision, coalesce(p_source,'{}'::jsonb)
  ) on conflict(run_id, artifact_type) do update set
    storage_path=excluded.storage_path, content_type=excluded.content_type,
    size_bytes=excluded.size_bytes, sha256=excluded.sha256,
    generation_revision=excluded.generation_revision, source=excluded.source,
    created_at=now();

  update public.facade_generation_runs set
    status='completed', current_stage='completed', progress=100,
    lease_expires_at=null, completed_at=now(), updated_at=now()
  where id=p_run_id;
  return true;
end;
$$;

create or replace function public.set_facade_run_state(
  p_run_id uuid,
  p_worker_id text,
  p_status text,
  p_stage text default null,
  p_progress smallint default null,
  p_error_code text default null,
  p_error_message text default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_status not in ('rectifying','generating','completed','failed','canceled')
  then raise exception 'INVALID_STATUS'; end if;
  if p_status = 'rectifying' and not exists (
      select 1 from public.facade_generation_runs where id=p_run_id and worker_id=p_worker_id
        and lease_expires_at > now()
        and status='claimed_rectification')
  then return false; end if;
  if p_status = 'generating' and not exists (
      select 1 from public.facade_generation_runs where id=p_run_id and worker_id=p_worker_id
        and lease_expires_at > now()
        and status='claimed_generation')
  then return false; end if;

  update public.facade_generation_runs set
    status=p_status,
    current_stage=coalesce(p_stage,p_status),
    progress=coalesce(p_progress,progress),
    error_code=case when p_status='failed' then p_error_code else error_code end,
    error_message=case when p_status='failed' then left(p_error_message,500) else error_message end,
    completed_at=case when p_status in ('completed','failed','canceled') then now() else completed_at end,
    lease_expires_at=case when p_status in ('completed','failed','canceled') then null else lease_expires_at end,
    updated_at=now()
  where id=p_run_id and worker_id=p_worker_id
    and lease_expires_at > now()
    and (
      (p_status='rectifying' and status='claimed_rectification')
      or (p_status='generating' and status='claimed_generation')
      or (p_status in ('completed','failed','canceled')
          and status in ('claimed_rectification','rectifying','claimed_generation','generating','cancel_requested'))
    );
  return found;
end;
$$;

create or replace function public.request_facade_cancel(p_run_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.facade_generation_runs set
    status=case
      when status in ('queued_rectification','awaiting_crop','queued_generation') then 'canceled'
      else 'cancel_requested'
    end,
    completed_at=case
      when status in ('queued_rectification','awaiting_crop','queued_generation') then now()
      else completed_at
    end,
    lease_expires_at=case
      when status in ('queued_rectification','awaiting_crop','queued_generation') then null
      else lease_expires_at
    end,
    updated_at=now()
  where id=p_run_id and owner_id=auth.uid()
    and status in ('queued_rectification','claimed_rectification','rectifying','awaiting_crop',
                   'queued_generation','claimed_generation','generating');
  return found;
end;
$$;

revoke all on function public.submit_facade_run(text,text,text,bigint) from public, anon;
grant execute on function public.submit_facade_run(text,text,text,bigint) to authenticated;
revoke all on function public.confirm_facade_crop(uuid,double precision,text,double precision,double precision) from public, anon;
grant execute on function public.confirm_facade_crop(uuid,double precision,text,double precision,double precision) to authenticated;
revoke all on function public.retry_failed_facade_run(uuid) from public, anon;
grant execute on function public.retry_failed_facade_run(uuid) to authenticated;
revoke all on function public.request_facade_cancel(uuid) from public, anon;
grant execute on function public.request_facade_cancel(uuid) to authenticated;

revoke all on function public.claim_next_facade_run(text) from public, anon, authenticated;
grant execute on function public.claim_next_facade_run(text) to service_role;
revoke all on function public.renew_facade_run_lease(uuid,text) from public, anon, authenticated;
grant execute on function public.renew_facade_run_lease(uuid,text) to service_role;
revoke all on function public.retry_or_fail_facade_run(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.retry_or_fail_facade_run(uuid,text,text,text) to service_role;
revoke all on function public.record_facade_artifact(uuid,text,text,text,text,bigint,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.record_facade_artifact(uuid,text,text,text,text,bigint,text,integer,jsonb) to service_role;
revoke all on function public.publish_facade_rectification(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.publish_facade_rectification(uuid,text,jsonb) to service_role;
revoke all on function public.publish_facade_generation(uuid,text,text,text,bigint,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.publish_facade_generation(uuid,text,text,text,bigint,text,integer,jsonb) to service_role;
revoke all on function public.set_facade_run_state(uuid,text,text,text,smallint,text,text) from public, anon, authenticated;
grant execute on function public.set_facade_run_state(uuid,text,text,text,smallint,text,text) to service_role;

insert into storage.buckets(id,name,public)
values('facade-generation','facade-generation',false)
on conflict(id) do update set public=false;

update storage.buckets set
  file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png']::text[]
where id='house-photos';

drop policy if exists facade_generation_read_own on storage.objects;
create policy facade_generation_read_own on storage.objects
for select to authenticated using (
  bucket_id='facade-generation'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or (
      public.current_profile_role() in ('teacher','admin')
      and exists (
        select 1 from public.facade_generation_artifacts artifact
        join public.facade_generation_runs run on run.id=artifact.run_id
        where artifact.storage_path=storage.objects.name
      )
    )
  )
);

create or replace function public.get_facade_worker_availability()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'available', coalesce(max(last_seen_at) > now() - interval '2 minutes', false),
    'last_seen_at', max(last_seen_at)
  )
  from public.worker_heartbeats
  where version like 'facade-%';
$$;
revoke all on function public.get_facade_worker_availability() from public, anon;
grant execute on function public.get_facade_worker_availability() to authenticated;

drop policy if exists facade_generation_service_write on storage.objects;
create policy facade_generation_service_write on storage.objects
for all to service_role using (bucket_id='facade-generation')
with check (bucket_id='facade-generation');

do $$ begin
  alter publication supabase_realtime add table public.facade_generation_runs;
exception when duplicate_object then null;
end $$;
