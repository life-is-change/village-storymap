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

test("photo usage and deletion stay server-authorized without cascading facade history", () => {
  const displayNameColumn = sql.search(/add\s+column\s+if\s+not\s+exists\s+uploaded_by\s+text/i);
  const displayNameBackfill = sql.search(/btrim\(photo\.uploaded_by\)/i);
  assert.ok(displayNameColumn >= 0, "migration must add the optional uploader display-name column");
  assert.ok(
    displayNameColumn < displayNameBackfill,
    "uploader display-name column must exist before the legacy backfill reads it",
  );
  assert.match(sql, /add\s+column\s+if\s+not\s+exists\s+uploaded_by_user_id\s+uuid/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.list_object_photo_facade_usage/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.delete_object_photo_safely/i);
  assert.match(sql, /uploaded_by_user_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /before\s+insert\s+or\s+update\s+of\s+uploaded_by\s*,\s*uploaded_by_user_id\s+on\s+public\.object_photos/i);
  assert.match(sql, /tg_op\s*=\s*'UPDATE'[\s\S]*?new\.uploaded_by_user_id\s*:=\s*old\.uploaded_by_user_id[\s\S]*?new\.uploaded_by\s*:=\s*old\.uploaded_by/i);
  assert.match(sql, /public\.current_profile_role\(\)\s*=\s*'admin'/i);
  assert.match(sql, /FACADE_PHOTO_IN_USE/i);
  assert.match(sql, /SNAPSHOT_PHOTO_IMMUTABLE/i);
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"allow public delete from house-photos"/i);
  assert.match(sql, /house_photos_delete_owner_admin/i);
  assert.match(sql, /owner_id::text\s*=\s*auth\.uid\(\)::text/i);
  assert.doesNotMatch(sql, /photo_id[\s\S]{0,80}on\s+delete\s+cascade/i);
});
