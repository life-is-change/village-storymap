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
