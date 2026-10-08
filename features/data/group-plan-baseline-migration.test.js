const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(__dirname, "../../supabase_SQL/Group Plan Baseline Update.sql");
const sql = fs.readFileSync(migrationPath, "utf8");
const freezeSql = fs.readFileSync(
  path.join(__dirname, "../../supabase_SQL/Shared Survey Calibration and Freeze.sql"),
  "utf8"
);

function extractFunction(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\([\\s\\S]*?\\$function\\$\\s*;`,
    "i"
  ));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

test("group plan schema stores sparse overrides and baseline history", () => {
  assert.match(sql, /create table if not exists public\.group_baseline_updates/i);
  assert.match(sql, /create table if not exists public\.group_baseline_conflicts/i);
  assert.match(sql, /create table if not exists public\.group_plan_restore_points/i);
  assert.match(sql, /operation_kind[\s\S]*?check[\s\S]*?'added'[\s\S]*?'updated'[\s\S]*?'deleted'/i);
  assert.match(sql, /base_object_code/i);
  assert.match(sql, /feature_revision/i);
});

test("one project village and group has one active group plan", () => {
  assert.match(
    sql,
    /create unique index[\s\S]*?planning_spaces[\s\S]*?teaching_project_id[\s\S]*?village_id[\s\S]*?group_id[\s\S]*?where[\s\S]*?space_type\s*=\s*'group_plan'/i
  );
});

test("phase three tables are private to group members and staff", () => {
  for (const table of ["group_baseline_updates", "group_baseline_conflicts", "group_plan_restore_points"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /group_memberships/i);
  assert.match(sql, /current_profile_role\(\)[\s\S]*?'teacher'[\s\S]*?'admin'/i);
  assert.match(sql, /revoke all on table public\.group_baseline_conflicts from anon/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
});

test("phase three privileged helpers are not exposed to public or anonymous roles", () => {
  assert.match(sql, /revoke all on function public\.is_group_plan_member[\s\S]*?from public, anon/i);
  assert.match(sql, /revoke all on function public\.is_group_plan_staff[\s\S]*?from public, anon/i);
});

test("group space lifecycle is idempotent and rejects practice villages", () => {
  assert.match(sql, /create or replace function public\.ensure_group_plan_space/i);
  assert.match(sql, /PRACTICE_GROUP_SPACE_FORBIDDEN/i);
  assert.match(sql, /waiting_for_snapshot/i);
  assert.match(sql, /recommended_for_groups/i);
  assert.match(sql, /on conflict[\s\S]*?do nothing/i);
});

test("freezing ensures group spaces without rewriting an existing baseline", () => {
  assert.match(freezeSql, /ensure_group_plan_spaces_for_snapshot/i);
  assert.doesNotMatch(
    freezeSql,
    /update\s+public\.planning_spaces[\s\S]{0,500}?base_snapshot_id\s*=\s*v_snapshot/i
  );
});

test("group space lifecycle functions are authenticated and not publicly executable", () => {
  assert.match(
    sql,
    /revoke all on function public\.ensure_group_plan_space\(uuid,uuid,text,uuid\)[\s\S]*?from public, anon/i
  );
  assert.match(
    sql,
    /revoke all on function public\.ensure_group_plan_spaces_for_snapshot\(uuid\)[\s\S]*?from public, anon/i
  );
});

test("standalone phase three migration attaches lifecycle to future frozen snapshots", () => {
  assert.match(sql, /create or replace function public\.ensure_group_plan_spaces_after_snapshot/i);
  assert.match(sql, /after insert on public\.feature_snapshots/i);
  assert.match(sql, /execute function public\.ensure_group_plan_spaces_after_snapshot\(\)/i);
});

test("insert row count uses an integer before deriving the created flag", () => {
  assert.match(sql, /v_inserted_count\s+integer\s*:=\s*0/i);
  assert.match(sql, /get diagnostics v_inserted_count = row_count/i);
  assert.match(sql, /v_created\s*:=\s*v_inserted_count\s*>\s*0/i);
  assert.doesNotMatch(sql, /get diagnostics v_created = row_count/i);
});

test("resolved group plan comes from server facts and validates membership", () => {
  assert.match(sql, /create or replace function public\.resolve_group_plan_features/i);
  assert.match(sql, /feature_snapshot_items/i);
  assert.match(sql, /planning_features/i);
  assert.match(sql, /is_group_plan_member/i);
  assert.match(sql, /base_snapshot_id/i);
  assert.doesNotMatch(sql, /p_user_id/i);
});

test("resolved group plan RPC is read only and authenticated", () => {
  assert.match(
    sql,
    /revoke all on function public\.resolve_group_plan_features\(uuid,uuid,text,text\)[\s\S]*?from public, anon/i
  );
  assert.match(
    sql,
    /grant execute on function public\.resolve_group_plan_features\(uuid,uuid,text,text\)\s+to authenticated/i
  );
});

test("group edit RPC checks membership locks revisions and allowed layers", () => {
  assert.match(sql, /create or replace function public\.save_group_plan_edit_batch/i);
  assert.match(sql, /GROUP_LAYER_READ_ONLY/i);
  assert.match(sql, /FEATURE_REVISION_CONFLICT/i);
  assert.match(sql, /feature_edit_locks/i);
  assert.match(sql, /is_group_plan_member/i);
  assert.match(sql, /auth\.uid\(\)/i);
});

test("group update cannot lock an alias while overriding another baseline object", () => {
  assert.match(
    sql,
    /v_action in \('update', 'delete'\)[\s\S]*?v_base_code <> v_client_code[\s\S]*?GROUP_PLAN_OBJECT_IDENTITY_MISMATCH[\s\S]*?v_base_code := v_client_code/i
  );
});

test("group edits are RPC only and do not accept caller identity", () => {
  assert.match(
    sql,
    /revoke all on function public\.save_group_plan_edit_batch\(uuid,uuid,text,text,text,jsonb\)[\s\S]*?from public, anon/i
  );
  assert.doesNotMatch(sql, /save_group_plan_edit_batch\([\s\S]{0,300}?p_user_id/i);
});

test("baseline update is atomic lock guarded and preserves group changes", () => {
  const body = extractFunction(sql, "apply_group_baseline_update");
  assert.match(body, /for update/i);
  assert.match(body, /BASELINE_VERSION_CONFLICT/i);
  assert.match(body, /GROUP_SPACE_BUSY/i);
  assert.match(body, /group_plan_restore_points/i);
  assert.match(body, /group_baseline_conflicts/i);
  assert.match(body, /base_snapshot_id/i);
  assert.doesNotMatch(body, /delete\s+from\s+public\.planning_features/i);
});

test("baseline workflow exposes preview conflict resolution and staff restore", () => {
  for (const name of [
    "preview_group_baseline_update",
    "resolve_group_baseline_conflict",
    "restore_group_plan_restore_point"
  ]) assert.match(sql, new RegExp(`create or replace function public\\.${name}`, "i"));
  assert.match(extractFunction(sql, "restore_group_plan_restore_point"), /STAFF_REQUIRED/i);
  assert.match(extractFunction(sql, "resolve_group_baseline_conflict"), /keep_group[\s\S]*?use_new_baseline[\s\S]*?manual_merge/i);
});

test("baseline mutation RPCs are authenticated but never anonymous", () => {
  for (const signature of [
    "preview_group_baseline_update\\(uuid,uuid,text,uuid\\)",
    "apply_group_baseline_update\\(uuid,uuid,text,uuid,uuid\\)",
    "resolve_group_baseline_conflict\\(uuid,text,jsonb\\)",
    "restore_group_plan_restore_point\\(uuid\\)"
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon`, "i"));
  }
});

test("group baseline state is loaded from one membership-checked RPC", () => {
  const body = extractFunction(sql, "get_group_plan_baseline_state");
  assert.match(body, /assert_group_plan_context/i);
  assert.match(body, /feature_snapshots/i);
  assert.match(body, /formal_shared/i);
  assert.match(sql, /revoke all on function public\.get_group_plan_baseline_state\(uuid,uuid,text\) from public, anon/i);
});
