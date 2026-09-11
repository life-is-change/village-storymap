-- Secure cloud-provider facade jobs. API credentials remain in Edge Function secrets.
create table if not exists public.cloud_facade_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  space_id text not null,
  object_code text not null,
  photo_id bigint not null references public.object_photos(id) on delete restrict,
  provider text not null default 'dashscope',
  model text not null,
  provider_job_id text,
  status text not null default 'submitting' check (status in ('submitting','queued','running','succeeded','failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  result_storage_path text,
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  estimated_cost_cny numeric(8,4) not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cloud_facade_runs_owner_idx
  on public.cloud_facade_runs(owner_id, created_at desc);

alter table public.cloud_facade_runs enable row level security;
drop policy if exists cloud_facade_runs_read_own on public.cloud_facade_runs;
create policy cloud_facade_runs_read_own on public.cloud_facade_runs
  for select to authenticated using (owner_id = auth.uid());

revoke all on public.cloud_facade_runs from public, anon;
revoke insert, update, delete on public.cloud_facade_runs from authenticated;
grant select on public.cloud_facade_runs to authenticated;

insert into storage.buckets(id, name, public)
values ('facade-generation', 'facade-generation', false)
on conflict (id) do nothing;
