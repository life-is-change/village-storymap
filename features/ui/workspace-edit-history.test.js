const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const geometrySource = fs.readFileSync(path.join(root, "features/map-editing/geometry-editor.js"), "utf8");
const clickSource = fs.readFileSync(path.join(root, "features/map-editing/map-click-handler.js"), "utf8");
const panelSource = fs.readFileSync(path.join(root, "features/ui/space-panel.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const sqlSource = fs.readFileSync(path.join(root, "supabase_SQL/Shared Current Survey Versioning and Feature Locks.sql"), "utf8");

test("space tools keep an explicit draft save area visible", () => {
  assert.match(geometrySource, /id="geometryDraftSummary"/);
  assert.match(geometrySource, /id="btnSaveBuildingGeom">保存编辑/);
  assert.doesNotMatch(geometrySource, /saveRow\?\.classList\.toggle\("is-visible", isEditing\)/);
});

test("editing acquires object locks instead of a whole-space lock", () => {
  assert.match(clickSource, /acquireFeatureEditLock/);
  assert.match(clickSource, /releaseFeatureEditLock/);
  assert.doesNotMatch(geometrySource, /checkBaseSpaceEditLock/);
});

test("project settings hide V0 behind version management", () => {
  assert.match(panelSource, /版本管理/);
  assert.match(panelSource, /查看初始版本/);
  assert.match(panelSource, /版本对比/);
  assert.doesNotMatch(panelSource, /<option[^>]*>系统初始现状 V0/);
});

test("V0 comparison uses the complete original static vectors, not sparse database overrides", () => {
  const baselineViewer = appSource.match(
    /async function toggleInitialBaseline\([\s\S]*?(?=\nasync function freezeCurrentSnapshot)/
  )?.[0] || "";
  assert.match(baselineViewer, /EDITABLE_GEOMETRY_LAYERS\.map\(\(layerKey\) => ensureLayerLoaded\(layerKey\)\)/);
  assert.match(baselineViewer, /layerDataCache\[layerKey\]/);
  assert.doesNotMatch(baselineViewer, /listSnapshotItems/);
});

test("published snapshots merge original vectors with current database overrides", () => {
  const collector = appSource.match(
    /async function collectCompleteCurrentVersionItems\([\s\S]*?(?=\nfunction buildGeometryEditorDeps)/
  )?.[0] || "";
  assert.match(collector, /EDITABLE_GEOMETRY_LAYERS/);
  assert.match(collector, /ensureLayerLoaded/);
  assert.match(collector, /listDeletedLayerFeatureCodesFromDb/);
  assert.match(sqlSource, /p_items jsonb default '\[\]'::jsonb/);
  assert.match(sqlSource, /jsonb_array_elements\(p_items\)/);
});

test("database migration defines feature locks, edit history and snapshots", () => {
  for (const name of [
    "feature_edit_locks",
    "feature_change_batches",
    "feature_versions",
    "feature_snapshots",
    "feature_snapshot_items",
    "acquire_feature_edit_lock",
    "save_feature_edit_batch",
    "freeze_feature_snapshot"
  ]) {
    assert.match(sqlSource, new RegExp(name));
  }
});

test("database save rejects updates without a live object lock", () => {
  assert.match(sqlSource, /change_action <> 'add' and not exists/);
  assert.match(sqlSource, /and editor_name = p_editor_name/);
  assert.match(sqlSource, /and expires_at > now\(\)/);
  assert.match(sqlSource, /raise exception 'feature lock required/);
});

test("course activity records only database-confirmed geometry saves", () => {
  const saveWrapper = appSource.match(
    /async function saveDirtyBuildings\([\s\S]*?(?=\nfunction getGeoJSONFeatures)/
  )?.[0] || "";
  assert.match(saveWrapper, /if \(result\?\.success\)/);
  assert.match(saveWrapper, /batchId: result\.batchId/);
});
