const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(__dirname, "..", "..", "supabase_SQL", "Secure Planning Space Visibility.sql");

test("planning spaces are restricted to staff or the signed-in student's group", () => {
  assert.equal(fs.existsSync(migrationPath), true, "security migration must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /drop policy if exists "Allow all" on public\.planning_spaces/i);
  assert.match(sql, /public\.current_profile_role\(\) in \('teacher',\s*'admin'\)/i);
  assert.match(sql, /public\.current_profile_student_key\(\)/i);
  assert.match(sql, /group_id\s*=\s*public\.planning_spaces\.group_id/i);
  assert.doesNotMatch(sql, /planning_spaces[\s\S]*?using\s*\(true\)/i);
  assert.match(sql, /revoke all on table public\.planning_spaces from anon/i);
});
