-- ============================================
-- 集中式用户表：解决后台账号管理只能看到本地账号的问题
-- 所有注册/登录操作都会同步到此表，admin.js 从该表读取全部用户
-- ============================================

create table if not exists public.auth_users (
  name text not null,
  student_id text not null,
  gender text,
  class_name text,
  grade text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (name, student_id)
);

-- 启用 RLS
alter table public.auth_users enable row level security;

-- 允许所有用户读写（本项目使用匿名 public 访问）
create policy "allow all auth_users"
  on public.auth_users
  for all
  to public
  using (true)
  with check (true);
