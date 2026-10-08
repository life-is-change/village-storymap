const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "..",
  "supabase_SQL",
  "Multi-Village Dual-Track Repair.sql"
);
const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "app.js"), "utf8");
const featureDbSource = fs.readFileSync(path.join(__dirname, "feature-db.js"), "utf8");
const copySeedSource = fs.readFileSync(path.join(__dirname, "copy-space-seed.js"), "utf8");

function sqlStatements(source) {
  const statements = [];
  let start = 0;
  let dollarTag = null;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "$" && !dollarTag) {
      const match = source.slice(index).match(/^\$[A-Za-z_]*\$/);
      if (match) {
        dollarTag = match[0];
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (dollarTag && source.startsWith(dollarTag, index)) {
      index += dollarTag.length - 1;
      dollarTag = null;
      continue;
    }
    if (!dollarTag && source[index] === ";") {
      const statement = source.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  return statements;
}

function repairStatements() {
  assert.ok(fs.existsSync(migrationPath), "the recovery migration must be added as a new SQL file");
  return sqlStatements(fs.readFileSync(migrationPath, "utf8"));
}

function functionStatement(statements, name) {
  const candidates = statements.filter((candidate) => new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(`,
    "i"
  ).test(candidate));
  const statement = candidates.find((candidate) => /p_teaching_project_id\s+uuid/i.test(candidate)) || candidates.at(-1);
  assert.ok(statement, `expected a ${name} function statement`);
  return statement;
}

function legacyFunctionStatement(statements, name) {
  const statement = statements.find((candidate) => new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(`,
    "i"
  ).test(candidate) && !/p_teaching_project_id\s+uuid/i.test(candidate));
  assert.ok(statement, `expected a legacy ${name} function statement`);
  return statement;
}

function latestFunctionStatement(statements, name) {
  const statement = statements.filter((candidate) => new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(`,
    "i"
  ).test(candidate)).at(-1);
  assert.ok(statement, `expected a latest ${name} function statement`);
  return statement;
}

function latestPolicyStatement(statements, table, action) {
  const statement = statements.filter((candidate) => new RegExp(
    `create\\s+policy\\s+[A-Za-z0-9_]+\\s+on\\s+public\\.${table}\\s+for\\s+${action}`,
    "i"
  ).test(candidate)).at(-1);
  assert.ok(statement, `expected a ${action} policy for ${table}`);
  return statement;
}

test("repair migration is transactional and seeds the published Mibu practice context", () => {
  const statements = repairStatements();
  assert.match(statements[0], /begin;$/i);
  assert.match(statements.at(-1), /^commit;$/i);
  const seed = statements.join("\n");
  assert.match(seed, /米埗村/);
  assert.match(seed, /\bV0\b/);
  assert.match(seed, /5133927/);
  assert.match(seed, /practice_shared/i);
  assert.match(seed, /on\s+conflict/i);
});

test("repair migration promotes only the exact legacy current feature space and proves copy rows were untouched", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  assert.match(source, /update\s+public\.planning_features[\s\S]*?set\s+space_id\s*=\s*v_practice_shared[\s\S]*?where\s+space_id\s*=\s*'current'/i);
  assert.match(source, /space_id\s+like\s+'copy[_%]+'/i);
  assert.match(source, /COPY_FEATURE_COUNT_ASSERTION_FAILED/i);
});

test("repair migration scopes legacy collaboration records and replaces the attribute uniqueness with a real context constraint", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  for (const table of [
    "community_tasks",
    "object_photos",
    "object_comments",
    "object_attribute_edits",
    "feature_snapshots",
    "activity_events"
  ]) {
    assert.match(source, new RegExp(`update\\s+public\\.${table}\\b`, "i"));
  }
  assert.match(source, /alter\s+table\s+public\.object_attribute_edits[\s\S]*?add\s+constraint\s+object_attribute_edits_context_key[\s\S]*?unique\s*\(\s*teaching_project_id\s*,\s*village_id\s*,\s*space_id\s*,\s*object_code\s*,\s*object_type\s*\)/i);
  assert.match(source, /alter\s+column\s+teaching_project_id\s+set\s+not\s+null/i);
  assert.match(source, /alter\s+column\s+village_id\s+set\s+not\s+null/i);
  assert.match(source, /alter\s+column\s+space_id\s+set\s+not\s+null/i);
  assert.doesNotMatch(source, /delete\s+from\s+public\.object_attribute_edits/i);
});

test("repair migration provides context-validated lock, edit, snapshot, and geoprocessing overloads while retaining legacy signatures", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  assert.match(source, /primary\s+key\s*\(\s*teaching_project_id\s*,\s*village_id\s*,\s*space_id\s*,\s*layer_key\s*,\s*object_code\s*\)/i);
  for (const name of [
    "acquire_feature_edit_lock",
    "heartbeat_feature_edit_lock",
    "release_feature_edit_lock",
    "save_feature_edit_batch",
    "freeze_feature_snapshot"
  ]) {
    const contextualFunction = functionStatement(statements, name);
    assert.match(contextualFunction, /p_teaching_project_id\s+uuid[\s\S]*?p_village_id\s+uuid/i);
    assert.match(contextualFunction, /assert_feature_space_context/i);
  }
  assert.match(functionStatement(statements, "assert_feature_space_context"), /PROJECT_SPACE_CONTEXT_MISMATCH/i);
  assert.match(functionStatement(statements, "submit_geoprocessing_run"), /p_teaching_project_id\s+uuid[\s\S]*?p_dataset_id\s+uuid/i);
  assert.match(source, /input_manifest\s+jsonb/i);
  assert.doesNotMatch(source, /drop\s+function\s+(if\s+exists\s+)?public\.submit_geoprocessing_run\(text,text,text\[\],jsonb,jsonb\)/i);
});

test("repair keeps the legacy lock conflict target while isolating its explicit legacy planning scope", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  assert.match(source, /v_legacy_scope[\s\S]*?'legacy_unscoped'/i);
  assert.match(source, /feature_edit_locks_legacy_identity_key[\s\S]*?unique\s*\(\s*space_id\s*,\s*layer_key\s*,\s*object_code\s*\)/i);
  assert.match(source, /on\s+conflict\s*\(\s*space_id\s*,\s*layer_key\s*,\s*object_code\s*\)/i);
});

test("repair binds contextual mutations to authenticated profile identity instead of caller supplied names", () => {
  const statements = repairStatements();
  for (const name of ["acquire_feature_edit_lock", "heartbeat_feature_edit_lock", "release_feature_edit_lock", "save_feature_edit_batch"]) {
    const statement = functionStatement(statements, name);
    assert.match(statement, /v_user_id\s+uuid\s*:=\s*auth\.uid\(\)/i);
    assert.match(statement, /AUTH_REQUIRED/i);
    assert.match(statement, /editor_user_id/i);
  }
  const acquire = functionStatement(statements, "acquire_feature_edit_lock");
  assert.match(acquire, /v_editor_name\s+text\s*:=\s*public\.current_profile_display_name\(\)/i);
  assert.doesNotMatch(acquire, /editor_name\s*=\s*p_editor_name/i);
});

test("repair preserves copy row identity while attaching each row to an isolated legacy personal scope", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  assert.match(source, /v_copy_identity_before\s+jsonb/i);
  assert.match(source, /v_copy_identity_after\s+jsonb/i);
  assert.match(source, /jsonb_build_array\(\s*id\s*,\s*space_id\s*\)/i);
  assert.match(source, /v_copy_identity_after\s*<>\s*v_copy_identity_before/i);
  assert.match(source, /COPY_FEATURE_IDENTITY_ASSERTION_FAILED/i);
  assert.match(source, /create\s+table\s+if\s+not\s+exists\s+public\.legacy_personal_space_scopes/i);
  assert.match(source, /space_id\s+text\s+primary\s+key/i);
  assert.match(source, /ownership_status[\s\S]*?check\s*\(\s*ownership_status\s+in\s*\(\s*'owned'\s*,\s*'archival'\s*\)\s*\)/i);
  assert.doesNotMatch(source, /unique\s*\(\s*owner_id\s*,\s*teaching_project_id\s*,\s*village_id\s*\)/i);
  assert.match(source, /count\(profile\.id\)\s*=\s*1/i);
  const scopedCopyUpdate = source.match(
    /update\s+public\.planning_features\s+feature\s+set[\s\S]*?where\s+feature\.space_id\s*=\s*scope\.space_id\s*;/i
  )?.[0];
  assert.ok(scopedCopyUpdate, "expected a targeted legacy-copy context update");
  assert.match(scopedCopyUpdate, /teaching_project_id\s*=\s*scope\.teaching_project_id/i);
  const assignments = scopedCopyUpdate.match(/set([\s\S]*?)from\s+public\.legacy_personal_space_scopes/i)?.[1] || "";
  assert.doesNotMatch(assignments, /\bspace_id\s*=/i);
});

test("repair replaces unsafe public writes with authenticated context RLS", () => {
  const source = repairStatements().join("\n");
  assert.match(source, /create\s+or\s+replace\s+function\s+public\.context_space_accessible/i);
  assert.match(source, /pg_policies/i);
  assert.match(source, /execute\s+format\('drop\s+policy/i);
  assert.match(source, /create\s+policy\s+context_rows_read/i);
  assert.match(source, /create\s+policy\s+context_rows_insert/i);
  assert.match(source, /revoke\s+all\s+on\s+table[\s\S]*?from\s+public\s*,\s*anon/i);
  assert.doesNotMatch(source, /for\s+all\s+to\s+public\s+using\s*\(\s*true\s*\)/i);
});

test("repair reconciles Mibu V0 publication and rejects contextual runs against unpublished datasets for students", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  assert.match(source, /update\s+public\.village_datasets\s+set\s+status\s*=\s*'ready'[\s\S]*?status\s*=\s*'published'/i);
  assert.match(source, /update\s+public\.village_datasets\s+set\s+status\s*=\s*'published'/i);
  const submit = functionStatement(statements, "submit_geoprocessing_run");
  assert.match(submit, /v_dataset\.status\s*<>\s*'published'[\s\S]*?current_profile_role\(\)\s+not\s+in\s*\(\s*'teacher'\s*,\s*'admin'\s*\)/i);
  assert.match(submit, /PUBLISHED_DATASET_REQUIRED/i);
});

test("repair keeps legacy lock RPCs functional by resolving their space into a complete contextual lock insert", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  assert.match(source, /create\s+or\s+replace\s+function\s+public\.resolve_legacy_feature_context/i);
  for (const [name, signature] of [
    ["acquire_feature_edit_lock", "text,text,text,text,integer"],
    ["heartbeat_feature_edit_lock", "text,text,text,text,uuid,integer"],
    ["release_feature_edit_lock", "text,text,text,text,uuid"],
    ["save_feature_edit_batch", "text,text,text,text,jsonb"]
  ]) {
    const statement = legacyFunctionStatement(statements, name);
    assert.match(statement, /resolve_legacy_feature_context/i);
    assert.match(statement, new RegExp(`public\\.${name}\\(`, "i"));
    assert.match(source, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${signature}\\)`, "i"));
  }
  const contextualAcquire = functionStatement(statements, "acquire_feature_edit_lock");
  assert.match(contextualAcquire, /teaching_project_id\s*,\s*village_id\s*,\s*space_id[\s\S]*?editor_user_id/i);
});

test("repair authorizes contextual writes only for staff, owners, or course participants in editable allowed spaces", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  assert.match(source, /create\s+or\s+replace\s+function\s+public\.context_space_mutable/i);
  assert.match(source, /current_profile_role\(\)\s+in\s*\(\s*'teacher'\s*,\s*'admin'\s*\)/i);
  assert.match(source, /space\.owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(source, /public\.group_memberships/i);
  assert.match(source, /space\.readonly\s*=\s*false[\s\S]*?space\.edit_enabled\s*=\s*true/i);
  assert.match(source, /space_type\s+in\s*\(\s*'practice_shared'\s*,\s*'formal_shared'\s*,\s*'practice_personal'\s*,\s*'formal_personal'\s*,\s*'group_plan'\s*\)/i);
  assert.match(latestFunctionStatement(statements, "assert_feature_space_context"), /context_space_mutable/i);
});

test("repair reserves planning-feature deletion for RPCs and scopes legacy collaboration cleanup to staff", () => {
  const source = repairStatements().join("\n");
  assert.match(source, /revoke\s+delete\s+on\s+table\s+public\.planning_features\s+from\s+authenticated/i);
  assert.doesNotMatch(source, /create\s+policy\s+context_rows_delete\s+on\s+public\.planning_features/i);
  for (const table of ["community_tasks", "object_photos", "object_comments", "object_attribute_edits"]) {
    const policy = source.match(new RegExp(`create\\s+policy\\s+context_rows_delete\\s+on\\s+public\\.${table}[\\s\\S]*?;`, "i"))?.[0];
    assert.ok(policy, `missing delete policy for ${table}`);
    assert.match(policy, /current_profile_role\(\)\s+in\s*\(\s*'teacher'\s*,\s*'admin'\s*\)/i);
    assert.match(policy, /context_space_accessible/i);
  }
  assert.doesNotMatch(source, /grant\s+delete[\s\S]*?to\s+anon\b/i);
});

test("repair requires current course participation or staff for shared reads", () => {
  const statements = repairStatements();
  const readable = latestFunctionStatement(statements, "context_space_accessible");
  assert.match(readable, /membership\.course_id\s*=\s*project\.course_id/i);
  assert.match(readable, /membership\.student_key\s*=\s*public\.current_profile_student_key\(\)/i);
  assert.match(readable, /or\s+exists\s*\([\s\S]*?space\.space_type\s+in\s*\(\s*'practice_shared'\s*,\s*'formal_shared'\s*\)/i);
  assert.doesNotMatch(readable, /space\.space_type\s+in\s*\(\s*'practice_shared'\s*,\s*'formal_shared'\s*\)\s*\n\s*or\s+space\.owner_id/i);
});

test("repair exposes freeze only to authenticated staff and preserves the legacy freeze entry point", () => {
  const statements = repairStatements();
  const contextualFreeze = functionStatement(statements, "freeze_feature_snapshot");
  assert.match(contextualFreeze, /auth\.uid\(\)\s+is\s+null[\s\S]*?STAFF_REQUIRED/i);
  assert.match(contextualFreeze, /current_profile_role\(\)\s+not\s+in\s*\(\s*'teacher'\s*,\s*'admin'\s*\)/i);
  assert.match(statements.join("\n"), /grant\s+execute\s+on\s+function\s+public\.freeze_feature_snapshot\(text,uuid,uuid,text,text,text,text,jsonb\)\s+to\s+authenticated/i);
  const legacyFreeze = legacyFunctionStatement(statements, "freeze_feature_snapshot");
  assert.match(legacyFreeze, /resolve_legacy_feature_context/i);
  assert.match(legacyFreeze, /SNAPSHOT_ITEMS_REQUIRED/i);
  assert.match(legacyFreeze, /public\.freeze_feature_snapshot\(/i);
});

test("repair keeps planning-feature mutation RPC-only and limits collaboration deletes to staff-owned authority", () => {
  const source = repairStatements().join("\n");
  assert.match(source, /revoke\s+delete\s+on\s+table\s+public\.planning_features\s+from\s+authenticated/i);
  assert.doesNotMatch(source, /create\s+policy\s+context_rows_delete\s+on\s+public\.planning_features/i);
  for (const table of ["community_tasks", "object_photos", "object_comments", "object_attribute_edits"]) {
    assert.match(source, new RegExp(`create\\s+policy\\s+context_rows_delete\\s+on\\s+public\\.${table}[\\s\\S]*?current_profile_role\\(\\)\\s+in`, "i"));
  }
});

test("repair requires course membership or staff for contextual geoprocessing submission", () => {
  const submit = functionStatement(repairStatements(), "submit_geoprocessing_run");
  assert.match(submit, /PROJECT_ACCESS_REQUIRED/i);
  assert.match(submit, /public\.group_memberships/i);
  assert.match(submit, /membership\.course_id\s*=\s*p_course_id/i);
  assert.match(submit, /membership\.student_key\s*=\s*public\.current_profile_student_key\(\)/i);
});

test("freeze overloads preserve service-role execution while authenticated callers remain staff-gated", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  const contextual = functionStatement(statements, "freeze_feature_snapshot");
  const legacy = legacyFunctionStatement(statements, "freeze_feature_snapshot");
  const serviceRoleCheck = functionStatement(statements, "is_service_role_request");

  assert.match(serviceRoleCheck, /auth\.role\(\)[\s\S]*?'service_role'/i);
  assert.match(contextual, /v_is_service_role\s+boolean\s*:=\s*public\.is_service_role_request\(\)/i);
  assert.match(contextual, /if\s+not\s+v_is_service_role[\s\S]*?auth\.uid\(\)\s+is\s+null[\s\S]*?STAFF_REQUIRED/i);
  assert.match(contextual, /if\s+v_is_service_role[\s\S]*?assert_feature_space_exists/i);
  assert.match(legacy, /resolve_legacy_feature_context/i);
  for (const signature of [
    "text,uuid,uuid,text,text,text,text,jsonb",
    "text,text,text,text,text,jsonb"
  ]) {
    assert.match(source, new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+public\\.freeze_feature_snapshot\\(${signature}\\)\\s+to\\s+service_role`,
      "i"
    ));
    assert.match(source, new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+public\\.freeze_feature_snapshot\\(${signature}\\)\\s+to\\s+authenticated`,
      "i"
    ));
  }
});

test("legacy copy ownership is explicit, owner-only, and ambiguous copies remain staff archives", () => {
  const statements = repairStatements();
  const source = statements.join("\n");
  const accessible = latestFunctionStatement(statements, "context_space_accessible");
  const owned = functionStatement(statements, "legacy_personal_space_owned");

  assert.match(source, /insert\s+into\s+public\.legacy_personal_space_scopes/i);
  assert.match(source, /case\s+when\s+count\(profile\.id\)\s*=\s*1[\s\S]*?'owned'[\s\S]*?'archival'/i);
  assert.match(owned, /scope\.owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(owned, /scope\.ownership_status\s*=\s*'owned'/i);
  assert.match(accessible, /public\.legacy_personal_space_scopes/i);
  assert.match(accessible, /scope\.owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(accessible, /scope\.ownership_status\s*=\s*'archival'[\s\S]*?current_profile_role\(\)\s+in\s*\(\s*'teacher'\s*,\s*'admin'\s*\)/i);
  assert.doesNotMatch(accessible, /scope\.owner_id\s+is\s+null[\s\S]*?current_profile_student_key/i);
});

test("the existing direct copy persistence paths are restored only for the mapped owner", () => {
  const statements = repairStatements();
  const source = statements.join("\n");

  assert.match(appSource, /from\(PLANNING_SPACES_TABLE\)[\s\S]*?\.upsert\(rows,\s*\{\s*onConflict:\s*"id"\s*\}\)/i);
  assert.match(featureDbSource, /from\(deps\.PLANNING_FEATURES_TABLE\)[\s\S]*?\.upsert\(payload/i);
  assert.match(copySeedSource, /from\(tableName\)[\s\S]*?\.upsert\(chunk/i);

  assert.match(source, /create\s+trigger\s+trg_prepare_legacy_personal_planning_space/i);
  assert.match(source, /grant\s+insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.planning_spaces\s+to\s+authenticated/i);
  for (const action of ["insert", "update", "delete"]) {
    assert.match(latestPolicyStatement(statements, "planning_spaces", action), /legacy_personal_space_owned/i);
  }
  assert.match(source, /grant\s+insert\s*,\s*update\s+on\s+table\s+public\.planning_features\s+to\s+authenticated/i);
  for (const action of ["insert", "update"]) {
    const policy = latestPolicyStatement(statements, "planning_features", action);
    assert.match(policy, /legacy_personal_space_owned/i);
    assert.doesNotMatch(policy, /context_space_mutable/i);
  }
  assert.doesNotMatch(source, /grant\s+delete\s+on\s+table\s+public\.planning_features\s+to\s+authenticated/i);
});

test("collaboration insert and update policies require a mutable, not merely readable, context", () => {
  const statements = repairStatements();
  for (const table of ["community_tasks", "object_photos", "object_comments", "object_attribute_edits"]) {
    for (const action of ["insert", "update"]) {
      const policy = latestPolicyStatement(statements, table, action);
      assert.match(policy, /context_space_mutable/i, `${table} ${action} must require mutable context`);
      assert.doesNotMatch(policy, /context_space_accessible/i, `${table} ${action} must not accept read-only context`);
    }
  }
});

test("legacy Minecraft bridge tables enable RLS without reopening anonymous access", () => {
  const source = repairStatements().join("\n");
  for (const table of ["mc_sync_config", "mc_building_state"]) {
    assert.match(source, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"));
    assert.match(source, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public\\s*,\\s*anon`, "i"));
  }
  assert.match(source, /create\s+policy\s+mc_sync_config_authenticated_read[\s\S]*?to\s+authenticated[\s\S]*?using\s*\(true\)/i);
  assert.match(source, /create\s+policy\s+mc_building_state_authenticated_write[\s\S]*?to\s+authenticated[\s\S]*?auth\.uid\(\)\s+is\s+not\s+null/i);
});

test("unscoped legacy collaboration and activity rows are archived and trigger helpers are not callable", () => {
  const source = repairStatements().join("\n");
  for (const table of ["object_photos", "object_comments", "activity_events"]) {
    assert.match(source, new RegExp(`update\\s+public\\.${table}[\\s\\S]*?v_legacy_scope`, "i"));
  }
  assert.match(source, /revoke\s+all\s+on\s+function\s+public\.prepare_legacy_personal_planning_space\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(source, /revoke\s+all\s+on\s+function\s+public\.prepare_legacy_personal_planning_feature\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(source, /revoke\s+all\s+on\s+function\s+public\.context_space_mutable\(uuid\s*,\s*uuid\s*,\s*text\)\s+from\s+public\s*,\s*anon/i);
});
