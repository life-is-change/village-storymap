-- 1) 村庄与 MC 的坐标映射配置
create table if not exists public.mc_sync_config (
  id bigint generated always as identity primary key,
  village_id text not null unique,
  crs text not null default 'EPSG:4326',
  min_lon double precision not null,
  min_lat double precision not null,
  max_lon double precision not null,
  max_lat double precision not null,
  mc_origin_x integer not null,
  mc_origin_y integer not null default 64,
  mc_origin_z integer not null,
  mc_width integer not null,
  mc_depth integer not null,
  rotation_deg double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) 每栋建筑映射到 MC 后的状态
create table if not exists public.mc_building_state (
  id bigint generated always as identity primary key,
  village_id text not null,
  space_id text not null,
  object_code text not null,
  object_name text,
  source text not null default 'web',
  footprint_blocks jsonb not null default '[]'::jsonb,
  bbox jsonb,
  base_y integer not null default 64,
  height_blocks integer not null default 4,
  block_type text not null default 'minecraft:white_concrete',
  geom jsonb,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (village_id, space_id, object_code)
);

create index if not exists idx_mc_building_state_village_space
on public.mc_building_state (village_id, space_id);

create index if not exists idx_mc_building_state_object_code
on public.mc_building_state (object_code);

-- 更新时间自动刷新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mc_sync_config_updated_at on public.mc_sync_config;
create trigger trg_mc_sync_config_updated_at
before update on public.mc_sync_config
for each row execute function public.set_updated_at();

drop trigger if exists trg_mc_building_state_updated_at on public.mc_building_state;
create trigger trg_mc_building_state_updated_at
before update on public.mc_building_state
for each row execute function public.set_updated_at();