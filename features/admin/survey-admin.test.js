const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("./survey-admin.js");

test("normalizes dashboard and preserves mixed progress", () => {
  assert.deepEqual(admin.normalizeSurveyDashboard({
    baseline_total: 380, reviewed_baseline: 126, added: 8, deleted: 3, current_active: 385
  }), {
    baselineTotal: 380, reviewedBaseline: 126, added: 8, deleted: 3, currentActive: 385
  });
});

test("feature filters never create assignment semantics", () => {
  assert.deepEqual(admin.buildSurveyFeatureFilters({ layer: "building", status: "pending", actorId: "u1" }), {
    layerKey: "building", geometryStatus: "pending", actorId: "u1"
  });
});

test("resolves only the bound formal village shared space", () => {
  assert.deepEqual(admin.resolveFormalSharedContext({
    project: { id: "p1", formalVillageId: "v2" },
    villages: [{ id: "v1", name: "练习村" }, { id: "v2", name: "正式村" }],
    spaces: [
      { id: "personal", villageId: "v2", spaceType: "formal_personal" },
      { id: "shared", villageId: "v2", spaceType: "formal_shared" }
    ]
  }), {
    teachingProjectId: "p1", villageId: "v2", spaceId: "shared",
    projectName: "", villageName: "正式村"
  });
  assert.equal(admin.resolveFormalSharedContext({ project: { id: "p1", formalVillageId: null } }), null);
});

test("controller requests dashboard in an explicit project context", async () => {
  const calls = [];
  const controller = admin.createSurveyAdminController({
    supabaseClient: { rpc: async (name, args) => (calls.push({ name, args }), { data: {}, error: null }) }
  });
  await controller.loadDashboard({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1" });
  assert.equal(calls[0].name, "get_shared_survey_dashboard");
  assert.equal(calls[0].args.p_space_id, "s1");
});

test("controller lists features with layer status and actor filters only", async () => {
  const calls = [];
  const controller = admin.createSurveyAdminController({
    supabaseClient: { rpc: async (name, args) => (calls.push({ name, args }), { data: [], error: null }) }
  });
  await controller.listFeatures({
    teachingProjectId: "p1", villageId: "v1", spaceId: "s1",
    layer: "road", status: "pending", actorId: "u1"
  });
  assert.deepEqual(calls[0], {
    name: "list_shared_survey_features",
    args: {
      p_teaching_project_id: "p1", p_village_id: "v1", p_space_id: "s1",
      p_layer_key: "road", p_geometry_status: "pending", p_actor_id: "u1"
    }
  });
});

test("controller freezes from server facts without accepting item payloads", async () => {
  const calls = [];
  const controller = admin.createSurveyAdminController({
    supabaseClient: { rpc: async (name, args) => (calls.push({ name, args }), { data: { snapshotId: "s1" }, error: null }) }
  });
  await controller.freezeSnapshot({
    teachingProjectId: "p1", villageId: "v1", spaceId: "shared",
    versionName: "V1", description: "阶段冻结", recommendedForGroups: true,
    items: ["ignored"]
  });
  assert.equal(calls[0].name, "freeze_shared_survey_snapshot");
  assert.equal("p_items" in calls[0].args, false);
});

test("photo deletion checks immutable snapshot references before storage removal", async () => {
  const calls = [];
  const result = await admin.assertPhotoDeletable({
    rpc: async (name, args) => (calls.push({ name, args }), { data: true, error: null })
  }, 42);
  assert.equal(result, true);
  assert.deepEqual(calls[0], { name: "assert_survey_photo_deletable", args: { p_photo_id: 42 } });
});
