const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "..",
  "supabase_SQL",
  "Shared Survey Calibration Security Followup.sql"
);

test("internal survey trigger functions are not directly executable through the API", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(sql, /^begin;/i);
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.append_community_task_version\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i
  );
  assert.match(sql, /commit;\s*$/i);
});
