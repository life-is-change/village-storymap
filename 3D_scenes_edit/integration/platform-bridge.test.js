const test = require("node:test");
const assert = require("node:assert/strict");
const Bridge = require("./platform-bridge");

function state(overrides = {}) {
  return {
    activeView: "plan",
    user: { id: "user-1", name: "学生甲" },
    role: "student",
    teachingProjectId: "tp-1", courseId: "course-1", villageId: "village-1",
    group: { id: "group-1" }, space: { id: "ui-space", actualSpaceId: "space-1", title: "小组空间", baselineRevision: 3 },
    baselineFeatures: [{ live: true, get: (key) => key === "layerKey" ? "building" : undefined }],
    serializeFeature: (feature) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[114, 30], [114.01, 30], [114, 30]]] }, properties: { layerKey: feature.get("layerKey"), name: "现状建筑" } }),
    ...overrides
  };
}

test("builds a stable studio context without leaking live OpenLayers features", () => {
  const result = Bridge.buildSceneEditContext(state());
  assert.equal(result.ok, true);
  assert.equal(result.context.userId, "user-1");
  assert.equal(result.context.groupId, "group-1");
  assert.equal(result.context.scopeKind, "group");
  assert.equal(result.context.ownerId, "user-1");
  assert.equal(result.context.spaceId, "space-1");
  assert.equal(result.context.baselineRevision, 3);
  assert.deepEqual(result.context.baselineFeatures[0], { layerKey: "building", geometry: { type: "Polygon", coordinates: [[[114, 30], [114.01, 30], [114, 30]]] }, properties: { layerKey: "building", name: "现状建筑" } });
  assert.notEqual(result.context.baselineFeatures[0], state().baselineFeatures[0]);
});

test("administrator without a group receives an isolated sandbox context", () => {
  const result = Bridge.buildSceneEditContext(state({
    activeView: "model3d",
    role: "admin",
    user: { id: "admin-1", name: "管理员" },
    group: null,
    space: { id: "shared", actualSpaceId: "shared", title: "全班共享现状", baselineRevision: 5 }
  }));
  assert.equal(result.ok, true);
  assert.equal(result.context.scopeKind, "admin_sandbox");
  assert.equal(result.context.groupId, null);
  assert.equal(result.context.ownerId, "admin-1");
  assert.equal(result.context.spaceId, "shared");
});

test("student without a group is still rejected", () => {
  assert.equal(Bridge.buildSceneEditContext(state({ role: "student", group: null })).code, "GROUP_REQUIRED");
});

test("refuses launch from overview or without a signed-in group space", () => {
  assert.equal(Bridge.buildSceneEditContext(state({ activeView: "overview" })).code, "OVERVIEW_ACTIVE");
  assert.equal(Bridge.buildSceneEditContext(state({ user: null })).code, "USER_REQUIRED");
  assert.equal(Bridge.buildSceneEditContext(state({ group: null })).code, "GROUP_REQUIRED");
  assert.equal(Bridge.buildSceneEditContext(state({ space: null })).code, "SPACE_REQUIRED");
});

test("opens, closes and resynchronizes one scoped studio instance", async () => {
  const calls = [];
  const focusChanges = [];
  const mount = { hidden: true };
  const studioApi = { async create(options) { calls.push(["create", options.context.spaceId]); return { ok: true, dispose() { calls.push("dispose"); } }; } };
  const bridge = Bridge.createPlatformBridge({ studioApi, mount, readState: () => state(), buildOptions: (context) => ({ root: mount, context }), onFocusChange: (active) => focusChanges.push(active) });
  assert.equal((await bridge.open()).ok, true);
  assert.equal(mount.hidden, false);
  assert.deepEqual(focusChanges, [true]);
  assert.equal((await bridge.sync()).changed, false);
  assert.equal((await bridge.sync(state({ space: { id: "other", actualSpaceId: "space-2", baselineRevision: 1 } }))).changed, true);
  assert.deepEqual(calls, [["create", "space-1"], "dispose", ["create", "space-2"]]);
  bridge.close();
  assert.equal(mount.hidden, true);
  assert.equal(calls.at(-1), "dispose");
  assert.equal(focusChanges.at(-1), false);
});

test("failed studio startup leaves focus mode and restores the workspace", async () => {
  const focusChanges = [];
  const mount = { hidden: true };
  const bridge = Bridge.createPlatformBridge({
    mount, readState: () => state(), buildOptions: (context) => ({ context }),
    studioApi: { async create() { throw new Error("startup failed"); } },
    onFocusChange: (active) => focusChanges.push(active)
  });

  const result = await bridge.open();

  assert.equal(result.ok, false);
  assert.equal(mount.hidden, true);
  assert.deepEqual(focusChanges, [true, false]);
});
