const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = path.join(__dirname, "../../supabase_SQL/Geoprocessing Practice Village Catalog Fix.sql");

test("contextual submission admits published practice villages in the active course without opening formal villages", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /project\.id\s*=\s*p_teaching_project_id\s+and\s+project\.course_id\s*=\s*p_course_id/i);
  assert.match(sql, /v_village\.is_practice\s+and\s+v_village\.status\s*=\s*'published'/i);
  assert.match(sql, /project\.formal_project_open\s+and\s+project\.formal_village_id\s*=\s*v_village\.id/i);
  assert.match(sql, /PROJECT_ACCESS_REQUIRED/i);
  assert.match(sql, /public\.group_memberships/i);
});

test("worker availability is offline without a fresh heartbeat", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /last_seen_at\s+>=\s*now\(\)\s*-\s*interval\s*'2 minutes'/i);
  assert.match(sql, /coalesce\([\s\S]*?'offline'/i);
});
