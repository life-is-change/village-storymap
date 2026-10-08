const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sql = fs.readFileSync("supabase_SQL/Geoprocessing Worker Queue.sql", "utf8");

test("claim and lease RPCs are service-role only", () => {
  assert.match(sql, /FOR\s+UPDATE\s+SKIP\s+LOCKED/i);
  assert.match(sql, /grant\s+execute[\s\S]+claim_next_geoprocessing_run[\s\S]+to\s+service_role/i);
  assert.doesNotMatch(sql, /grant\s+execute[^;]+claim_next_geoprocessing_run[^;]+to\s+authenticated/i);
  assert.doesNotMatch(sql, /grant\s+execute[^;]+renew_geoprocessing_lease[^;]+to\s+authenticated/i);
});

test("students can read only owned runs and cannot write worker fields", () => {
  assert.match(sql, /owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /revoke\s+update[\s\S]+geoprocessing_runs[\s\S]+from\s+authenticated/i);
});

test("result storage is private and owner-prefixed", () => {
  assert.match(sql, /'geoprocessing-results'\s*,\s*'geoprocessing-results'\s*,\s*false/i);
  assert.match(sql, /storage\.foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/i);
});
