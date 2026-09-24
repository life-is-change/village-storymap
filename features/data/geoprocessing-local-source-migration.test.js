const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = path.join(__dirname, "../../supabase_SQL/Geoprocessing Local Source Inputs.sql");

test("local source migration removes uploaded dataset from student input contract", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /create table if not exists public\.geoprocessing_source_status/i);
  assert.match(sql, /checked_at\s*<\s*now\(\)\s*-\s*interval '2 minutes'/i);
  assert.match(sql, /revoke all on function public\.submit_geoprocessing_run\(text,text,text\[\],jsonb,jsonb\) from public, anon, authenticated/i);
  assert.match(sql, /dataset_id\s*,\s*input_manifest[\s\S]*?null\s*,\s*null/i);
  assert.doesNotMatch(sql, /raise exception 'WORKER_MANIFEST_REQUIRED'/i);
  assert.doesNotMatch(sql, /raise exception 'DATASET_REQUIRED'/i);
});

test("local source status writes are worker-only and project access remains checked", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /revoke all on function public\.upsert_geoprocessing_source_status[^;]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.upsert_geoprocessing_source_status[^;]+to service_role/i);
  assert.match(sql, /project\.id\s*=\s*p_teaching_project_id\s+and\s+project\.course_id\s*=\s*p_course_id/i);
  assert.match(sql, /public\.group_memberships/i);
  assert.match(sql, /AOI_OUTSIDE_SOURCE/i);
});
