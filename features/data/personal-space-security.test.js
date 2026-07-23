const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sqlPath = path.join(__dirname, "..", "..", "supabase_SQL", "Personal Figure Ground Spaces and Layer Versions.sql");
const contourDeleteSqlPath = path.join(__dirname, "..", "..", "supabase_SQL", "Enable Personal Contour Delete.sql");

test("personal spaces are unique per owner course village and protected by RLS", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /unique\s*\(owner_id,\s*course_id,\s*village_id,\s*space_type\)/i);
  assert.match(sql, /owner_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /\(select public\.current_profile_role\(\)\)\s+in\s*\('teacher','admin'\)/i);
  assert.match(sql, /alter table public\.course_personal_spaces enable row level security/i);
  assert.match(sql, /alter table public\.personal_layer_features enable row level security/i);
  assert.match(sql, /s\.id\s*=\s*public\.personal_layer_features\.space_id/i);
  assert.match(sql, /v\.id\s*=\s*public\.personal_layer_features\.layer_version_id/i);
});

test("incremental contour migration permits delete only and keeps other contour edits forbidden", () => {
  const sql = fs.readFileSync(contourDeleteSqlPath, "utf8");
  assert.match(sql, /v_layer_key\s*=\s*'contours'\s+and\s+v_action\s*<>\s*'delete'/i);
  assert.match(sql, /raise exception 'INVALID_CHANGE'/i);
  assert.match(sql, /v\.editable\s+or\s+\(v_layer_key='contours'\s+and\s+v_action='delete'\)/i);
  assert.match(sql, /grant execute on function public\.save_personal_feature_edit_batch\(uuid,jsonb\) to authenticated/i);
});

test("result import is authenticated transactional and validates owned completed runs", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /create or replace function public\.import_geoprocessing_result\s*\(\s*p_run_id uuid,\s*p_layers jsonb/i);
  assert.match(sql, /r\.owner_id\s*=\s*v_user_id/i);
  assert.match(sql, /r\.status\s*=\s*'completed'/i);
  assert.match(sql, /from public\.geoprocessing_artifacts/i);
  assert.match(sql, /unique\s*\(space_id,\s*source_run_id\)/i);
  assert.doesNotMatch(sql, /grant execute[^;]+import_geoprocessing_result[^;]+to anon/i);
  assert.match(sql, /grant execute on function public\.import_geoprocessing_result\(uuid,jsonb\) to authenticated/i);
});

test("version switching and deletion remain owner-only secure RPCs", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /create or replace function public\.set_personal_layer_version/i);
  assert.match(sql, /create or replace function public\.delete_personal_layer_version/i);
  assert.match(sql, /CURRENT_VERSION_DELETE_FORBIDDEN/);
  assert.match(sql, /grant execute on function public\.set_personal_layer_version\(uuid,text,uuid\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.delete_personal_layer_version\(uuid\) to authenticated/i);
  assert.match(sql, /create or replace function public\.save_personal_feature_edit_batch/i);
  assert.equal((sql.match(/security definer set search_path\s*=\s*''/gi) || []).length, 5);
  assert.equal((sql.match(/if auth\.uid\(\) is null then raise exception 'AUTH_REQUIRED'/gi) || []).length, 5);
  assert.equal((sql.match(/from public\s*,\s*anon\s*,\s*authenticated/gi) || []).length, 5);
});
