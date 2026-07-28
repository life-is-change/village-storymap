const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveCurrentVersions,
  resolveFigureGroundLayerKeys,
  shouldRefreshLiveFigureGround,
  canEditPersonalLayer,
  groupVersionsByLayer,
  buildRawFeatureFromPersonalRow,
  renderPersonalVersionManager,
  createPersonalVersionCompare
} = require("./personal-layer-versions.js");

test("selections resolve one current version for each imported layer", () => {
  assert.deepEqual(resolveCurrentVersions([
    { layer_key: "building", current_version_id: "b-v2" },
    { layer_key: "road", current_version_id: "r-v1" },
    { layer_key: "water", current_version_id: "w-v1" },
    { layer_key: "contours", current_version_id: "c-v1" }
  ]), { building: "b-v2", road: "r-v1", water: "w-v1", contours: "c-v1" });
});

test("personal database rows become standard GeoJSON features for the existing renderer", () => {
  assert.deepEqual(buildRawFeatureFromPersonalRow({
    object_code: "H001",
    object_name: "识别建筑 1",
    geom: { type: "Polygon", coordinates: [] },
    props: { confidence: 0.9 }
  }), {
    type: "Feature",
    id: "H001",
    properties: { confidence: 0.9, object_code: "H001", name: "识别建筑 1" },
    geometry: { type: "Polygon", coordinates: [] }
  });
});

test("figure-ground is a dynamic four-layer composition", () => {
  assert.deepEqual(resolveFigureGroundLayerKeys(), ["building", "road", "water", "contours"]);
  assert.equal(canEditPersonalLayer("building"), true);
  assert.equal(canEditPersonalLayer("water"), true);
  assert.equal(canEditPersonalLayer("contours"), false);
  assert.equal(canEditPersonalLayer("contours", "delete"), true);
  assert.equal(canEditPersonalLayer("contours", "update"), false);
});

test("live figure-ground refreshes only for an active personal composition", () => {
  assert.equal(shouldRefreshLiveFigureGround({
    spaceType: "course_personal",
    selectedLayers: ["figureGround"]
  }), true);
  assert.equal(shouldRefreshLiveFigureGround({
    spaceType: "course_personal",
    selectedLayers: ["building"]
  }), false);
  assert.equal(shouldRefreshLiveFigureGround({
    spaceType: "course_group",
    selectedLayers: ["figureGround"]
  }), false);
});

test("versions are ordered newest first inside each layer", () => {
  const grouped = groupVersionsByLayer([
    { id: "b1", layer_key: "building", version_number: 1 },
    { id: "b2", layer_key: "building", version_number: 2 },
    { id: "r1", layer_key: "road", version_number: 1 }
  ]);
  assert.deepEqual(grouped.building.map((item) => item.id), ["b2", "b1"]);
  assert.deepEqual(grouped.road.map((item) => item.id), ["r1"]);
});

test("personal version manager exposes switch compare and non-current deletion", () => {
  const html = renderPersonalVersionManager({
    versions: [
      { id: "b2", layer_key: "building", version_number: 2, feature_count: 12, editable: true },
      { id: "b1", layer_key: "building", version_number: 1, feature_count: 10, editable: true }
    ],
    selections: [{ layer_key: "building", current_version_id: "b2" }]
  });
  assert.match(html, /data-personal-version-select="building"/);
  assert.match(html, /value="b2" selected/);
  assert.match(html, /data-personal-version-compare="b1"/);
  assert.match(html, /data-personal-version-delete="b1"/);
  assert.doesNotMatch(html, /data-personal-version-delete="b2"/);
});

test("comparison controller renders database rows as a temporary map layer", () => {
  const calls = [];
  class VectorSource {
    addFeatures(features) { calls.push(["features", features]); }
    clear() { calls.push(["clear"]); }
  }
  class VectorLayer {
    constructor(options) { this.options = options; }
    setZIndex(value) { this.zIndex = value; }
    setOpacity(value) { this.opacity = value; }
  }
  class GeoJSON {
    readFeatures(collection) { return collection.features; }
  }
  const map = {
    addLayer(layer) { calls.push(["add", layer]); },
    removeLayer(layer) { calls.push(["remove", layer]); },
    getView() { return { getProjection: () => "EPSG:4326" }; }
  };
  const controller = createPersonalVersionCompare({
    map,
    ol: { VectorSource, VectorLayer, GeoJSON }
  });
  controller.show([{ object_code: "B1", geom: { type: "Polygon", coordinates: [] }, props: {} }]);
  assert.equal(calls.find((item) => item[0] === "add")[1].zIndex, 1050);
  assert.equal(calls.find((item) => item[0] === "features")[1][0].id, "B1");
});
