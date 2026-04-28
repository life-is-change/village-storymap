-- ============================================
-- Realtime 实时同步配置
-- 将需要实时推送变更的表加入 supabase_realtime publication
-- 执行后，前端可通过 Supabase Realtime 订阅这些表的变更事件
-- ============================================

do $$
declare
  tbl text;
  tables text[] := array[
    'planning_features',
    'planning_spaces',
    'community_tasks',
    'object_attribute_edits',
    'user_sessions',
    'auth_users'
  ];
begin
  foreach tbl in array tables loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception when duplicate_object then
      raise notice 'Table % already in publication, skipping.', tbl;
    end;
  end loop;
end $$;
