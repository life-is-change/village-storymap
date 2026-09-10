const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sql = fs.readFileSync("supabase_SQL/Facade Generation Worker Queue.sql", "utf8");

test("facade queue separates the manual crop pause from claimable states", () => {
  assert.match(sql, /queued_rectification/);
  assert.match(sql, /awaiting_crop/);
  assert.match(sql, /queued_generation/);
  assert.match(sql, /for\s+update\s+skip\s+locked/i);
  assert.match(sql, /status\s+in\s*\(\s*'queued_rectification'\s*,\s*'queued_generation'/i);
});

test("student RPC trusts photo id and worker RPCs require service_role", () => {
  assert.match(sql, /submit_facade_run\([\s\S]*p_photo_id\s+bigint/i);
  assert.match(sql, /object_photos/i);
  assert.doesNotMatch(sql, /submit_facade_run\([\s\S]*p_photo_url/i);
  assert.match(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.claim_next_facade_run\(text\)\s+to\s+service_role/i,
  );
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.claim_next_facade_run\(text\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  );
  assert.match(sql, /v_space_id\s*<>\s*p_space_id/i);
});

test("private facade artifacts are owner scoped", () => {
  assert.match(
    sql,
    /insert\s+into\s+storage\.buckets[\s\S]*'facade-generation'\s*,\s*'facade-generation'\s*,\s*false/i,
  );
  assert.match(sql, /storage\.foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/i);
  assert.match(
    sql,
    /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.facade_generation_runs/i,
  );
});

test("completed facade generation publishes the browser building_glb contract", () => {
  assert.match(sql, /p_run_id,\s*'building_glb',\s*p_storage_path/i);
  assert.match(sql, /p_artifact_type\s+not\s+in\s*\([^)]*'building_glb'/i);
  assert.doesNotMatch(sql, /p_run_id,\s*'glb',\s*p_storage_path/i);
});
