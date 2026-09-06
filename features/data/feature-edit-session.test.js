const test = require("node:test");
const assert = require("node:assert/strict");

const session = require("./feature-edit-session.js");

test("summarizeChanges groups added updated and deleted features by layer", () => {
  const result = session.summarizeChanges([
    { layerKey: "building", action: "update" },
    { layerKey: "building", action: "update" },
    { layerKey: "road", action: "add" },
    { layerKey: "cropland", action: "delete" }
  ]);

  assert.equal(result.total, 4);
  assert.equal(result.text, "修改建筑 2 个、新增道路 1 条、删除农田 1 块");
});

test("buildLockTarget uses space layer and object code without locking the whole space", () => {
  assert.deepEqual(
    session.buildLockTarget("current", "building", "H002"),
    { spaceId: "current", layerKey: "building", objectCode: "H002" }
  );
  assert.equal(session.buildLockTarget("current", "building", ""), null);
});

test("canFreezeSnapshot allows administrators and future teachers only", () => {
  assert.equal(session.canFreezeSnapshot("admin"), true);
  assert.equal(session.canFreezeSnapshot("teacher"), true);
  assert.equal(session.canFreezeSnapshot("student"), false);
  assert.equal(session.canFreezeSnapshot(""), false);
});

test("lock lease constants keep abandoned locks short-lived", () => {
  assert.equal(session.LOCK_LEASE_SECONDS, 90);
  assert.equal(session.LOCK_HEARTBEAT_MS, 30000);
});

test("saveFeatureEditBatch preserves per-change revision and lock evidence", async () => {
  let rpcCall = null;
  const changes = [{
    layerKey: "road",
    objectCode: "R1",
    action: "update",
    expectedGeometryRevision: 2,
    lockToken: "11111111-1111-4111-8111-111111111111"
  }];
  const deps = {
    getContext: () => ({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1" }),
    getSupabaseClient: () => ({
      rpc: async (name, args) => {
        rpcCall = { name, args };
        return { data: "batch-1", error: null };
      }
    })
  };

  assert.deepEqual(await session.saveFeatureEditBatch(deps, {
    editorName: "仅供显示",
    summary: "修改道路",
    changes
  }), { success: true, batchId: "batch-1" });
  assert.equal(rpcCall.name, "save_feature_edit_batch");
  assert.deepEqual(rpcCall.args.p_changes, changes);
});

test("freezeSurveySnapshot asks the server to collect facts without client items", async () => {
  let rpcCall = null;
  const deps = {
    getContext: () => ({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1" }),
    getSupabaseClient: () => ({
      rpc: async (name, args) => (rpcCall = { name, args }, { data: { snapshotId: "snap-1" }, error: null })
    })
  };
  const result = await session.freezeSurveySnapshot(deps, {
    versionName: "V1 第一次现场校核", description: "课堂冻结", recommendedForGroups: true,
    items: [{ objectCode: "must-not-leave-browser" }]
  });
  assert.equal(rpcCall.name, "freeze_shared_survey_snapshot");
  assert.equal("p_items" in rpcCall.args, false);
  assert.equal(rpcCall.args.p_recommended_for_groups, true);
  assert.deepEqual(result, { snapshotId: "snap-1" });
});

test("group plan save sends context and expected revisions to dedicated RPC", async () => {
  let rpcCall = null;
  const deps = {
    getContext: () => ({
      teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "group_plan"
    }),
    getSupabaseClient: () => ({
      rpc: async (name, args) => (rpcCall = { name, args }, { data: { saved: 1 }, error: null })
    })
  };
  const changes = [{
    layerKey: "building", action: "update", objectCode: "B1", baseObjectCode: "B1",
    expectedRevision: 2, lockToken: "11111111-1111-4111-8111-111111111111",
    afterGeom: { type: "Polygon", coordinates: [] }, afterProps: { height: 12 }
  }];

  assert.deepEqual(await session.saveGroupPlanEditBatch(deps, { editorName: "张三", changes }), {
    success: true, result: { saved: 1 }
  });
  assert.equal(rpcCall.name, "save_group_plan_edit_batch");
  assert.equal(rpcCall.args.p_changes[0].expectedRevision, 2);
  assert.equal("p_user_id" in rpcCall.args, false);
});

test("group plan save rejects readonly reference layers before calling Supabase", async () => {
  let called = false;
  const deps = {
    getContext: () => ({
      teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "group_plan"
    }),
    getSupabaseClient: () => ({ rpc: async () => (called = true, { data: null, error: null }) })
  };
  await assert.rejects(() => session.saveGroupPlanEditBatch(deps, {
    changes: [{ layerKey: "contours", action: "delete", objectCode: "C1", expectedRevision: 0 }]
  }), /GROUP_LAYER_READ_ONLY/);
  assert.equal(called, false);
});

test("group plan save requires explicit group plan context", async () => {
  const deps = {
    getContext: () => ({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "formal_shared" }),
    getSupabaseClient: () => ({ rpc: async () => ({ data: null, error: null }) })
  };
  await assert.rejects(() => session.saveGroupPlanEditBatch(deps, { changes: [] }), /GROUP_PLAN_SPACE_REQUIRED/);
});
