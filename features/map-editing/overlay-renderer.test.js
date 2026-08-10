const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLatestOverlayRefreshController,
  ensureStaticLayersLoaded,
  planIncrementalLayerUpdate
} = require("./overlay-renderer.js");

function feature(layerKey) {
  return { get(name) { return name === "layerKey" ? layerKey : undefined; } };
}

test("reuses unchanged layer features and builds only a newly enabled layer", () => {
  const building = feature("building");
  const road = feature("road");
  const result = planIncrementalLayerUpdate(
    [building, road],
    ["building", "water"]
  );
  assert.deepEqual(result.reusedFeatures, [building]);
  assert.deepEqual(result.layerKeysToBuild, ["water"]);
});

test("force refresh rebuilds every selected layer", () => {
  const result = planIncrementalLayerUpdate(
    [feature("building"), feature("road")],
    ["building", "road"],
    { forceFullRebuild: true }
  );
  assert.deepEqual(result.reusedFeatures, []);
  assert.deepEqual(result.layerKeysToBuild, ["building", "road"]);
});

test("coalesces synchronous layer toggles into the newest overlay request", async () => {
  const rendered = [];
  const controller = createLatestOverlayRefreshController({
    render: async (request) => {
      rendered.push(request.id);
    }
  });

  await Promise.all([controller.request(), controller.request()]);

  assert.deepEqual(rendered, [2]);
});

test("marks an in-flight render stale when a newer request arrives", async () => {
  let releaseFirst;
  const firstStarted = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const rendered = [];
  const controller = createLatestOverlayRefreshController({
    render: async (request) => {
      rendered.push({ id: request.id, current: request.isCurrent() });
      if (request.id === 1) await firstStarted;
      rendered.push({ id: request.id, current: request.isCurrent() });
    }
  });

  const first = controller.request();
  await new Promise((resolve) => queueMicrotask(resolve));
  const second = controller.request();
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(rendered, [
    { id: 1, current: true },
    { id: 1, current: false },
    { id: 2, current: true },
    { id: 2, current: true }
  ]);
});

test("ordinary overlay rendering never refreshes community tasks", () => {
  const source = require("node:fs").readFileSync(__dirname + "/overlay-renderer.js", "utf8");
  const refreshBody = source.match(/async refresh2DOverlay\(deps\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.doesNotMatch(refreshBody, /refreshCommunityTasksOnMap/);
});

test("application routes UI overlay requests through the latest-wins controller", () => {
  const app = require("node:fs").readFileSync(__dirname + "/../../app.js", "utf8");
  assert.match(app, /createLatestOverlayRefreshController/);
  assert.match(app, /overlayRefreshController\.request\(options\)/);
});

test("layer selection compares with the actual current space variable", () => {
  const app = require("node:fs").readFileSync(__dirname + "/../../app.js", "utf8");
  const body = app.match(/function setSpaceSelectedLayers\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(body, /String\(currentSpaceId\)/);
  assert.doesNotMatch(body, /getCurrentSpaceId\(/);
});

test("layer toggles do not preload every selected static layer", () => {
  const source = require("node:fs").readFileSync(__dirname + "/../ui/space-panel-events.js", "utf8");
  const handler = source.match(/document\.querySelectorAll\("\[data-space-layer\]"\)([\s\S]*?)const devInfoIcons/)?.[1] || "";
  assert.doesNotMatch(handler, /ensureSelectedLayersLoaded/);
});

test("cold overlay loads only the static layers it is about to build", async () => {
  const loaded = [];
  await ensureStaticLayersLoaded({
    layerKeys: ["elevationBands", "contours", "building"],
    isPersonalSpace: false,
    ensureLayerLoaded: async (layerKey) => loaded.push(layerKey)
  });
  assert.deepEqual(loaded, ["elevationBands", "contours", "building"]);
});

test("personal overlay reads versioned rows without loading static fallbacks", async () => {
  const loaded = [];
  await ensureStaticLayersLoaded({
    layerKeys: ["contours", "building"],
    isPersonalSpace: true,
    ensureLayerLoaded: async (layerKey) => loaded.push(layerKey)
  });
  assert.deepEqual(loaded, []);
});
