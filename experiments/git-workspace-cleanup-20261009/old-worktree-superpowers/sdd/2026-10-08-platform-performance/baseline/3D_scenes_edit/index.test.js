const test = require("node:test");
const assert = require("node:assert/strict");

const Studio = require("./index");

const completeContext = {
  userId: "u1",
  teachingProjectId: "tp1",
  courseId: "c1",
  villageId: "v1",
  groupId: "g1",
  spaceId: "s1",
  baselineRevision: 4,
  baselineFeatures: []
};

test("validates immutable platform context before constructing services", () => {
  assert.deepEqual(Studio.validateContext(completeContext), { ok: true, errors: [] });
  const invalid = Studio.validateContext({ userId: "u1", groupId: "g1" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /spaceId/);
  assert.match(invalid.errors.join(" "), /villageId/);
});

test("builds the isolated local draft identity", () => {
  assert.deepEqual(Studio.buildDraftIdentity(completeContext, "project-1"), {
    userId: "u1", scopeKind: "group", ownerId: "u1", groupId: "g1", spaceId: "s1", projectId: "project-1"
  });
});

test("validates an administrator sandbox without a group", () => {
  const context = { ...completeContext, scopeKind: "admin_sandbox", ownerId: "admin-1", groupId: null };
  assert.deepEqual(Studio.validateContext(context), { ok: true, errors: [] });
  assert.deepEqual(Studio.buildDraftIdentity(context, "p-admin"), {
    userId: "u1", scopeKind: "admin_sandbox", ownerId: "admin-1", groupId: null, spaceId: "s1", projectId: "p-admin"
  });
});

test("action dispatcher maps workbench actions to controller and lifecycle boundaries", async () => {
  const calls = [];
  const dispatcher = Studio.createActionDispatcher({
    controller: {
      setTool: (value) => calls.push(["tool", value]), undo: () => calls.push(["undo"]), redo: () => calls.push(["redo"]),
      duplicateSelection: () => calls.push(["duplicate"]), deleteSelection: () => calls.push(["delete"]),
      groupSelection: () => calls.push(["group"]), alignSelection: (axis) => calls.push(["align", axis]),
      distributeSelection: (axis) => calls.push(["distribute", axis]), select: (ids) => calls.push(["select", ids]),
      toggleLayerVisible: (id) => calls.push(["layer-visible", id]), toggleLayerLocked: (id) => calls.push(["layer-lock", id]),
      updateSelection: (patch) => calls.push(["update", patch]), getState: () => ({ selectedIds: ["o1"], document: { objects: [{ id: "o1", transform: { scale: [1, 1, 2] } }] } })
    },
    lifecycle: {
      switchMode: async (mode) => calls.push(["mode", mode]),
      createMilestone: async () => calls.push(["milestone"]),
      close: () => calls.push(["close"]), chooseAsset: (id) => calls.push(["asset", id]), uploadAsset: () => calls.push(["upload"]), cancel: () => calls.push(["cancel"]),
      activateTool: (tool) => calls.push(["activate-tool", tool])
    }
  });
  for (const action of [
    { type: "tool", value: "draw-line" }, { type: "undo" }, { type: "redo" }, { type: "duplicate" },
    { type: "delete" }, { type: "group" }, { type: "align", value: "left" },
    { type: "distribute", value: "horizontal" }, { type: "mode", value: "3d" },
    { type: "select-object", value: "o1" }, { type: "layer-visible", value: "design" }, { type: "layer-lock", value: "design" },
    { type: "property", path: "transform.scaleXY", value: 1.5 }, { type: "choose-asset", value: "seed:bench:wood" },
    { type: "upload-asset" }, { type: "cancel" }, { type: "milestone" }, { type: "close" }
  ]) await dispatcher(action);
  assert.deepEqual(calls, [
    ["tool", "draw-line"], ["activate-tool", "draw-line"], ["undo"], ["redo"], ["duplicate"], ["delete"], ["group"],
    ["align", "left"], ["distribute", "horizontal"], ["mode", "3d"], ["select", ["o1"]],
    ["layer-visible", "design"], ["layer-lock", "design"], ["update", { transform: { scale: [1.5, 1.5, 2] } }],
    ["asset", "seed:bench:wood"], ["upload"], ["cancel"], ["milestone"], ["close"]
  ]);
});

test("property patches preserve unaffected transform axes", () => {
  const object = { transform: { headingDeg: 10, scale: [1, 1, 3] }, properties: { widthM: 1 } };
  assert.deepEqual(Studio.patchForProperty("transform.headingDeg", 45, object), { transform: { headingDeg: 45 } });
  assert.deepEqual(Studio.patchForProperty("transform.scaleXY", 2, object), { transform: { scale: [2, 2, 3] } });
  assert.deepEqual(Studio.patchForProperty("transform.scaleZ", 4, object), { transform: { scale: [1, 1, 4] } });
  assert.deepEqual(Studio.patchForProperty("properties.widthM", 1.8, object), { properties: { widthM: 1.8 } });
});

test("chooses a newer local draft without overwriting a newer server document", () => {
  const server = { revision: 4, updatedAt: "2026-09-14T02:00:00Z" };
  assert.equal(Studio.chooseInitialDocument(server, { revision: 5, document: { revision: 5 } }).revision, 5);
  assert.equal(Studio.chooseInitialDocument(server, { revision: 4, savedAt: "2026-09-14T03:00:00Z", document: { revision: 4, local: true } }).local, true);
  assert.equal(Studio.chooseInitialDocument(server, { revision: 3, document: { revision: 3 } }), server);
});

test("maps draw tools and selected catalog items to canonical object input", () => {
  assert.deepEqual(Studio.createObjectInputForTool("draw-line", { type: "LineString", coordinates: [[1, 2], [3, 4]] }, null), {
    kind: "line", category: "path", geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
    properties: { widthM: 1.5, heightM: 0 }
  });
  const asset = { id: "seed:bench:wood", kind: "asset", category: "bench", label: "木座椅", footprintM: [1.8, 0.65], defaultHeightM: 0.85 };
  assert.deepEqual(Studio.createObjectInputForTool("place-asset", { type: "Point", coordinates: [1, 2] }, asset), {
    kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [1, 2] },
    properties: { assetRef: "seed:bench:wood", displayName: "木座椅", footprintM: [1.8, 0.65], heightM: 0.85 }
  });
});

test("creates and disposes a loaded studio with its real composition services", async () => {
  const document = require("./domain/scene-document").create({
    projectId: "project-1", villageId: "v1", groupId: "g1", spaceId: "s1", baselineRevision: 4,
    selectionBoundary: { type: "Polygon", coordinates: [[[114, 30], [114.001, 30], [114.001, 30.001], [114, 30.001], [114, 30]]] }
  });
  const listeners = new Map();
  const root = {
    innerHTML: "", dataset: {},
    setAttribute() {}, focus() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const calls = [];
  const frames = [];
  class VectorSource { clear() {} addFeatures() {} }
  class VectorLayer { constructor(options) { this.options = options; } changed() {} }
  class Feature { constructor() { this.values = {}; } setProperties(values) { this.values = values; } }
  class Geometry { constructor(coordinates) { this.coordinates = coordinates; } getExtent() { return [1, 2, 3, 4]; } }
  const ol = {
    source: { Vector: VectorSource }, layer: { Vector: VectorLayer }, Feature,
    geom: { Point: Geometry, LineString: Geometry, Polygon: Geometry },
    proj: { fromLonLat: (position) => position }
  };
  const map = {
    addLayer() { calls.push("compare-mount"); }, removeLayer() {},
    updateSize() { calls.push("map-update-size"); },
    getView() { return { fit() { calls.push("map-fit"); } }; }
  };
  const preview = { async render(next) { calls.push(["preview-render", next.projectId]); }, select(ids) { calls.push(["preview-select", ids]); }, flyToBoundary() { calls.push("preview-fly"); }, dispose() { calls.push("preview-dispose"); } };
  const studio = await Studio.create({
    root,
    ol,
    map,
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    context: { ...completeContext, projectId: "project-1", seedAssets: [{ id: "seed:bench:wood", kind: "asset", category: "bench" }] },
    services: {
      client: {
        async loadProject() { return { ok: true, data: document }; },
        async saveDraft() { return { ok: true, data: { revision: 1 } }; },
        async listVersions() { return { ok: true, data: [{ id: "v1", label: "测试1", document }] }; }
      },
      localStore: { read() { return null; }, write() {}, remove() {} },
      adapter: { mount() { calls.push("mount"); }, render() {}, fitBoundary() { calls.push("adapter-fit"); }, dispose() { calls.push("adapter-dispose"); } },
      interactions: { activate(tool) { calls.push(["activate", tool]); }, dispose() { calls.push("interactions-dispose"); } },
      preview
    }
  });

  assert.equal(studio.ok, true);
  assert.equal(studio.getState().mode, "3d");
  assert.equal(calls.includes("mount"), true);
  assert.equal(calls.some((call) => call[0] === "preview-render"), true);
  assert.equal(calls.some((call) => call[0] === "activate" && call[1] === "select"), true);
  await studio.dispatch({ type: "tool", value: "move" });
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "activate" && call[1] === "move"), true);
  await studio.dispatch({ type: "select-object", value: "missing" });
  assert.equal(studio.getState().tool, "select");
  assert.deepEqual(calls.filter((call) => Array.isArray(call) && call[0] === "activate").at(-1), ["activate", "select"]);
  const fitCountBefore2D = calls.filter((call) => call === "adapter-fit").length;
  await studio.dispatch({ type: "mode", value: "2d" });
  assert.equal(studio.getState().mode, "2d");
  assert.equal(calls.filter((call) => call === "adapter-fit").length, fitCountBefore2D);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(calls.slice(-2), ["map-update-size", "adapter-fit"]);
  await studio.switchMode("3d");
  assert.equal(calls.some((call) => call[0] === "preview-render"), true);
  assert.equal(calls.includes("preview-fly"), true);
  const fitCountBeforeCompare = calls.filter((call) => call === "adapter-fit").length;
  await studio.dispatch({ type: "compare-version", value: "v1" });
  assert.equal(studio.getState().mode, "2d");
  assert.deepEqual(studio.getState().comparisonIds, ["v1"]);
  assert.equal(calls.includes("compare-mount"), true);
  assert.equal(calls.filter((call) => call === "adapter-fit").length, fitCountBeforeCompare);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(calls.slice(-2), ["map-update-size", "adapter-fit"]);
  studio.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(calls.includes("preview-dispose"), true);
  assert.equal(calls.includes("interactions-dispose"), true);
  assert.equal(calls.includes("adapter-dispose"), true);
});

test("boundary tool updates editor state before activating Cesium interaction", async () => {
  const calls = [];
  const dispatcher = Studio.createActionDispatcher({
    controller: { setTool: (value) => calls.push(["state", value]) },
    lifecycle: { activateTool: (value) => calls.push(["interaction", value]) }
  });
  await dispatcher({ type: "tool", value: "draw-boundary" });
  assert.deepEqual(calls, [["state", "draw-boundary"], ["interaction", "draw-boundary"]]);
});

test("dispatcher routes lightweight object selection and boundary edit controls through lifecycle", async () => {
  const calls = [];
  const dispatcher = Studio.createActionDispatcher({
    controller: { select: (ids) => calls.push(["controller-select", ids]) },
    lifecycle: {
      selectObject: (id) => calls.push(["select-object", id]),
      finishBoundaryEdit: () => calls.push(["finish-boundary"]),
      cancelBoundaryEdit: () => calls.push(["cancel-boundary"]),
      deleteBoundaryVertex: () => calls.push(["delete-boundary-vertex"])
    }
  });
  await dispatcher({ type: "select-object", value: "o1" });
  await dispatcher({ type: "finish-boundary-edit" });
  await dispatcher({ type: "cancel-boundary-edit" });
  await dispatcher({ type: "delete-boundary-vertex" });
  assert.deepEqual(calls, [
    ["select-object", "o1"], ["finish-boundary"], ["cancel-boundary"], ["delete-boundary-vertex"]
  ]);
});

test("dispatcher routes layer rename and safe deletion through the controller", async () => {
  const calls = [];
  const dispatcher = Studio.createActionDispatcher({
    controller: {
      renameLayer: (id, name) => calls.push(["rename", id, name]),
      deleteLayer: (id) => calls.push(["delete-layer", id])
    },
    lifecycle: {}
  });
  await dispatcher({ type: "layer-rename", value: "layer-2", name: "休憩设施" });
  await dispatcher({ type: "layer-delete", value: "layer-2" });
  assert.deepEqual(calls, [["rename", "layer-2", "休憩设施"], ["delete-layer", "layer-2"]]);
});

test("dispatcher routes property inspection through the camera-safe lifecycle", async () => {
  const calls = [];
  const dispatcher = Studio.createActionDispatcher({ controller: {}, lifecycle: { inspectProperties: () => calls.push("inspect") } });
  await dispatcher({ type: "inspect-properties" });
  assert.deepEqual(calls, ["inspect"]);
});

test("catalog asset tools remain available in 3D", () => {
  assert.equal(Studio.toolForAsset({ kind: "asset" }), "place-asset");
  assert.equal(Studio.toolForAsset({ kind: "line" }), "draw-line");
  assert.equal(Studio.toolForAsset({ kind: "surface" }), "draw-surface");
  assert.equal(Studio.toolRequires2D("draw-line"), false);
  assert.equal(Studio.toolRequires2D("draw-surface"), false);
});

test("frame scheduler coalesces repeated expensive renders into the latest frame", () => {
  const frames = [];
  const values = [];
  const schedule = Studio.createFrameScheduler((value) => values.push(value), (callback) => {
    frames.push(callback);
    return frames.length;
  });

  schedule("first");
  schedule("latest");
  assert.equal(frames.length, 1);
  frames[0]();
  assert.deepEqual(values, ["latest"]);
});
