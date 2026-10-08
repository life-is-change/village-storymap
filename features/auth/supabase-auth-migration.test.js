const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.resolve(__dirname, "../../supabase_SQL/Supabase Auth Profiles and Identity RLS.sql");

test("profiles are tied to auth users and student ids are unique", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /id\s+uuid\s+primary key\s+references\s+auth\.users\s*\(id\)/i);
  assert.match(sql, /student_id\s+text\s+not null\s+unique/i);
  assert.match(sql, /alter table public\.profiles enable row level security/i);
});

test("registration cannot self-assign staff roles", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /handle_new_auth_user[\s\S]*?'student'[\s\S]*?raw_user_meta_data/i);
  assert.doesNotMatch(sql, /raw_user_meta_data\s*->>\s*'role'/i);
  assert.match(sql, /grant update\s*\(\s*display_name\s*,\s*gender\s*,\s*class_name\s*,\s*grade\s*\)/i);
});

test("anonymous users cannot read or edit profiles", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /revoke all on table public\.profiles from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.profiles to authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)[\s\S]*?public\.profiles[\s\S]*?to anon/i);
  assert.match(sql, /drop policy if exists "allow all auth_users" on public\.auth_users/i);
  assert.match(sql, /drop policy if exists "allow all user_sessions" on public\.user_sessions/i);
});
