const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "..", "..", "supabase_SQL", "Multi-Village Dual-Track Foundation.sql"), "utf8");

test("迁移脚本固定创建一个米埗村和一个活动项目且使用冲突保护", () => {
  assert.match(sql, /米埗村/);
  assert.match(sql, /is_practice[\s\S]*true/i);
  assert.match(sql, /on conflict/i);
  assert.match(sql, /practice_shared/i);
  assert.doesNotMatch(sql, /mibu[\s\S]*group_plan/i);
});

test("每个新教学项目都会创建自己的米埗村共享现状空间", () => {
  assert.match(sql, /ensure_project_practice_space/i);
  assert.match(sql, /teaching_project_id[\s\S]*practice_shared/i);
  assert.match(sql, /where[\s\S]*teaching_project_id is null/i);
});
