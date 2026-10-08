const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertChangesMatchSelections,
  withFeatureVersion
} = require("./personal-edit-version.js");

test("existing personal feature changes keep the version that was displayed", () => {
  const feature = { get: (key) => key === "personalLayerVersionId" ? "version-1" : undefined };
  assert.deepEqual(withFeatureVersion({ action: "delete", layerKey: "building" }, feature), {
    action: "delete",
    layerKey: "building",
    layerVersionId: "version-1"
  });
});

test("saving rejects a feature captured from a version that is no longer current", () => {
  assert.throws(() => assertChangesMatchSelections(
    [{ action: "delete", layerKey: "building", layerVersionId: "version-1" }],
    [{ layer_key: "building", current_version_id: "version-2" }]
  ), /PERSONAL_LAYER_VERSION_STALE/);
});

test("new personal features without a prior version use the current selection", () => {
  assert.doesNotThrow(() => assertChangesMatchSelections(
    [{ action: "add", layerKey: "building" }],
    [{ layer_key: "building", current_version_id: "version-2" }]
  ));
});

test("personal deletes always require the displayed layer version", () => {
  assert.throws(() => assertChangesMatchSelections(
    [{ action: "delete", layerKey: "building", objectCode: "H001" }],
    [{ layer_key: "building", current_version_id: "version-2" }]
  ), /PERSONAL_LAYER_VERSION_REQUIRED/);
});
