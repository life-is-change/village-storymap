const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSurveyProgress,
  canUseDownstreamActions
} = require("../survey/survey-review-model.js");
const { createSurveyReviewClient } = require("../survey/survey-review-client.js");

function createSharedSurveyHarness() {
  const rows = new Map([
    ["building:B1", { layer_key: "building", object_code: "B1", is_v0_baseline: true, geometry_status: "pending", geometry_revision: 0 }],
    ["building:B2", { layer_key: "building", object_code: "B2", is_v0_baseline: true, geometry_status: "pending", geometry_revision: 0 }]
  ]);
  const context = { teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "formal_shared" };
  let actor = "student-a";
  const client = createSurveyReviewClient({
    supabaseClient: {
      async rpc(name, args) {
        assert.equal(name, "confirm_survey_feature_geometry");
        const row = rows.get(`${args.p_layer_key}:${args.p_object_code}`);
        if (args.p_expected_revision !== row.geometry_revision) throw new Error("GEOMETRY_REVISION_CONFLICT");
        Object.assign(row, {
          geometry_status: "confirmed_unchanged",
          geometry_revision: row.geometry_revision + 1,
          latest_actor: actor
        });
        return { data: row, error: null };
      }
    },
    getContext: () => context
  });
  return {
    as(userId) {
      actor = userId;
      return {
        confirm(layerKey, objectCode, revision) {
          const row = rows.get(`${layerKey}:${objectCode}`);
          return client.confirmGeometry({
            layerKey, objectCode,
            expectedRevision: revision ?? row.geometry_revision,
            lockToken: "11111111-1111-4111-8111-111111111111"
          });
        },
        canUploadPhoto(layerKey, objectCode) {
          return canUseDownstreamActions(rows.get(`${layerKey}:${objectCode}`));
        }
      };
    },
    progress: () => buildSurveyProgress([...rows.values()])
  };
}

test("one student's confirmation unlocks that object for the whole class", async () => {
  const harness = createSharedSurveyHarness();
  await harness.as("student-a").confirm("building", "B1");
  assert.equal(harness.progress().reviewedBaseline, 1);
  assert.equal(harness.as("student-b").canUploadPhoto("building", "B1"), true);
  assert.equal(harness.as("student-b").canUploadPhoto("building", "B2"), false);
});

test("a stale geometry revision cannot overwrite a classmate's review", async () => {
  const harness = createSharedSurveyHarness();
  await harness.as("student-a").confirm("building", "B1", 0);
  await assert.rejects(
    () => harness.as("student-b").confirm("building", "B1", 0),
    /GEOMETRY_REVISION_CONFLICT/
  );
  assert.equal(harness.progress().reviewedBaseline, 1);
});

test("mixed progress keeps the V0 denominator fixed and additions separate", () => {
  const progress = buildSurveyProgress([
    { layer_key: "building", object_code: "B1", is_v0_baseline: true, geometry_status: "deleted" },
    { layer_key: "road", object_code: "R1", is_v0_baseline: true, geometry_status: "modified" },
    { layer_key: "water", object_code: "W1", is_v0_baseline: false, geometry_status: "added" }
  ]);
  assert.deepEqual({
    baselineTotal: progress.baselineTotal,
    reviewedBaseline: progress.reviewedBaseline,
    added: progress.added,
    deleted: progress.deleted,
    currentActive: progress.currentActive
  }, { baselineTotal: 2, reviewedBaseline: 2, added: 1, deleted: 1, currentActive: 2 });
});
