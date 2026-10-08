const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sqlPath = path.join(__dirname, "..", "..", "supabase_SQL", "Multi-Village Dual-Track Foundation.sql");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";

test("多村庄迁移定义规范表和完整上下文列", () => {
  for (const table of ["villages", "village_datasets", "teaching_projects", "village_reality_models"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"));
  }
  for (const column of ["teaching_project_id", "village_id", "space_id"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"));
  }
});

test("新规范表全部启用RLS", () => {
  for (const table of ["villages", "village_datasets", "teaching_projects", "village_reality_models"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
});

test("正式村庄绑定由数据库强制唯一和锁定", () => {
  assert.match(sql, /create or replace function public\.bind_formal_village/i);
  assert.match(sql, /FORMAL_VILLAGE_LOCKED/);
  assert.match(sql, /PUBLISHED_DATASET_REQUIRED/);
  assert.match(sql, /pg_advisory_xact_lock|for update/i);
});

test("个人体验与共享现状的写入链在数据库中隔离", () => {
  assert.match(sql, /PERSONAL_SPACE_CONTEXT_MISMATCH/);
  assert.match(sql, /SHARED_SPACE_RPC_REQUIRED/);
  assert.match(sql, /practice_personal/);
  assert.match(sql, /practice_shared/);
  assert.match(sql, /formal_personal/);
  assert.match(sql, /formal_shared/);
  assert.match(sql, /group_plan/);
});

test("每个特权RPC固定search_path并撤销公共执行权", () => {
  for (const functionName of [
    "create_village_draft",
    "create_teaching_project",
    "save_village_dataset_draft",
    "publish_village_dataset",
    "bind_formal_village",
    "ensure_context_space",
    "ensure_project_practice_space",
    "save_village_reality_model_draft",
    "publish_village_reality_model",
    "get_active_project_context"
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${functionName}`, "i"));
    assert.match(sql, new RegExp(`alter function public\\.${functionName}[\\s\\S]*set search_path`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}`, "i"));
  }
});

test("米埗村共享现状按教学项目创建且不创建练习小组空间", () => {
  assert.match(sql, /ensure_project_practice_space/i);
  assert.match(sql, /practice_shared/i);
  assert.doesNotMatch(sql, /['"]mibu['"][\s\S]{0,300}['"]group_plan['"]/i);
});
