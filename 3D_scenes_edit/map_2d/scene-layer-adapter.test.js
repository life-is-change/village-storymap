const test = require("node:test");
const assert = require("node:assert/strict");

const SceneDocument = require("../domain/scene-document");
const Layers = require("./scene-layer-adapter");

function documentFixture() {
  const doc = SceneDocument.create({ projectId: "p", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 1 });
  doc.layers.push({ id: "hidden", name: "隐藏", visible: false, locked: false, order: 1 });
  doc.objects = [
    { id: "surface", kind: "surface", category: "paving", geometry: { type: "Polygon", coordinates: [[[114, 30], [114.001, 30], [114.001, 30.001], [114, 30]]] }, properties: {}, layerId: "design" },
    { id: "line", kind: "line", category: "path", geometry: { type: "LineString", coordinates: [[114, 30], [114.001, 30.001]] }, properties: { widthM: 1.5 }, layerId: "design" },
    { id: "bench", kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.0005, 30.0005] }, transform: { headingDeg: 30, pitchDeg: 0, rollDeg: 0, scale: [2, 1, 1], heightOffsetM: 0 }, properties: { footprintM: [1.8, 0.6] }, layerId: "design" },
    { id: "hidden-tree", kind: "asset", category: "tree", geometry: { type: "Point", coordinates: [114, 30] }, transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 }, properties: {}, layerId: "hidden" }
  ];
  return doc;
}

test("builds point, line, surface and rotated footprint descriptors", () => {
  const descriptors = Layers.buildFeatureDescriptors(documentFixture(), { selectedIds: ["bench"], errorIds: ["line"] });
  assert.deepEqual(descriptors.map((item) => `${item.objectId}:${item.role}`), [
    "surface:geometry", "line:geometry", "bench:geometry", "bench:footprint"
  ]);
  assert.equal(descriptors.find((item) => item.objectId === "line").styleToken, "error");
  assert.equal(descriptors.find((item) => item.objectId === "bench").styleToken, "selected");
  assert.equal(descriptors.find((item) => item.role === "footprint").geometry.type, "Polygon");
});

test("locked layers produce locked style tokens unless selected or erroneous", () => {
  const doc = documentFixture();
  doc.layers[0].locked = true;
  const descriptors = Layers.buildFeatureDescriptors(doc, {});
  assert.equal(descriptors[0].styleToken, "locked");
});

test("adapter mounts a dedicated layer, replaces its source and disposes only itself", () => {
  const calls = [];
  class VectorSource {
    clear() { calls.push("clear"); }
    addFeatures(features) { calls.push(["add", features.length]); }
  }
  class VectorLayer { constructor(options) { this.options = options; } }
  class Feature {
    constructor(options) { this.options = options; this.values = {}; }
    setProperties(values) { this.values = values; }
  }
  class Point { constructor(coordinates) { this.coordinates = coordinates; } }
  class LineString extends Point {}
  class Polygon extends Point { getExtent() { return [1, 2, 3, 4]; } }
  const layer = { Vector: VectorLayer };
  const source = { Vector: VectorSource };
  const ol = { layer, source, Feature, geom: { Point, LineString, Polygon }, proj: { fromLonLat: (position) => position } };
  const map = {
    addLayer(value) { calls.push(["mount", value]); },
    removeLayer(value) { calls.push(["remove", value]); },
    forEachFeatureAtPixel(_pixel, callback) { return callback({ values: { sceneObjectId: "bench" } }, null); },
    getView() { return { fit(extent, options) { calls.push(["fit", extent, options]); } }; }
  };
  const adapter = Layers.createSceneLayerAdapter({ ol, map });
  adapter.mount();
  assert.equal(adapter.getSource() instanceof VectorSource, true);
  adapter.render(documentFixture(), {});
  assert.equal(adapter.hitTest([1, 2]), "bench");
  adapter.fitBoundary(documentFixture().objects[0].geometry);
  adapter.dispose();
  assert.deepEqual(calls.filter((call) => Array.isArray(call)).map((call) => call[0]), ["mount", "add", "fit", "remove"]);
});
