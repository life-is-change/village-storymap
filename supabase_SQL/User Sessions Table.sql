-- ============================================
-- 用户会话表：用于限制同一账号多处同时登录
-- 登录时写入当前 session_token，其他设备可实时感知并被踢下线
-- ============================================

create table if not exists public.user_sessions (
  user_name text primary key,
  session_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- 启用 RLS
alter table public.user_sessions enable row level security;

-- 允许所有用户读写（本项目使用匿名 public 访问）
create policy "allow all user_sessions"
  on public.user_sessions
  for all
  to public
  using (true)
  with check (true);
