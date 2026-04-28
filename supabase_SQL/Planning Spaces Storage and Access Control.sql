create table if not exists public.planning_spaces (
  id text primary key,
  title text not null,
  creator_name text,
  created_at timestamptz,
  readonly boolean default false,
  edit_enabled boolean default true,
  expanded boolean default true,
  selected_layers jsonb default '["building"]'::jsonb,
  basemap_visible boolean default false,
  view_mode text default '2d'
);

-- 启用 RLS（可选，建议加上基础权限）
alter table public.planning_spaces enable row level security;

-- 允许所有用户读取和写入（如果你后续要做权限控制，可以改成按 creator_name 过滤）
create policy "Allow all" on public.planning_spaces
  for all using (true) with check (true);