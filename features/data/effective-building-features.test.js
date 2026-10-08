const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSerialTaskRunner,
  getFootprintScaleFromExpected,
  resolveEffectiveBuildingFeatureCollection,
  shouldReloadBuildingSpace
} = require("./effective-building-features.js");

const datasetResolver = require("./village-dataset-resolver.js");

const feature = (code, x = 0) => ({
  type: "Feature",
  properties: { code },
  geometry: { type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] }
});

test("planning buildings merge sparse overrides and tombstones onto the static survey", () => {
  const result = resolveEffectiveBuildingFeatureCollection({
    baseFeatures: [feature("H001", 1), feature("H002", 2), feature("H003", 3)],
    dbRows: [
      { object_code: "H001", object_name: "updated", geom: feature("x", 10).geometry, props: {} },
      { object_code: "H002", is_deleted: true }
    ],
    getBaseCode: (item) => item.properties.code
  });
  assert.deepEqual(result.features.map((item) => item.properties.code), ["H003", "H001"]);
  assert.deepEqual(result.features[1].geometry, feature("x", 10).geometry);
});

test("personal buildings contain only current-version rows and never static fallbacks", () => {
  const result = resolveEffectiveBuildingFeatureCollection({
    baseFeatures: [feature("STATIC")],
    personalRows: [{ object_code: "P001", geom: feature("x", 20).geometry, props: {} }],
    isPersonalSpace: true,
    getBaseCode: (item) => item.properties.code
  });
  assert.deepEqual(result.features.map((item) => item.properties.code), ["P001"]);

  const empty = resolveEffectiveBuildingFeatureCollection({
    baseFeatures: [feature("STATIC")], personalRows: [], isPersonalSpace: true,
    getBaseCode: (item) => item.properties.code
  });
  assert.deepEqual(empty.features, []);
});

test("3D reloads whenever the linked 2D space changes", () => {
  assert.equal(shouldReloadBuildingSpace("space-a", "space-b", true), true);
  assert.equal(shouldReloadBuildingSpace("space-a", "space-a", true), false);
  assert.equal(shouldReloadBuildingSpace("space-a", "space-a", false), true);
});

test("persisted model scale adapts from its original footprint to the current version", () => {
  assert.deepEqual(
    getFootprintScaleFromExpected({ sizeX: 12, sizeY: 6 }, 8, 4),
    { x: 1.5, y: 1.5 }
  );
  assert.deepEqual(
    getFootprintScaleFromExpected({ sizeX: 4, sizeY: 8 }, 8, 4),
    { x: 1, y: 1 }
  );
});

test("3D building loads are serialized", async () => {
  const events = [];
  let releaseFirst;
  const run = createSerialTaskRunner(async (id) => {
    events.push(`start-${id}`);
    if (id === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    events.push(`end-${id}`);
  });
  const first = run(1);
  await new Promise((resolve) => queueMicrotask(resolve));
  const second = run(2);
  assert.deepEqual(events, ["start-1"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["start-1", "end-1", "start-2", "end-2"]);
});

test("三维合并保留由数据集解析器补号的本地建筑", () => {
  const normalized = datasetResolver.normalizeFeatureCollection({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { score: 0.9 },
      geometry: feature("x", 30).geometry
    }]
  }, "building");
  const result = resolveEffectiveBuildingFeatureCollection({
    baseFeatures: normalized.features,
    getBaseCode: (item) => item.properties.id
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.id, "AUTO_BUILDING_000001");
});
