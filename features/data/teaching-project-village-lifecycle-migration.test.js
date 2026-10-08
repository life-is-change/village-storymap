const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sqlPath = path.join(
  __dirname,
  "..",
  "..",
  "supabase_SQL",
  "Teaching Project Practice Catalog and Village Lifecycle.sql"
);
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";

test("同一课程允许多个学期项目但仍只有一个当前项目", () => {
  assert.match(sql, /drop constraint if exists teaching_projects_course_id_key/i);
  assert.match(sql, /create index if not exists teaching_projects_course_id_idx/i);
  assert.match(sql, /teaching_projects_one_current_idx/i);
  assert.match(sql, /ACTIVE_PROJECT_ALREADY_EXISTS/i);
});

test("当前上下文包含全部已发布练习村和当前正式村", () => {
  assert.match(sql, /create or replace function public\.get_active_project_context/i);
  assert.match(sql, /village\.is_practice[\s\S]*village\.status\s*=\s*'published'/i);
  assert.match(sql, /project\.formal_village_id/i);
  assert.match(sql, /ensure_all_project_practice_spaces/i);
});

test("任意已发布练习村均可进入项目空间且不同项目仍隔离", () => {
  assert.match(sql, /create or replace function public\.ensure_context_space/i);
  assert.match(sql, /from public\.villages where id = p_village_id and status = 'published'/i);
  assert.match(sql, /if v_village\.is_practice then/i);
  assert.match(sql, /teaching_project_id[\s\S]*village_id[\s\S]*practice_shared/i);
});

test("村庄生命周期RPC受管理员权限和二次使用检查保护", () => {
  for (const name of [
    "get_village_removal_preview",
    "archive_village",
    "restore_village",
    "delete_unused_village"
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}`, "i"));
  }
  assert.match(sql, /SYSTEM_VILLAGE_PROTECTED/i);
  assert.match(sql, /ACTIVE_FORMAL_VILLAGE_REQUIRED/i);
  assert.match(sql, /VILLAGE_IN_USE/i);
});

test("永久删除仅清理管理员准备数据且不会级联删除教学成果", () => {
  assert.match(sql, /delete from public\.village_reality_models/i);
  assert.match(sql, /delete from public\.village_datasets/i);
  assert.match(sql, /delete from public\.villages/i);
  assert.doesNotMatch(sql, /delete from public\.(planning_features|object_photos|object_comments|activity_events)/i);
  assert.match(sql, /storage_paths/i);
});

test("迁移可重复执行并固定函数search_path", () => {
  assert.match(sql, /^\s*begin\s*;/i);
  assert.match(sql, /commit\s*;\s*$/i);
  assert.doesNotMatch(sql, /create table public\./i);
  for (const name of [
    "ensure_all_project_practice_spaces",
    "archive_teaching_project",
    "get_village_removal_preview",
    "archive_village",
    "restore_village",
    "delete_unused_village"
  ]) {
    assert.match(sql, new RegExp(`alter function public\\.${name}[\\s\\S]*set search_path`, "i"));
  }
});
