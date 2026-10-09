const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase_SQL/Scene Edit Studio.sql"), "utf8");
const migration = fs.readFileSync(path.resolve(__dirname, "../../supabase_SQL/MIGRATION - Scene Edit Admin Sandbox.sql"), "utf8");

test("incremental migration isolates administrator sandboxes", () => {
  assert.match(migration, /add column if not exists scope_kind/i);
  assert.match(migration, /alter column group_id drop not null/i);
  assert.match(migration, /admin_sandbox/i);
  assert.match(migration, /created_by\s*=\s*auth\.uid\(\)/i);
  assert.match(migration, /current_profile_role\(\)\s*=\s*'admin'/i);
});

test("scene studio schema defines the five scoped data responsibilities", () => {
  for (const table of ["scene_edit_projects", "scene_edit_objects", "scene_edit_assets", "scene_edit_components", "scene_edit_versions"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, "i"), table);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `${table} RLS`);
  }
  assert.match(sql, /scope_kind text not null default 'group'/i);
  assert.match(sql, /scope_kind = 'admin_sandbox' and group_id is null/i);
});

test("draft saving is atomic, revision guarded and baseline preserving", () => {
  const save = sql.match(/create or replace function public\.scene_edit_save_draft[\s\S]*?\$function\$;/i)?.[0] || "";
  assert.match(save, /for update/i);
  assert.match(save, /errcode\s*=\s*'40001'/i);
  assert.match(save, /baseline_revision/i);
  assert.match(save, /delete from public\.scene_edit_objects/i);
  assert.match(save, /jsonb_array_elements/i);
  assert.match(save, /revision\s*=\s*revision\s*\+\s*1/i);
  assert.match(save, /security definer/i);
  assert.match(save, /set search_path = public, pg_temp/i);
});

test("project lifecycle uses explicit branch, restore, milestone and submit RPCs", () => {
  for (const name of [
    "scene_edit_create_project",
    "scene_edit_load_project",
    "scene_edit_branch_project",
    "scene_edit_create_version",
    "scene_edit_restore_version",
    "scene_edit_submit_version"
  ]) assert.match(sql, new RegExp(`create or replace function public\\.${name}\\b`, "i"), name);
  assert.match(sql, /scene_edit_versions_are_immutable/i);
});

test("submission keeps the immutable trigger enabled and changes status only once", () => {
  const guard = sql.match(/create or replace function public\.scene_edit_versions_are_immutable[\s\S]*?\$\$;/i)?.[0] || "";
  const submit = sql.match(/create or replace function public\.scene_edit_submit_version[\s\S]*?\$function\$;/i)?.[0] || "";
  assert.match(guard, /old\.submission_status\s*=\s*'milestone'/i);
  assert.match(guard, /new\.submission_status\s*=\s*'submitted'/i);
  assert.match(guard, /new\.document\s+is\s+not\s+distinct\s+from\s+old\.document/i);
  assert.doesNotMatch(submit, /disable trigger/i);
});

test("students use membership-scoped reads while mutations stay RPC-only", () => {
  assert.match(sql, /public\.is_scene_edit_group_member/i);
  assert.match(sql, /public\.is_scene_edit_staff/i);
  assert.match(sql, /group_memberships/i);
  assert.match(sql, /current_profile_student_key/i);
  assert.match(sql, /revoke all on table public\.scene_edit_projects from anon, authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete)[^;]*scene_edit_/i);
  assert.match(sql, /grant execute on function public\.scene_edit_save_draft/i);
});

test("private storage and soft deletion protect current and historical assets", () => {
  assert.match(sql, /values \('scene-assets', 'scene-assets', false/i);
  assert.match(sql, /values \('scene-version-previews', 'scene-version-previews', false/i);
  assert.match(sql, /scene_assets_storage_select/i);
  assert.match(sql, /scene_previews_storage_select/i);
  assert.match(sql, /archived_at timestamptz/i);
  assert.match(sql, /scene_edit_archive_asset/i);
  assert.match(sql, /referenced_by_version/i);
  for (const name of [
    "scene_edit_register_asset", "scene_edit_update_asset_metadata", "scene_edit_publish_asset",
    "scene_edit_copy_asset", "scene_edit_save_component", "scene_edit_publish_component",
    "scene_edit_copy_component", "scene_edit_archive_component"
  ]) assert.match(sql, new RegExp(`create or replace function public\\.${name}\\b`, "i"), name);
});
