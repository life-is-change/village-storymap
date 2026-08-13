const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, '..', '..', 'supabase_SQL', 'Group Model Library.sql');

function readSql() {
  return fs.readFileSync(sqlPath, 'utf8').toLowerCase();
}

test('model library migration creates separated assets, bindings and immutable audit tables', () => {
  const sql = readSql();
  for (const table of ['group_model_assets', 'building_model_bindings', 'model_operation_events']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /model_operation_events_no_update/);
  assert.match(sql, /model_operation_events_no_delete/);
});

test('model library migration exposes atomic register, place, restore and guarded delete functions', () => {
  const sql = readSql();
  for (const fn of ['register_group_model', 'place_group_model', 'restore_building_white_model', 'delete_group_model']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}`));
  }
  assert.match(sql, /model_in_use:/);
  assert.match(sql, /for update/);
});

test('model storage is private, GLB-only and capped at 50 MB', () => {
  const sql = readSql();
  assert.match(sql, /'group-models'/);
  assert.match(sql, /public\s*=\s*false/);
  assert.match(sql, /file_size_limit\s*=\s*52428800/);
  assert.match(sql, /model\/gltf-binary/);
  assert.match(sql, /application\/octet-stream/);
  assert.match(sql, /storage\.objects/);
});

test('all model access policies depend on authenticated ownership, group membership or administrator role', () => {
  const sql = readSql();
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /group_memberships/);
  assert.match(sql, /current_profile_student_key\(\)/);
  assert.match(sql, /current_profile_role\(\)\s*=\s*'admin'/);
  assert.doesNotMatch(sql, /current_profile_role\(\)\s+in\s+\('teacher',\s*'admin'\)/);
  assert.doesNotMatch(sql, /for all to public using\s*\(true\)/);
  assert.doesNotMatch(sql, /to anon/);
});

test('placing or restoring a personal model verifies ownership of the target personal space', () => {
  const sql = readSql();
  assert.match(sql, /from public\.course_personal_spaces/);
  assert.match(sql, /owner_id\s*=\s*auth\.uid\(\)/);
  assert.match(sql, /model_space_scope_mismatch/);
  assert.match(sql, /model_space_forbidden/);
});
