const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapArtifactType,
  groupArtifacts,
  createResultLayerPreview
} = require("./geoprocessing-result-layers.js");

test("artifact types map to the four personal figure-ground layers", () => {
  assert.equal(mapArtifactType("buildings"), "building");
  assert.equal(mapArtifactType("roads"), "road");
  assert.equal(mapArtifactType("waterways"), "water");
  assert.equal(mapArtifactType("water_areas"), "water");
  assert.equal(mapArtifactType("contours"), "contours");
  assert.equal(mapArtifactType("manifest"), null);
});

test("line and polygon water artifacts share one preview layer", () => {
  const grouped = groupArtifacts([
    { artifact_type: "waterways" },
    { artifact_type: "water_areas" },
    { artifact_type: "roads" }
  ]);
  assert.equal(grouped.water.length, 2);
  assert.equal(grouped.road.length, 1);
});

test("preview replaces previous temporary result features", async () => {
  const sources = [];
  const map = { added: [], removed: [], addLayer(layer) { this.added.push(layer); }, removeLayer(layer) { this.removed.push(layer); } };
  class VectorSource {
    constructor() { this.features = []; sources.push(this); }
    clear() { this.features = []; }
    addFeatures(features) { this.features.push(...features); }
  }
  class VectorLayer { constructor(options) { this.options = options; } setVisible(value) { this.visible = value; } }
  class GeoJSON { readFeatures(data) { return data.features; } }
  const preview = createResultLayerPreview({
    map,
    ol: { VectorSource, VectorLayer, GeoJSON },
    fetchJson: async (artifact) => ({ features: [{ id: artifact.artifact_type }] })
  });
  await preview.show([{ artifact_type: "roads" }]);
  await preview.show([{ artifact_type: "buildings" }]);
  assert.deepEqual(sources.flatMap((source) => source.features.map((feature) => feature.id)), ["buildings"]);
  preview.destroy();
  assert.equal(map.removed.length, 4);
});

test("temporary preview visibility follows workspace layer controls", async () => {
  const layers = [];
  class VectorSource {
    constructor() { this.features = []; }
    clear() { this.features = []; }
    addFeatures(features) { this.features.push(...features); }
  }
  class VectorLayer {
    constructor(options) { this.options = options; this.visible = true; layers.push(this); }
    setVisible(value) { this.visible = value; }
  }
  class GeoJSON { readFeatures(data) { return data.features; } }
  const preview = createResultLayerPreview({
    map: { addLayer() {}, removeLayer() {}, getView() { return { getProjection: () => "EPSG:4326" }; } },
    ol: { VectorSource, VectorLayer, GeoJSON },
    fetchJson: async (artifact) => ({ features: [{ id: artifact.artifact_type }] })
  });
  await preview.show([{ artifact_type: "buildings" }, { artifact_type: "roads" }]);
  assert.equal(preview.hasPreview(), true);
  preview.syncVisibleLayers(["road"]);
  assert.deepEqual(layers.map((layer) => layer.visible), [false, true, false, false]);
  preview.syncVisibleLayers(["figureGround"]);
  assert.deepEqual(layers.map((layer) => layer.visible), [true, true, true, true]);
  preview.clear();
  assert.equal(preview.hasPreview(), false);
});
