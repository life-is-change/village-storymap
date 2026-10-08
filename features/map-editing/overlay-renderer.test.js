const test = require("node:test");
const assert = require("node:assert/strict");

const {
  refresh2DOverlay,
  createLatestOverlayRefreshController,
  ensureStaticLayersLoaded,
  planIncrementalLayerUpdate
} = require("./overlay-renderer.js");

function overlayFixture(t, { personal = false } = {}) {
  const previousWindow = global.window;
  global.window = {};
  t.after(() => { global.window = previousWindow; });
  class VectorSource {
    constructor() { this.features = []; }
    getFeatures() { return this.features; }
    addFeature(f) { this.features.push(f); }
  }
  class GeoJSON {
    readFeature(raw) {
      const values = {};
      return { set(k,v) { values[k]=v; }, get(k) { return values[k]; } };
    }
  }
  const raw = (code) => ({ type: "Feature", properties: { code }, geometry: { type: "Point", coordinates: [113,23] } });
  const row = (code) => ({ object_code: code, object_name: code, geom: raw(code).geometry, props: {}, layer_version_id: "version-1" });
  let source = new VectorSource();
  const cache = Object.fromEntries(["building","road","water"].map(k => [k, {
    features: [raw(k+"-deleted"),raw(k+"-edited"),raw(k+"-static")], rowIndex: new Map()
  }]));
  const deps = {
    getPlan2DView: () => ({ classList: { contains: () => true } }),
    getCurrentSpaceId: () => "test-space", setActive2DSpaceId() {}, ensurePlanMap: async () => {},
    getOlReady: async () => ({ GeoJSON, VectorSource }), getPlanVectorSource: () => source,
    getPlanVectorLayer: () => ({ setSource(s) { source=s; }, changed() {} }), setPlanVectorSource(s) { source=s; },
    setActiveFeature() {}, getSelectedLayersForCurrentSpace: () => ["building","road","water"],
    isCurrentSpacePersonal: () => personal, ensureLayerLoaded: async () => {},
    shouldShowVillageFillForCurrentSpace: () => false, getLayerDataCache: () => cache,
    getLayerConfigs: () => ({}), normalizeCode: code => String(code||""),
    isRenderableGeometry: g => !!g, getFeatureCode: f => f.properties.code, getFeatureProperties: f => f.properties,
    getFirstMatchingField: () => null, buildRoadBaseRow: (r,p) => r||p,
    makeBuildingDbRowToRawFeature: r => ({ type:"Feature",geometry:r.geom,properties:r.props }),
    getLayerCodeField: () => "code", getLayerNameField: () => "name", getLayerLabel: k => k,
    listBuildingFeaturesFromDbCached: async () => [row("building-edited")],
    listRoadFeaturesFromDbCached: async () => [row("road-edited")],
    listWaterFeaturesFromDbCached: async () => [row("water-edited")],
    listDeletedLayerFeatureCodesFromDb: async (space,k) => [k+"-deleted"],
    hasAnyBuildingFeaturesInDbCached: async () => false, hasAnyRoadFeaturesInDbCached: async () => false,
    hasAnyWaterFeaturesInDbCached: async () => false,
    listCurrentPersonalLayerFeatures: async (space,k) => [row(k+"-personal")],
    buildRawFeatureFromPersonalRow: r => ({ type:"Feature",geometry:r.geom,properties:r.props }),
    syncBasemapUIBySpace() {}
  };
  return { deps, features: () => source.getFeatures() };
}

test("shared overlay starts independent layer reads before waiting for the first one", async t => {
  const f = overlayFixture(t), started=[];
  let release;
  const gate = new Promise(resolve => { release=resolve; });
  for (const [key,name] of [["building","listBuildingFeaturesFromDbCached"],["road","listRoadFeaturesFromDbCached"],["water","listWaterFeaturesFromDbCached"]]) {
    const read=f.deps[name];
    f.deps[name]=async space => { started.push(key); await gate; return read(space); };
  }
  const pending=refresh2DOverlay(f.deps,null,{forceFullRebuild:true});
  await new Promise(resolve => setImmediate(resolve));
  const beforeRelease=[...started];
  release(); await pending;
  assert.deepEqual(beforeRelease.sort(),["building","road","water"]);
});

test("shared overlay reads tombstones once per layer and preserves edits and feature ordering", async t => {
  const f=overlayFixture(t), reads={};
  const deleted=f.deps.listDeletedLayerFeatureCodesFromDb;
  f.deps.listDeletedLayerFeatureCodesFromDb=async (space,k) => { reads[k]=(reads[k]||0)+1; return deleted(space,k); };
  await refresh2DOverlay(f.deps,null,{forceFullRebuild:true});
  assert.deepEqual(f.features().map(v=>v.get("sourceCode")),[
    "building-edited","building-static","road-edited","road-static","water-edited","water-static"
  ]);
  assert.deepEqual(reads,{building:1,road:1,water:1});
});

test("empty initialized shared layer stays empty instead of restoring static data", async t => {
  const f=overlayFixture(t);
  f.deps.listRoadFeaturesFromDbCached=async () => [];
  f.deps.hasAnyRoadFeaturesInDbCached=async () => true;
  await refresh2DOverlay(f.deps,null,{forceFullRebuild:true});
  assert.equal(f.features().filter(v=>v.get("layerKey")==="road").length,0);
  assert.equal(f.features().length,4);
});

test("failed shared layer does not prevent other layers rendering or restore deleted fallbacks", async t => {
  const f=overlayFixture(t);
  t.mock.method(console,"warn",()=>{});
  f.deps.listDeletedLayerFeatureCodesFromDb=async (space,k) => { if(k==="road") throw new Error("read failed"); return [k+"-deleted"]; };
  await refresh2DOverlay(f.deps,null,{forceFullRebuild:true});
  assert.deepEqual(f.features().map(v=>v.get("sourceCode")),["building-edited","building-static","water-edited","water-static"]);
});

test("personal overlay retains versioned rows and never reads shared tombstones", async t => {
  const f=overlayFixture(t,{personal:true});
  f.deps.listDeletedLayerFeatureCodesFromDb=()=>{throw new Error("shared read in personal space");};
  await refresh2DOverlay(f.deps,null,{forceFullRebuild:true});
  assert.deepEqual(f.features().map(v=>v.get("sourceCode")),["building-personal","road-personal","water-personal"]);
  assert.ok(f.features().every(v=>v.get("personalLayerVersionId")==="version-1"));
});

test("shared deletion markers are reread on a later refresh rather than cached across edits", async t => {
  const f=overlayFixture(t);
  f.deps.listRoadFeaturesFromDbCached=async () => [];
  await refresh2DOverlay(f.deps,null,{forceFullRebuild:true});
  assert.deepEqual(f.features().filter(v=>v.get("layerKey")==="road").map(v=>v.get("sourceCode")),["road-edited","road-static"]);
  f.deps.listDeletedLayerFeatureCodesFromDb=async (space,k)=>[k+"-deleted",k+"-static"];
  await refresh2DOverlay(f.deps,null,{forceFullRebuild:true});
  assert.deepEqual(f.features().filter(v=>v.get("layerKey")==="road").map(v=>v.get("sourceCode")),["road-edited"]);
});

test("obsolete overlay refresh never replaces the visible vector source", async t => {
  const f=overlayFixture(t);
  const result=await refresh2DOverlay(f.deps,{isCurrent:()=>false},{forceFullRebuild:true});
  assert.deepEqual(result,{stale:true});
  assert.equal(f.features().length,0);
});

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
