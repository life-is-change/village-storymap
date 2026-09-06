const test = require("node:test");
const assert = require("node:assert/strict");

const model = require("./survey-review-model.js");

test("normalizes database and domain review rows into one stable shape", () => {
  assert.deepEqual(model.normalizeReviewRow({
    layer_key: " building ",
    object_code: " B-1 ",
    is_v0_baseline: true,
    geometry_status: "modified",
    geometry_revision: "3",
    is_deleted: false,
    latest_modified_at: "2026-09-04T01:00:00Z"
  }), {
    layerKey: "building",
    objectCode: "B-1",
    isV0Baseline: true,
    geometryStatus: "modified",
    geometryRevision: 3,
    isDeleted: false,
    latestModifiedBy: "",
    latestModifiedAt: "2026-09-04T01:00:00Z"
  });
});

test("keeps the V0 denominator fixed and excludes removed additions from current objects", () => {
  const rows = [
    { layer_key: "building", object_code: "B1", is_v0_baseline: true, geometry_status: "confirmed_unchanged" },
    { layer_key: "building", object_code: "B2", is_v0_baseline: true, geometry_status: "deleted", is_deleted: true },
    { layer_key: "road", object_code: "R1", is_v0_baseline: true, geometry_status: "pending" },
    { layer_key: "water", object_code: "W9", is_v0_baseline: false, geometry_status: "added" },
    { layer_key: "road", object_code: "R9", is_v0_baseline: false, geometry_status: "added", is_deleted: true }
  ];

  assert.deepEqual(model.buildSurveyProgress(rows), {
    baselineTotal: 3,
    reviewedBaseline: 2,
    confirmedUnchanged: 1,
    modified: 0,
    deleted: 1,
    added: 2,
    removedAdditions: 1,
    currentActive: 3,
    byLayer: {
      building: { baselineTotal: 2, reviewedBaseline: 2 },
      road: { baselineTotal: 1, reviewedBaseline: 0 },
      water: { baselineTotal: 0, reviewedBaseline: 0 }
    }
  });
});

test("unlocks downstream work only for active reviewed objects", () => {
  assert.equal(model.canUseDownstreamActions({ geometry_status: "pending" }), false);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "confirmed_unchanged" }), true);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "modified" }), true);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "added" }), true);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "deleted", is_deleted: true }), false);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "added", is_deleted: true }), false);
});

test("focus mode dims reviewed objects without hiding them", () => {
  assert.deepEqual(
    model.getSurveyFeatureStyle({ geometry_status: "pending" }, { focusPending: true }),
    { opacity: 1, emphasis: "pending", hidden: false }
  );
  assert.deepEqual(
    model.getSurveyFeatureStyle({ geometry_status: "modified" }, { focusPending: true }),
    { opacity: 0.18, emphasis: "none", hidden: false }
  );
  assert.deepEqual(
    model.getSurveyFeatureStyle({ geometry_status: "modified" }, { focusPending: false }),
    { opacity: 1, emphasis: "none", hidden: false }
  );
});

test("ignores rows outside the three survey layers", () => {
  const progress = model.buildSurveyProgress([
    { layer_key: "contours", object_code: "C1", is_v0_baseline: true, geometry_status: "pending" },
    { layer_key: "cropland", object_code: "F1", is_v0_baseline: true, geometry_status: "modified" }
  ]);
  assert.equal(progress.baselineTotal, 0);
  assert.equal(progress.currentActive, 0);
});

