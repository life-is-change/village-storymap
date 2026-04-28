-- 1. 社区留言/任务表
CREATE TABLE IF NOT EXISTS community_tasks (
  id BIGSERIAL PRIMARY KEY,
  space_id TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  category TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  lng DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  geom JSONB,
  verify_count INTEGER NOT NULL DEFAULT 0,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 对象照片表（如果已有可跳过）
CREATE TABLE IF NOT EXISTS object_photos (
  id BIGSERIAL PRIMARY KEY,
  object_code TEXT NOT NULL,
  object_type TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 对象属性编辑表（用于追评、点赞，如果已有可跳过）
CREATE TABLE IF NOT EXISTS object_attribute_edits (
  id BIGSERIAL PRIMARY KEY,
  object_code TEXT NOT NULL,
  object_type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(object_code, object_type)
);

-- 4. 积分账本表
CREATE TABLE IF NOT EXISTS points_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_name TEXT NOT NULL,
  task_id BIGINT,
  space_id TEXT,
  delta INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. 用户统计表
CREATE TABLE IF NOT EXISTS user_stats (
  user_name TEXT PRIMARY KEY,
  total_points INTEGER NOT NULL DEFAULT 0,
  reports_count INTEGER NOT NULL DEFAULT 0,
  verify_count INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);