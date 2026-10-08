const test = require("node:test");
const assert = require("node:assert/strict");

const SceneDocument = require("../domain/scene-document");
const Commands = require("../domain/scene-commands");
const Geometry = require("../domain/geometry-rules");
const Editor = require("./scene-editor-controller");

function square(minLon = 114.3, minLat = 30.5, size = 0.001) {
  return { type: "Polygon", coordinates: [[[minLon, minLat], [minLon + size, minLat], [minLon + size, minLat + size], [minLon, minLat + size], [minLon, minLat]]] };
}

function createController(options = {}) {
  const doc = SceneDocument.create({ projectId: "p", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 1 });
  doc.selectionBoundary = options.withoutBoundary ? null : square();
  const changes = [];
  const statuses = [];
  let sequence = 0;
  const controller = Editor.createSceneEditorController({
    adapter: { render(document, state) { changes.push({ document, state }); } },
    history: Commands.createHistory(doc),
    geometryRules: Geometry,
    idFactory: () => `object-${++sequence}`,
    baselineBuildings: options.baselineBuildings || [],
    villageBoundary: options.villageBoundary || square(114.29, 30.49, 0.03),
    onDocumentChange(document) { changes.push({ document }); },
    onStatus(status) { statuses.push(status); }
  });
  return { controller, changes, statuses };
}

test("supports the complete first-release tool set", () => {
  assert.deepEqual(Editor.TOOLS, ["select", "box-select", "draw-boundary", "edit-boundary", "draw-surface", "draw-rectangle", "draw-line", "place-asset", "move", "rotate", "scale", "measure", "pan", "edit-nodes"]);
});

test("sets and undoes a validated design boundary without touching the baseline", () => {
  const { controller } = createController({ withoutBoundary: true });
  const boundary = square();
  assert.equal(controller.setSelectionBoundary(boundary).ok, true);
  assert.deepEqual(controller.getState().document.selectionBoundary, boundary);
  controller.undo();
  assert.equal(controller.getState().document.selectionBoundary, null);
});

test("creates valid point, line and surface objects inside the selected boundary", () => {
  const { controller } = createController();
  assert.equal(controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.3005, 30.5005] }, properties: { assetRef: "seed:bench:wood" } }).ok, true);
  assert.equal(controller.createObject({ kind: "line", category: "path", geometry: { type: "LineString", coordinates: [[114.3001, 30.5001], [114.3008, 30.5008]] }, properties: { widthM: 1.5 } }).ok, true);
  assert.equal(controller.createObject({ kind: "surface", category: "paving", geometry: square(114.3002, 30.5002, 0.0002), properties: { materialRef: "seed:paving:stone", extrusionHeightM: 0.1 } }).ok, true);
  assert.deepEqual(controller.getState().document.objects.map((item) => item.kind), ["asset", "line", "surface"]);
});

test("rejects objects outside the boundary and edits on locked layers", () => {
  const { controller, statuses } = createController();
  assert.equal(controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [115, 31] } }).code, "OUTSIDE_BOUNDARY");
  controller.setLayerLocked("design", true);
  assert.equal(controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.3005, 30.5005] } }).code, "LAYER_LOCKED");
  assert.equal(statuses.at(-1).level, "error");
  controller.toggleLayerLocked("design");
  assert.equal(controller.getState().document.layers[0].locked, false);
  controller.toggleLayerVisible("design");
  assert.equal(controller.getState().document.layers[0].visible, false);
});

test("selection, duplication, grouping, alignment and history share one document", () => {
  const { controller } = createController();
  for (const lon of [114.3002, 114.3005, 114.3008]) controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [lon, 30.5005] } });
  controller.select(["object-1"]);
  controller.select(["object-2", "object-3"], { additive: true });
  assert.deepEqual(controller.getState().selectedIds, ["object-1", "object-2", "object-3"]);
  controller.alignSelection("left");
  assert.deepEqual(controller.getState().document.objects.map((item) => item.geometry.coordinates[0]), [114.3002, 114.3002, 114.3002]);
  controller.undo();
  controller.distributeSelection("horizontal");
  controller.groupSelection("座椅组");
  assert.equal(controller.getState().document.groups.length, 1);
  controller.duplicateSelection();
  assert.equal(controller.getState().document.objects.length, 6);
  controller.undo();
  assert.equal(controller.getState().document.objects.length, 3);
  controller.redo();
  assert.equal(controller.getState().document.objects.length, 6);
});

test("node and property edits run through reversible commands", () => {
  const { controller } = createController();
  controller.createObject({ kind: "line", category: "path", geometry: { type: "LineString", coordinates: [[114.3001, 30.5001], [114.3008, 30.5008]] }, properties: { widthM: 1 } });
  controller.select(["object-1"]);
  const nextGeometry = { type: "LineString", coordinates: [[114.3002, 30.5001], [114.3007, 30.5008]] };
  assert.equal(controller.updateSelection({ geometry: nextGeometry, properties: { widthM: 2, heightM: 0.1, repeatSpacingM: 1.2 } }).ok, true);
  assert.equal(controller.getState().document.objects[0].properties.widthM, 2);
  controller.undo();
  assert.equal(controller.getState().document.objects[0].properties.widthM, 1);
});

test("moves a point object from 3D as one reversible document command", () => {
  const { controller } = createController();
  controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.3002, 30.5002] } });
  assert.equal(controller.moveObject("object-1", [114.3006, 30.5007]).ok, true);
  assert.deepEqual(controller.getState().document.objects[0].geometry.coordinates, [114.3006, 30.5007]);
  assert.deepEqual(controller.getState().selectedIds, ["object-1"]);
  controller.undo();
  assert.deepEqual(controller.getState().document.objects[0].geometry.coordinates, [114.3002, 30.5002]);
});

test("rejects 3D horizontal moves for non-point or out-of-boundary objects", () => {
  const { controller } = createController();
  controller.createObject({ kind: "line", category: "path", geometry: { type: "LineString", coordinates: [[114.3001, 30.5001], [114.3008, 30.5008]] } });
  assert.equal(controller.moveObject("object-1", [114.3005, 30.5005]).code, "OBJECT_NOT_MOVABLE");
  assert.equal(controller.moveObject("missing", [114.3005, 30.5005]).code, "OBJECT_NOT_MOVABLE");
});

test("multi-object property updates undo as one command", () => {
  const { controller } = createController();
  controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.3002, 30.5002] } });
  controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.3004, 30.5004] } });
  controller.select(["object-1", "object-2"]);
  controller.updateSelection({ transform: { headingDeg: 30 } });
  assert.deepEqual(controller.getState().document.objects.map((item) => item.transform.headingDeg), [30, 30]);
  controller.undo();
  assert.deepEqual(controller.getState().document.objects.map((item) => item.transform.headingDeg), [0, 0]);
});

test("snaps by priority and measures distance, area and angle", () => {
  const near = Geometry.fromLocalMeters([0.2, 0.2], [114.3, 30.5]);
  const snapped = Editor.findSnapCoordinate(near, {
    origin: [114.3, 30.5],
    toleranceM: 0.5,
    candidates: [
      { type: "center", coordinate: Geometry.fromLocalMeters([0.1, 0.1], [114.3, 30.5]) },
      { type: "endpoint", coordinate: Geometry.fromLocalMeters([0.3, 0.3], [114.3, 30.5]) }
    ]
  });
  assert.equal(snapped.type, "endpoint");
  const metrics = Editor.measureGeometry({ type: "LineString", coordinates: [[114.3, 30.5], Geometry.fromLocalMeters([3, 4], [114.3, 30.5]), Geometry.fromLocalMeters([6, 4], [114.3, 30.5])] }, Geometry);
  assert.ok(Math.abs(metrics.lengthM - 8) < 0.01);
  assert.ok(Math.abs(metrics.angleDeg - 126.8698976) < 0.01);
  assert.ok(Editor.measureGeometry(square(), Geometry).areaM2 > 10000);
});

test("acknowledges the server revision without creating an undo step", () => {
  const { controller } = createController();
  controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.3002, 30.5002] } });
  controller.acknowledgeSavedRevision(9, "2026-09-14T04:00:00Z");
  assert.equal(controller.getState().document.revision, 9);
  controller.undo();
  assert.equal(controller.getState().document.objects.length, 0);
  assert.equal(controller.getState().document.revision, 9);
});

test("replaces a conflicted document as a fresh history without saving the old document", () => {
  const { controller } = createController();
  controller.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.3002, 30.5002] } });
  const remote = SceneDocument.create({ projectId: "remote", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 2, revision: 8, selectionBoundary: square() });
  controller.replaceDocument(remote);
  assert.equal(controller.getState().document.projectId, "remote");
  assert.equal(controller.getState().canUndo, false);
  assert.deepEqual(controller.getState().selectedIds, []);
});

test("names user layers sequentially and deletes them without deleting their objects", () => {
  const { controller } = createController();
  const first = controller.addLayer();
  const second = controller.addLayer();
  assert.deepEqual(controller.getState().document.layers.map((layer) => layer.name), ["方案要素", "图层 2", "图层 3"]);
  controller.renameLayer(first, "休憩设施");
  assert.equal(controller.getState().document.layers.find((layer) => layer.id === first).name, "休憩设施");
  controller.createObject({ kind: "asset", category: "bench", layerId: first, geometry: { type: "Point", coordinates: [114.3002, 30.5002] } });
  assert.equal(controller.deleteLayer(first).ok, true);
  assert.equal(controller.getState().document.objects[0].layerId, "design");
  assert.equal(controller.deleteLayer("design").code, "DEFAULT_LAYER_REQUIRED");
  assert.equal(controller.getState().document.layers.some((layer) => layer.id === second), true);
});

test("selection uses the adapter fast path without rebuilding every map feature", () => {
  const doc = SceneDocument.create({ projectId: "p", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 1 });
  doc.selectionBoundary = square();
  doc.objects.push({ id: "o1", kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.3002, 30.5002] }, properties: {}, transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 }, layerId: "design" });
  let renders = 0;
  const selections = [];
  const controller = Editor.createSceneEditorController({
    adapter: { render() { renders += 1; }, updateSelection(ids) { selections.push(ids); } },
    history: Commands.createHistory(doc), geometryRules: Geometry, idFactory: () => "x"
  });
  assert.equal(renders, 1);
  controller.select(["o1"]);
  assert.equal(renders, 1);
  assert.deepEqual(selections, [["o1"]]);
});
