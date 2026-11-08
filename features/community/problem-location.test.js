const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("locating a saved problem restores its marker and reuses it on subsequent clicks", async () => {
  const source = fs.readFileSync("app.js", "utf8");
  const start = source.indexOf('    listEl.querySelectorAll("[data-msg-locate]")');
  const end = source.indexOf('    listEl.querySelectorAll("[data-msg-reply]")', start);
  let click;
  const button = { dataset: { msgLocate: "12" }, addEventListener: (_, handler) => { click = handler; } };
  const features = [];
  const centers = [];
  const village = {};
  const categories = new Set();
  const context = {
    listEl: { querySelectorAll: () => [button] },
    messages: [{ id: 12, lng: 113.25, lat: 23.13, category: "garbage" }],
    boardSpaceId: "space", currentSpaceId: "space",
    boardVillageContext: village, activeVillageContext: village,
    plan2dView: { classList: { contains: () => true } },
    planVectorSource: { getFeatures: () => features },
    planMap: { getView: () => ({ setCenter: coords => centers.push(coords), setZoom() {} }) },
    olReady: Promise.resolve({ GeoJSON: class {} }),
    window: { CommunityProblemTypes: { filterKey: key => key } },
    communityTaskVisibleCategories: categories,
    syncCommunityTaskUiState() {}, saveAppState() {}, doSetActiveFeature() {},
    planVectorLayer: { changed() {} },
    showToast: message => assert.fail(message),
    addCommunityTaskFeatureToMap(record) {
      const feature = {
        get: () => "TASK_" + record.id,
        getGeometry: () => ({ getCoordinates: () => [record.lng, record.lat] })
      };
      features.push(feature);
      return feature;
    }
  };
  vm.runInNewContext(source.slice(start, end), context);
  await click();
  await click();
  assert.equal(features.length, 1);
  assert.deepEqual(centers, [[113.25, 23.13], [113.25, 23.13]]);
  assert(categories.has("garbage"));

  context.currentSpaceId = "other-space";
  await click();
  assert.equal(centers.length, 2);
});
