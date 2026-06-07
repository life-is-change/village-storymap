create extension if not exists pgcrypto;

create table if not exists public.planning_features (
  id uuid primary key default gen_random_uuid(),
  space_id text not null,
  layer_key text not null,
  object_code text not null,
  object_name text,
  geom jsonb not null,
  props jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists planning_features_space_layer_code_uidx
on public.planning_features(space_id, layer_key, object_code);

create index if not exists planning_features_space_layer_idx
on public.planning_features(space_id, layer_key);

create or replace function public.set_updated_at_planning_features()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_planning_features on public.planning_features;

create trigger trg_set_updated_at_planning_features
before update on public.planning_features
for each row
execute function public.set_updated_at_planning_features();

alter table public.planning_features enable row level security;

drop policy if exists "planning_features_read" on public.planning_features;
create policy "planning_features_read"
on public.planning_features
for select
to anon, authenticated
using (true);

drop policy if exists "planning_features_insert" on public.planning_features;
create policy "planning_features_insert"
on public.planning_features
for insert
to anon, authenticated
with check (true);

drop policy if exists "planning_features_update" on public.planning_features;
create policy "planning_features_update"
on public.planning_features
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "planning_features_delete" on public.planning_features;
create policy "planning_features_delete"
on public.planning_features
for delete
to anon, authenticated
using (true);