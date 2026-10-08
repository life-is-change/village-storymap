const test = require("node:test");
const assert = require("node:assert/strict");

const SceneDocument = require("./scene-document");
const Commands = require("./scene-commands");

function point(id, lon, lat) {
  return {
    id,
    kind: "asset",
    category: "bench",
    geometry: { type: "Point", coordinates: [lon, lat] },
    transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 },
    properties: {},
    layerId: "design"
  };
}

function historyWith(objects = []) {
  const doc = SceneDocument.create({ projectId: "p", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 1 });
  doc.objects = objects;
  return Commands.createHistory(doc, { limit: 3 });
}

test("add, update, delete, undo and redo are immutable", () => {
  const original = historyWith();
  const added = Commands.execute(original, { type: "addObject", object: point("a", 114, 30) });
  const updated = Commands.execute(added, { type: "updateObject", id: "a", patch: { transform: { headingDeg: 45 } } });
  const removed = Commands.execute(updated, { type: "deleteObjects", ids: ["a"] });

  assert.equal(original.present.objects.length, 0);
  assert.equal(updated.present.objects[0].transform.headingDeg, 45);
  assert.equal(updated.present.objects[0].transform.scale[0], 1);
  assert.equal(removed.present.objects.length, 0);
  assert.equal(Commands.undo(removed).present.objects[0].transform.headingDeg, 45);
  assert.equal(Commands.redo(Commands.undo(removed)).present.objects.length, 0);
});

test("a new command clears redo and history respects its limit", () => {
  let history = historyWith();
  for (const id of ["a", "b", "c", "d"]) history = Commands.execute(history, { type: "addObject", object: point(id, 114, 30) });
  assert.equal(history.past.length, 3);
  history = Commands.undo(history);
  assert.equal(history.future.length, 1);
  history = Commands.execute(history, { type: "deleteObjects", ids: ["a"] });
  assert.equal(history.future.length, 0);
});

test("duplicates and groups receive explicit fresh ids", () => {
  let history = historyWith([point("a", 114, 30)]);
  history = Commands.execute(history, {
    type: "duplicateObjects",
    ids: ["a"],
    idMap: { a: "a-copy" },
    coordinateOffset: [0.00001, 0.00002]
  });
  history = Commands.execute(history, {
    type: "groupObjects",
    ids: ["a", "a-copy"],
    group: { id: "group-1", name: "座椅组" }
  });
  assert.deepEqual(history.present.objects[1].geometry.coordinates, [114.00001, 30.00002]);
  assert.equal(history.present.objects[0].groupId, "group-1");
  assert.equal(history.present.groups.length, 1);
  history = Commands.execute(history, { type: "ungroupObjects", groupId: "group-1" });
  assert.equal(history.present.objects[0].groupId, null);
  assert.equal(history.present.groups.length, 0);
});

test("align and distribute point objects deterministically", () => {
  let history = historyWith([point("a", 114, 30), point("b", 114.00003, 30.00002), point("c", 114.00001, 30.00004)]);
  history = Commands.execute(history, { type: "alignObjects", ids: ["a", "b", "c"], axis: "left" });
  assert.deepEqual(history.present.objects.map((item) => item.geometry.coordinates[0]), [114, 114, 114]);

  history = Commands.execute(history, { type: "updateObject", id: "b", patch: { geometry: { type: "Point", coordinates: [114.00003, 30.00002] } } });
  history = Commands.execute(history, { type: "updateObject", id: "c", patch: { geometry: { type: "Point", coordinates: [114.00001, 30.00004] } } });
  history = Commands.execute(history, { type: "distributeObjects", ids: ["a", "b", "c"], axis: "horizontal" });
  const longitudes = history.present.objects.map((item) => item.geometry.coordinates[0]);
  assert.deepEqual(longitudes.slice(0, 2), [114, 114.00003]);
  assert.ok(Math.abs(longitudes[2] - 114.000015) < 1e-12);
});

test("3D-only updates preserve serialized 2D geometry", () => {
  let history = historyWith([point("a", 114, 30)]);
  const geometry = JSON.stringify(history.present.objects[0].geometry);
  history = Commands.execute(history, {
    type: "updateObject",
    id: "a",
    patch: { transform: { heightOffsetM: 2, pitchDeg: 5, rollDeg: -3 }, properties: { materialRef: "student:wood" } }
  });
  assert.equal(JSON.stringify(history.present.objects[0].geometry), geometry);
});

test("reorders layers and rejects unknown commands", () => {
  let history = historyWith();
  history = Commands.execute(history, { type: "addLayer", layer: { id: "planting", name: "种植", visible: true, locked: false } });
  history = Commands.execute(history, { type: "reorderLayer", layerId: "planting", order: 0 });
  assert.deepEqual(history.present.layers.map((layer) => layer.id), ["planting", "design"]);
  assert.throws(() => Commands.execute(history, { type: "explode" }), /Unknown scene command/);
});

test("deleting a user layer preserves its objects by moving them to the default layer", () => {
  let history = historyWith([point("a", 114, 30)]);
  history = Commands.execute(history, { type: "addLayer", layer: { id: "furniture", name: "家具" } });
  history = Commands.execute(history, { type: "updateObject", id: "a", patch: { layerId: "furniture" } });
  history = Commands.execute(history, { type: "deleteLayer", layerId: "furniture" });
  assert.deepEqual(history.present.layers.map((layer) => layer.id), ["design"]);
  assert.equal(history.present.objects[0].layerId, "design");
  assert.throws(() => Commands.execute(history, { type: "deleteLayer", layerId: "design" }), /default layer/i);
});
