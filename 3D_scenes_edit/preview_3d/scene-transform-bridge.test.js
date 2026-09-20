const test = require("node:test");
const assert = require("node:assert/strict");
const Commands = require("../domain/scene-commands");
const SceneDocument = require("../domain/scene-document");
const { createSceneTransformBridge } = require("./scene-transform-bridge");

function fixture() {
  const document = SceneDocument.create({ projectId: "p", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 1 });
  document.objects.push({ id: "bench", kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114, 30] }, properties: { materialRef: "old" }, layerId: "design", groupId: null, zIndex: 0, transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 } });
  document.objects.push({ id: "path", kind: "line", category: "path", geometry: { type: "LineString", coordinates: [[114, 30], [114.001, 30]] }, properties: { widthM: 1 }, layerId: "design", groupId: null, zIndex: 1 });
  return document;
}

test("3D fine tuning changes transforms and properties while preserving 2D geometry", () => {
  let history = Commands.createHistory(fixture());
  const originalGeometry = structuredClone(history.present.objects[0].geometry);
  const bridge = createSceneTransformBridge({ getHistory: () => history, setHistory: (next) => { history = next; } });
  assert.equal(bridge.update("bench", { heightOffsetM: 2, scaleZ: 1.5, pitchDeg: 10, rollDeg: -4, materialRef: "wood" }).ok, true);
  const bench = history.present.objects[0];
  assert.deepEqual(bench.geometry, originalGeometry);
  assert.deepEqual(bench.transform.scale, [1, 1, 1.5]);
  assert.equal(bench.transform.heightOffsetM, 2);
  assert.equal(bench.transform.pitchDeg, 10);
  assert.equal(bench.properties.materialRef, "wood");
  history = Commands.undo(history);
  assert.equal(history.present.objects[0].transform.heightOffsetM, 0);
});

test("3D delegates shared actions and rejects line or polygon vertex editing", () => {
  const calls = [];
  const bridge = createSceneTransformBridge({ actions: { moveXY: (...v) => calls.push(["moveXY", ...v]), yaw: (...v) => calls.push(["yaw", ...v]), scaleXY: (...v) => calls.push(["scaleXY", ...v]), duplicate: (...v) => calls.push(["duplicate", ...v]), remove: (...v) => calls.push(["remove", ...v]), group: (...v) => calls.push(["group", ...v]) } });
  bridge.moveXY("bench", [114.1, 30.1]); bridge.yaw("bench", 30); bridge.scaleXY("bench", 2); bridge.duplicate(["bench"]); bridge.remove(["bench"]); bridge.group(["bench", "other"]);
  assert.equal(calls.length, 6);
  assert.deepEqual(bridge.editVertices({ id: "path", kind: "line" }), { ok: false, code: "EDIT_IN_2D", message: "请在二维视图中编辑线或面的节点" });
});
