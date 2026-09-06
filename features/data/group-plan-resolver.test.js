const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveSparsePlan,
  canEditGroupLayer,
  normalizeResolvedFeature,
  createGroupPlanLoader
} = require("./group-plan-resolver.js");

test("sparse group overrides replace hide and append baseline objects", () => {
  const result = resolveSparsePlan({
    baselineItems: [
      { layer_key: "building", object_code: "B1", geom: { type: "Polygon" }, props: { height: 9 } },
      { layer_key: "road", object_code: "R1", geom: { type: "LineString" }, props: {} }
    ],
    overrides: [
      { operation_kind: "updated", layer_key: "building", base_object_code: "B1", object_code: "B1", geom: { type: "Polygon" }, props: { height: 12 }, feature_revision: 1 },
      { operation_kind: "deleted", layer_key: "road", base_object_code: "R1", object_code: "R1", geom: {}, props: {}, feature_revision: 1 },
      { operation_kind: "added", layer_key: "water", object_code: "GW1", geom: { type: "Polygon" }, props: {}, feature_revision: 1 }
    ]
  });

  assert.deepEqual(result.map((row) => [row.layer_key, row.object_code]), [
    ["building", "B1"],
    ["water", "GW1"]
  ]);
  assert.equal(result[0].props.height, 12);
  assert.equal(result[0].source, "group_override");
});

test("shared loader resolves one group-plan context once for 2D and 3D", async () => {
  const calls = [];
  const client = { async rpc(name, payload) {
    calls.push({ name, payload });
    return { data: [
      { layer_key: "building", object_code: "B1", props: { height: 9 }, feature_revision: 0 },
      { layer_key: "road", object_code: "R1", props: {}, feature_revision: 2 }
    ], error: null };
  } };
  const loader = createGroupPlanLoader({ client });
  const context = { teachingProjectId: "p1", villageId: "v1", spaceId: "s1" };
  const first = await loader.load(context);
  const second = await loader.load(context);
  assert.equal(calls.length, 1);
  assert.deepEqual(first, second);
  assert.equal(loader.forLayer(first, "building")[0].feature_revision, 0);
  assert.deepEqual(calls[0].payload, {
    p_teaching_project_id: "p1", p_village_id: "v1", p_space_id: "s1", p_layer_key: null
  });
  loader.invalidate("s1");
  await loader.load(context);
  assert.equal(calls.length, 2);
});

test("shared loader rejects incomplete context", async () => {
  const loader = createGroupPlanLoader({ client: { rpc() { throw new Error("must not run"); } } });
  await assert.rejects(() => loader.load({ villageId: "v1", spaceId: "s1" }), /GROUP_PLAN_CONTEXT_REQUIRED/);
});

test("latest revision wins for the same group object", () => {
  const result = resolveSparsePlan({
    baselineItems: [{ layer_key: "building", object_code: "B1", geom: {}, props: { height: 9 } }],
    overrides: [
      { operation_kind: "updated", layer_key: "building", base_object_code: "B1", object_code: "B1", geom: {}, props: { height: 12 }, feature_revision: 2, updated_at: "2026-09-06T10:00:00Z" },
      { operation_kind: "updated", layer_key: "building", base_object_code: "B1", object_code: "B1", geom: {}, props: { height: 15 }, feature_revision: 3, updated_at: "2026-09-06T09:00:00Z" }
    ]
  });
  assert.equal(result[0].props.height, 15);
  assert.equal(result[0].feature_revision, 3);
});

test("only building road and water are editable in group plan", () => {
  assert.equal(canEditGroupLayer("building"), true);
  assert.equal(canEditGroupLayer("road"), true);
  assert.equal(canEditGroupLayer("water"), true);
  assert.equal(canEditGroupLayer("contours"), false);
  assert.equal(canEditGroupLayer("imagery"), false);
  assert.equal(canEditGroupLayer("boundary"), false);
});

test("unknown sparse operation is rejected instead of silently displayed", () => {
  assert.throws(() => resolveSparsePlan({
    baselineItems: [],
    overrides: [{ operation_kind: "copy", layer_key: "building", object_code: "B1" }]
  }), /GROUP_OVERRIDE_OPERATION_INVALID/);
});

test("server rows normalize to one stable browser shape", () => {
  assert.deepEqual(normalizeResolvedFeature({
    layer_key: "building", object_code: "B1", geom: {}, props: { height: 9 },
    source: "baseline", operation_kind: null, feature_revision: "0"
  }), {
    layerKey: "building", objectCode: "B1", geometry: {}, properties: { height: 9 },
    source: "baseline", operationKind: null, featureRevision: 0
  });
});
