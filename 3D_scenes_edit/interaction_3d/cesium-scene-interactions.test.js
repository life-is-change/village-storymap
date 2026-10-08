const test = require("node:test");
const assert = require("node:assert/strict");
const { createCesiumSceneInteractions } = require("./cesium-scene-interactions");

function fixture() {
  let handler;
  const removed = [];
  const added = [];
  class ScreenSpaceEventHandler {
    constructor() { this.actions = {}; handler = this; }
    setInputAction(action, type) { this.actions[type] = action; }
    removeInputAction(type) { delete this.actions[type]; }
    destroy() { this.destroyed = true; }
  }
  const Cesium = {
    ScreenSpaceEventHandler,
    ScreenSpaceEventType: { LEFT_CLICK: "left", RIGHT_CLICK: "right", LEFT_DOUBLE_CLICK: "double", MOUSE_MOVE: "move", LEFT_DOWN: "down", LEFT_UP: "up" },
    Cartesian3: { fromDegreesArray: (values) => values, fromDegrees: (...values) => values },
    Color: {
      fromCssColorString: (value) => value,
      BLACK: "black",
      WHITE: "white"
    },
    LabelStyle: { FILL_AND_OUTLINE: "fill-and-outline" },
    VerticalOrigin: { BOTTOM: "bottom" },
    HeightReference: { RELATIVE_TO_GROUND: "relative-to-ground" }
  };
  const viewer = {
    canvas: {},
    entities: { add: (value) => { added.push(value); return value; }, remove: (value) => removed.push(value) },
    scene: { screenSpaceCameraController: { enableInputs: true } }
  };
  return { Cesium, viewer, added, removed, getHandler: () => handler };
}

test("boundary drawing closes three ground points and clears its preview", () => {
  const f = fixture();
  const completed = [];
  const points = [[114, 23, 0], [114.001, 23, 0], [114.001, 23.001, 0]];
  const interactions = createCesiumSceneInteractions({ ...f, pickGround: () => points.shift(), onBoundaryComplete: (geometry) => completed.push(geometry) });
  interactions.activate("draw-boundary");
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.right({ position: {} });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].type, "Polygon");
  assert.deepEqual(completed[0].coordinates[0][0], completed[0].coordinates[0].at(-1));
  assert.equal(f.removed.length > 0, true);
});

test("every boundary click shows a numbered terrain-visible vertex and a clamped preview", () => {
  const f = fixture();
  const points = [[114, 23, 12], [114.001, 23, 14], [114.001, 23.001, 13]];
  const interactions = createCesiumSceneInteractions({ ...f, pickGround: () => points.shift() });
  interactions.activate("draw-boundary");

  f.getHandler().actions.left({ position: {} });
  assert.equal(f.added.at(-1).point.disableDepthTestDistance, Infinity);
  assert.equal(f.added.at(-1).label.text, "1");

  f.getHandler().actions.left({ position: {} });
  const line = f.added.findLast((entity) => entity.polyline)?.polyline;
  assert.equal(line.clampToGround, true);
  assert.equal(line.width >= 4, true);
});

test("too-short boundary is rejected and dispose restores controls", () => {
  const f = fixture();
  const statuses = [];
  const interactions = createCesiumSceneInteractions({ ...f, pickGround: () => [114, 23, 0], onStatus: (value) => statuses.push(value) });
  interactions.activate("draw-boundary");
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.right({ position: {} });
  assert.match(statuses.at(-1).message, /至少需要 3 个点/);
  interactions.dispose();
  assert.equal(f.getHandler().destroyed, true);
  assert.equal(f.viewer.scene.screenSpaceCameraController.enableInputs, true);
});

test("placing an asset clears its ghost and reports the Chinese catalog label", () => {
  const f = fixture();
  const events = [];
  const ghosts = [];
  const points = [[114, 23, 2], [114, 23, 2]];
  const statuses = [];
  const interactions = createCesiumSceneInteractions({
    ...f,
    pickGround: () => points.shift(),
    previewAdapter: { setGhost: (asset, coordinate) => ghosts.push([asset.id, coordinate]), clearGhost: () => ghosts.push(["clear"]) },
    onPlace: ({ asset, coordinate }) => events.push([asset.id, coordinate]),
    onStatus: (status) => statuses.push(status)
  });
  interactions.setAsset({ id: "bench", kind: "asset", category: "bench", label: "木座椅" });
  interactions.activate("place-asset");
  f.getHandler().actions.move({ endPosition: {} });
  f.getHandler().actions.left({ position: {} });
  assert.deepEqual(ghosts.find((item) => item[0] === "bench"), ["bench", [114, 23, 2]]);
  assert.deepEqual(events, [["bench", [114, 23]]]);
  assert.deepEqual(ghosts.at(-1), ["clear"]);
  assert.match(statuses.at(-1).message, /木座椅已放置/);
});

test("placement preview coalesces rapid pointer moves into one terrain pick per frame", () => {
  const f = fixture();
  const frames = [];
  const ghosts = [];
  const picked = [];
  const interactions = createCesiumSceneInteractions({
    ...f,
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    pickGround(position) { picked.push(position); return [position.longitude, position.latitude, 0]; },
    previewAdapter: { setGhost: (_asset, coordinate) => ghosts.push(coordinate), clearGhost() {} }
  });
  interactions.setAsset({ id: "table", label: "休闲桌" });
  interactions.activate("place-asset");
  f.getHandler().actions.move({ endPosition: { longitude: 1, latitude: 2 } });
  f.getHandler().actions.move({ endPosition: { longitude: 3, latitude: 4 } });
  f.getHandler().actions.move({ endPosition: { longitude: 5, latitude: 6 } });
  assert.equal(picked.length, 0);
  assert.equal(frames.length, 1);
  frames[0]();
  assert.deepEqual(picked, [{ longitude: 5, latitude: 6 }]);
  assert.deepEqual(ghosts, [[5, 6, 0]]);
});

test("placement preview limits expensive terrain picks while keeping the newest pointer position", () => {
  const f = fixture();
  const frames = [];
  const picked = [];
  const interactions = createCesiumSceneInteractions({
    ...f,
    placementPreviewIntervalMs: 40,
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    pickGround(position) { picked.push(position); return [position.x, position.y, 0]; },
    previewAdapter: { setGhost() {}, clearGhost() {} }
  });
  interactions.setAsset({ id: "table", label: "休闲桌" });
  interactions.activate("place-asset");
  f.getHandler().actions.move({ endPosition: { x: 1, y: 1 } });
  frames.shift()(0);
  f.getHandler().actions.move({ endPosition: { x: 2, y: 2 } });
  frames.shift()(16);
  f.getHandler().actions.move({ endPosition: { x: 8, y: 9 } });
  frames.shift()(32);
  assert.equal(picked.length, 1);
  frames.shift()(48);
  assert.deepEqual(picked, [{ x: 1, y: 1 }, { x: 8, y: 9 }]);
});

test("placement preview uses the fast terrain picker while the final click stays accurate", () => {
  const f = fixture();
  const frames = [];
  const calls = [];
  const placements = [];
  const interactions = createCesiumSceneInteractions({
    ...f,
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    previewPickGround(position) { calls.push(["preview", position]); return [114, 23, 0]; },
    pickGround(position) { calls.push(["final", position]); return [114.001, 23.001, 7]; },
    previewAdapter: { setGhost() {}, clearGhost() {} },
    onPlace(value) { placements.push(value); }
  });
  interactions.setAsset({ id: "bench", label: "木座椅" });
  interactions.activate("place-asset");
  const movePosition = { x: 1, y: 2 };
  const clickPosition = { x: 3, y: 4 };
  f.getHandler().actions.move({ endPosition: movePosition });
  frames.shift()(0);
  f.getHandler().actions.left({ position: clickPosition });
  assert.deepEqual(calls, [["preview", movePosition], ["final", clickPosition]]);
  assert.deepEqual(placements[0].coordinate, [114.001, 23.001]);
});

test("boundary edit drags numbered handles, adds an edge vertex and commits only on finish", () => {
  const f = fixture();
  const completed = [];
  const picks = [
    { id: { id: "scene-edit-boundary-handle-1" } },
    { id: { id: "scene-edit-boundary-segment-1" } }
  ];
  f.viewer.scene.pick = () => picks.shift();
  const ground = [[114.0002, 23.0002, 0], [114.0005, 23, 0]];
  const interactions = createCesiumSceneInteractions({
    ...f,
    pickGround: () => ground.shift(),
    onBoundaryComplete: (geometry) => completed.push(geometry)
  });
  interactions.setDocument({ selectionBoundary: { type: "Polygon", coordinates: [[[114, 23], [114.001, 23], [114.001, 23.001], [114, 23]]] } });
  interactions.activate("edit-boundary");
  const firstHandle = f.added.find((entity) => entity.id === "scene-edit-boundary-handle-1");
  assert.equal(firstHandle?.label.text, "1");
  assert.equal(firstHandle?.point.heightReference, "relative-to-ground");
  assert.equal(firstHandle?.label.heightReference, "relative-to-ground");
  assert.deepEqual(firstHandle?.position, [114, 23, 1]);
  f.getHandler().actions.down({ position: {} });
  f.getHandler().actions.move({ endPosition: {} });
  f.getHandler().actions.up({ position: {} });
  f.getHandler().actions.left({ position: {} });
  assert.equal(completed.length, 0);
  assert.equal(interactions.finishBoundaryEdit(), true);
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0].coordinates[0][0], [114.0002, 23.0002]);
  assert.deepEqual(completed[0].coordinates[0][1], [114.0005, 23]);
});

test("line assets are drawn and completed in the 3D scene", () => {
  const f = fixture();
  const created = [];
  const points = [[114, 23, 0], [114.001, 23.001, 0]];
  const interactions = createCesiumSceneInteractions({ ...f, pickGround: () => points.shift(), onCreate: (value) => created.push(value) });
  interactions.setAsset({ id: "path", kind: "line", category: "path" });
  interactions.activate("draw-line");
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.right({ position: {} });
  assert.equal(created[0].tool, "draw-line");
  assert.deepEqual(created[0].geometry, { type: "LineString", coordinates: [[114, 23], [114.001, 23.001]] });
});

test("surface assets are drawn and closed in the 3D scene", () => {
  const f = fixture();
  const created = [];
  const points = [[114, 23, 0], [114.001, 23, 0], [114.001, 23.001, 0]];
  const interactions = createCesiumSceneInteractions({ ...f, pickGround: () => points.shift(), onCreate: (value) => created.push(value) });
  interactions.setAsset({ id: "grass", kind: "surface", category: "grass" });
  interactions.activate("draw-surface");
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.left({ position: {} });
  f.getHandler().actions.right({ position: {} });
  assert.equal(created[0].geometry.type, "Polygon");
  assert.deepEqual(created[0].geometry.coordinates[0][0], created[0].geometry.coordinates[0].at(-1));
});

test("selecting and dragging a scene entity emits a horizontal move", () => {
  const f = fixture();
  const events = [];
  f.viewer.scene.pick = () => ({ id: { id: "scene-edit:o1" } });
  const interactions = createCesiumSceneInteractions({
    ...f,
    pickGround: () => [114.002, 23.003, 5],
    previewAdapter: { pickObjectId: () => "o1", select() {} },
    onSelect: (ids) => events.push(["select", ids]),
    onMove: ({ id, coordinate }) => events.push(["move", id, coordinate])
  });
  interactions.activate("move");
  f.getHandler().actions.down({ position: {} });
  assert.equal(f.viewer.scene.screenSpaceCameraController.enableInputs, false);
  f.getHandler().actions.move({ endPosition: {} });
  f.getHandler().actions.up({ position: {} });
  assert.deepEqual(events.at(-1), ["move", "o1", [114.002, 23.003]]);
  assert.equal(f.viewer.scene.screenSpaceCameraController.enableInputs, true);
});

test("dragging an existing component uses the fast terrain picker", () => {
  const f = fixture();
  const calls = [];
  const moves = [];
  f.viewer.scene.pick = () => ({ id: { id: "scene-edit:o1" } });
  const interactions = createCesiumSceneInteractions({
    ...f,
    pickGround() { calls.push("accurate"); return [1, 1, 0]; },
    previewPickGround() { calls.push("fast"); return [114.002, 23.003, 0]; },
    previewAdapter: { pickObjectId: () => "o1", select() {} },
    onMove(value) { moves.push(value); }
  });
  interactions.activate("move");
  f.getHandler().actions.down({ position: {} });
  f.getHandler().actions.move({ endPosition: {} });
  f.getHandler().actions.up({ position: {} });
  assert.deepEqual(calls, ["fast"]);
  assert.deepEqual(moves[0].coordinate, [114.002, 23.003]);
});
