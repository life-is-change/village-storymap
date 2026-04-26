-- Community gamification tables for village-storymap
-- Run in Supabase SQL Editor.

create table if not exists public.community_tasks (
  id bigserial primary key,
  space_id text not null,
  category text not null default 'garbage',
  description text not null default '',
  status text not null default 'pending',
  reporter_name text not null,
  verifier_name text,
  verify_count integer not null default 0,
  lng double precision,
  lat double precision,
  geom jsonb,
  settled_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_verifications (
  id bigserial primary key,
  task_id bigint not null references public.community_tasks(id) on delete cascade,
  verifier_name text not null,
  result text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists uq_task_verifications_task_user
  on public.task_verifications(task_id, verifier_name);

create table if not exists public.points_ledger (
  id bigserial primary key,
  user_name text not null,
  task_id bigint references public.community_tasks(id) on delete set null,
  space_id text,
  delta integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_stats (
  user_name text primary key,
  total_points integer not null default 0,
  reports_count integer not null default 0,
  verify_count integer not null default 0,
  level integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Optional: simple updated_at trigger for community_tasks
create or replace function public.set_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_community_tasks_updated_at on public.community_tasks;
create trigger trg_community_tasks_updated_at
before update on public.community_tasks
for each row execute function public.set_timestamp_updated_at();

-- RLS (basic permissive demo policy). Adjust for production.
alter table public.community_tasks enable row level security;
alter table public.task_verifications enable row level security;
alter table public.points_ledger enable row level security;
alter table public.user_stats enable row level security;

drop policy if exists "community_tasks_all" on public.community_tasks;
create policy "community_tasks_all" on public.community_tasks
for all using (true) with check (true);

drop policy if exists "task_verifications_all" on public.task_verifications;
create policy "task_verifications_all" on public.task_verifications
for all using (true) with check (true);

drop policy if exists "points_ledger_all" on public.points_ledger;
create policy "points_ledger_all" on public.points_ledger
for all using (true) with check (true);

drop policy if exists "user_stats_all" on public.user_stats;
create policy "user_stats_all" on public.user_stats
for all using (true) with check (true);

