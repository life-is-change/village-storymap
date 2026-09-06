const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "..",
  "supabase_SQL",
  "Shared Survey Calibration and Freeze.sql"
);

function migrationSource() {
  return fs.readFileSync(migrationPath, "utf8");
}

function functionBody(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\([\\s\\S]*?\\$function\\$\\s*;`,
    "i"
  ));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

test("migration creates contextual review state with immutable identity", () => {
  const source = migrationSource();
  assert.match(source, /^\s*begin\s*;/i);
  assert.match(source, /create\s+table\s+if\s+not\s+exists\s+public\.survey_feature_reviews/i);
  assert.match(source, /unique\s*\(\s*teaching_project_id\s*,\s*village_id\s*,\s*space_id\s*,\s*layer_key\s*,\s*object_code\s*\)/i);
  assert.match(source, /geometry_status[\s\S]*?'pending'[\s\S]*?'confirmed_unchanged'[\s\S]*?'modified'[\s\S]*?'deleted'[\s\S]*?'added'/i);
  assert.match(source, /geometry_revision\s+bigint\s+not\s+null\s+default\s+0/i);
  assert.match(source, /is_deleted\s+boolean\s+not\s+null\s+default\s+false/i);
  assert.match(source, /is_v0_baseline[\s\S]*?baseline_object_code/i);
  assert.match(source, /commit\s*;\s*$/i);
});

test("staff initializes the formal shared review index from one published V0 dataset", () => {
  const source = migrationSource();
  const body = functionBody(source, "initialize_shared_survey_reviews");
  assert.match(body, /p_dataset_id\s+uuid/i);
  assert.match(body, /p_items\s+jsonb/i);
  assert.match(body, /space_type\s*<>\s*'formal_shared'[\s\S]*?FORMAL_SHARED_SPACE_REQUIRED/i);
  assert.match(body, /status\s*=\s*'published'/i);
  assert.match(body, /current_profile_role\(\)[\s\S]*?'teacher'[\s\S]*?'admin'/i);
  assert.match(body, /layer_key\s+in\s*\(\s*'building'\s*,\s*'road'\s*,\s*'water'\s*\)/i);
  assert.match(body, /on\s+conflict\s*\(\s*teaching_project_id\s*,\s*village_id\s*,\s*space_id\s*,\s*layer_key\s*,\s*object_code\s*\)\s+do\s+nothing/i);
  assert.match(body, /SURVEY_REVIEW_INDEX_ALREADY_INITIALIZED/i);
  assert.match(source, /grant\s+execute\s+on\s+function\s+public\.initialize_shared_survey_reviews[\s\S]*?to\s+authenticated/i);
  assert.doesNotMatch(source, /grant\s+execute\s+on\s+function\s+public\.initialize_shared_survey_reviews[\s\S]*?to\s+anon/i);
});

test("review rows and frozen evidence are readable only through contextual RLS", () => {
  const source = migrationSource();
  for (const table of [
    "survey_feature_reviews",
    "community_task_versions",
    "survey_snapshot_photo_refs",
    "survey_snapshot_issue_refs"
  ]) {
    assert.match(source, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}`, "i"));
    assert.match(source, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"));
  }
  assert.match(source, /revoke\s+all\s+on\s+table\s+public\.survey_feature_reviews[\s\S]*?from\s+public\s*,\s*anon/i);
  assert.doesNotMatch(source, /grant\s+(insert|update|delete)[\s\S]*?survey_feature_reviews[\s\S]*?to\s+authenticated/i);
  assert.match(source, /context_space_accessible/i);
});

test("review context helper accepts only the requested formal shared space", () => {
  const source = migrationSource();
  const body = functionBody(source, "assert_survey_review_context");
  assert.match(body, /p_teaching_project_id/i);
  assert.match(body, /p_village_id/i);
  assert.match(body, /p_space_id/i);
  assert.match(body, /space_type\s*=\s*'formal_shared'/i);
  assert.match(body, /FORMAL_SHARED_SPACE_REQUIRED/i);
  assert.match(body, /context_space_accessible/i);
});

test("planning spaces can record an explicit frozen group baseline", () => {
  const source = migrationSource();
  assert.match(source, /alter\s+table\s+public\.planning_spaces[\s\S]*?add\s+column\s+if\s+not\s+exists\s+base_snapshot_id\s+uuid/i);
  assert.match(source, /references\s+public\.feature_snapshots\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
});

test("geometry confirmation requires the authenticated editor live lock and expected revision", () => {
  const source = migrationSource();
  const body = functionBody(source, "confirm_survey_feature_geometry");
  assert.match(body, /v_user_id\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(body, /assert_survey_review_context/i);
  assert.match(body, /context_space_mutable/i);
  assert.match(body, /from\s+public\.feature_edit_locks[\s\S]*?editor_user_id\s*=\s*v_user_id[\s\S]*?lock_token\s*=\s*p_lock_token[\s\S]*?expires_at\s*>\s*now\(\)/i);
  assert.match(body, /FEATURE_LOCK_REQUIRED/i);
  assert.match(body, /geometry_revision\s*<>\s*p_expected_revision[\s\S]*?GEOMETRY_REVISION_CONFLICT/i);
  assert.match(body, /geometry_status\s*=\s*'confirmed_unchanged'/i);
  assert.match(body, /geometry_revision\s*=\s*geometry_revision\s*\+\s*1/i);
  assert.match(body, /insert\s+into\s+public\.activity_events/i);
});

test("only authenticated callers can execute geometry confirmation", () => {
  const source = migrationSource();
  assert.match(source, /revoke\s+all\s+on\s+function\s+public\.confirm_survey_feature_geometry\(uuid,uuid,text,text,text,bigint,uuid\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(source, /grant\s+execute\s+on\s+function\s+public\.confirm_survey_feature_geometry\(uuid,uuid,text,text,text,bigint,uuid\)[\s\S]*?to\s+authenticated/i);
  assert.doesNotMatch(source, /grant\s+execute\s+on\s+function\s+public\.confirm_survey_feature_geometry\([^;]+to\s+anon/i);
});

test("shared geometry saves atomically validate locks revisions and review state", () => {
  const source = migrationSource();
  const body = functionBody(source, "save_feature_edit_batch");
  assert.match(body, /space_type\s*=\s*'formal_shared'/i);
  assert.match(body, /expectedGeometryRevision/i);
  assert.match(body, /lockToken/i);
  assert.match(body, /editor_user_id\s*=\s*v_user_id[\s\S]*?expires_at\s*>\s*now\(\)/i);
  assert.match(body, /GEOMETRY_REVISION_CONFLICT/i);
  assert.match(body, /change_object_code\s*:=\s*[\s\S]*?gen_random_uuid\(\)/i);
  assert.match(body, /is_v0_baseline[\s\S]*?geometry_status[\s\S]*?'added'/i);
  assert.match(body, /geometry_status\s*=\s*case/i);
  assert.match(body, /when\s+change_action\s*=\s*'delete'\s+then\s+'deleted'/i);
  assert.match(body, /else\s+'modified'/i);
  assert.match(body, /insert\s+into\s+public\.feature_versions/i);
  assert.match(body, /insert\s+into\s+public\.activity_events/i);
});

test("deleting a static V0 feature writes a tombstone even without a prior override", () => {
  const body = functionBody(migrationSource(), "save_feature_edit_batch");
  assert.match(body, /if\s+change_action\s*=\s*'delete'\s+then\s+insert into public\.planning_features[\s\S]*?on conflict\s*\(\s*space_id\s*,\s*layer_key\s*,\s*object_code\s*\)/i);
});

test("database gates downstream survey writes and ignores non-survey contexts", () => {
  const source = migrationSource();
  const body = functionBody(source, "enforce_survey_downstream_gate");
  assert.match(body, /space_type\s*<>\s*'formal_shared'/i);
  assert.match(body, /survey_feature_downstream_ready/i);
  assert.match(body, /GEOMETRY_REVIEW_REQUIRED/i);
  for (const table of [
    "object_attribute_edits",
    "object_photos",
    "object_comments",
    "community_tasks"
  ]) {
    assert.match(source, new RegExp(
      `create\\s+trigger\\s+\\w+\\s+before\\s+(?:insert\\s+or\\s+update|insert|update)\\s+on\\s+public\\.${table}[\\s\\S]*?execute\\s+function\\s+public\\.enforce_survey_downstream_gate`,
      "i"
    ));
  }
  assert.match(source, /survey_layer_key\s+text/i);
  assert.match(source, /target_layer_key\s+text/i);
  assert.match(source, /target_object_code\s+text/i);
});

test("survey reviews are included in the idempotent realtime publication setup", () => {
  const realtimePath = path.join(__dirname, "..", "..", "supabase_SQL", "Realtime Publication Setup.sql");
  const source = fs.readFileSync(realtimePath, "utf8");
  assert.match(source, /'survey_feature_reviews'/i);
  assert.match(source, /duplicate_object/i);
});

test("admin dashboard aggregates evidence and restore only appends history", () => {
  const source = migrationSource();
  const dashboard = functionBody(source, "get_shared_survey_dashboard");
  const restore = functionBody(source, "restore_survey_feature_version");
  assert.match(dashboard, /object_photos/i);
  assert.match(dashboard, /community_tasks/i);
  assert.match(restore, /current_profile_role\(\)[\s\S]*?'teacher'[\s\S]*?'admin'/i);
  assert.match(restore, /insert\s+into\s+public\.feature_change_batches/i);
  assert.match(restore, /insert\s+into\s+public\.feature_versions/i);
  assert.doesNotMatch(restore, /update\s+public\.feature_versions/i);
});

test("admin feature listing is contextual and restoration can create a delete tombstone", () => {
  const sql = migrationSource();
  assert.match(sql, /create or replace function public\.list_shared_survey_features/i);
  assert.match(sql, /p_layer_key\s+is\s+null[\s\S]*?p_geometry_status\s+is\s+null[\s\S]*?p_actor_id\s+is\s+null/i);
  const restore = functionBody(sql, "restore_survey_feature_version");
  assert.match(restore, /insert into public\.planning_features[\s\S]*?on conflict\s*\(\s*space_id\s*,\s*layer_key\s*,\s*object_code\s*\)/i);
  assert.doesNotMatch(restore, /where\s+id\s*=\s*v_current\.id/i);
});

test("freeze is staff only lock guarded and captures immutable evidence references", () => {
  const sql = migrationSource();
  const freeze = functionBody(sql, "freeze_shared_survey_snapshot");
  assert.match(sql, /alter table public\.feature_snapshots[\s\S]*?version_number[\s\S]*?recommended_for_groups[\s\S]*?stats/i);
  assert.match(freeze, /current_profile_role\(\)[\s\S]*?'teacher'[\s\S]*?'admin'/i);
  assert.match(freeze, /ACTIVE_FEATURE_LOCKS/i);
  assert.match(freeze, /INCOMPLETE_SERVER_SURVEY_STATE/i);
  assert.match(freeze, /insert into public\.feature_snapshots/i);
  assert.match(freeze, /insert into public\.feature_snapshot_items/i);
  assert.match(freeze, /insert into public\.survey_snapshot_photo_refs/i);
  assert.match(freeze, /insert into public\.survey_snapshot_issue_refs/i);
  assert.match(freeze, /insert into public\.activity_events\s*\(\s*event_id\s*,\s*client_event_id\s*,\s*occurred_at/i);
  assert.match(freeze, /'survey_snapshot_frozen'/i);
  assert.doesNotMatch(freeze, /base_snapshot_id/i);
  assert.doesNotMatch(freeze, /readonly\s*=\s*true/i);
});

test("photo deletion and issue updates preserve frozen evidence", () => {
  const sql = migrationSource();
  assert.match(sql, /create or replace function public\.assert_survey_photo_deletable/i);
  assert.match(sql, /SNAPSHOT_PHOTO_IMMUTABLE/i);
  assert.match(sql, /create\s+trigger\s+trg_community_task_version/i);
  assert.match(sql, /insert into public\.community_task_versions/i);
});
