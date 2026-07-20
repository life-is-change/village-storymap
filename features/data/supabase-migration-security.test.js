const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../supabase_SQL/Shared Current Survey Versioning and Feature Locks.sql'
);

test('shared survey migration exposes reads but not direct anonymous table writes', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.doesNotMatch(sql, /for\s+all\s+to\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.feature_edit_locks[\s\S]*?from\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+select\s+on\s+table\s+public\.feature_edit_locks[\s\S]*?to\s+anon\s*,\s*authenticated/i);
});

test('administrative snapshot RPCs are unavailable to public and browser roles', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.freeze_feature_snapshot\([\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.freeze_feature_snapshot\([\s\S]*?to\s+service_role/i);
  assert.doesNotMatch(sql, /grant\s+execute\s+on\s+function\s+public\.freeze_feature_snapshot\([\s\S]*?to\s+anon\s*,\s*authenticated/i);
});

test('structured lock and save RPCs remain available to the browser client', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.acquire_feature_edit_lock\([\s\S]*?to\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.save_feature_edit_batch\([\s\S]*?to\s+anon\s*,\s*authenticated/i);
});
