const test = require("node:test");
const assert = require("node:assert/strict");

const SceneDocument = require("../domain/scene-document");
const Layers = require("./scene-layer-adapter");

function documentFixture() {
  const doc = SceneDocument.create({ projectId: "p", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 1,
    selectionBoundary: { type: "Polygon", coordinates: [[[114, 30], [114.002, 30], [114.002, 30.002], [114, 30]]] } });
  doc.layers.push({ id: "hidden", name: "隐藏", visible: false, locked: false, order: 1 });
  doc.objects = [
    { id: "surface", kind: "surface", category: "paving", geometry: { type: "Polygon", coordinates: [[[114, 30], [114.001, 30], [114.001, 30.001], [114, 30]]] }, properties: {}, layerId: "design" },
    { id: "line", kind: "line", category: "path", geometry: { type: "LineString", coordinates: [[114, 30], [114.001, 30.001]] }, properties: { widthM: 1.5 }, layerId: "design" },
    { id: "bench", kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.0005, 30.0005] }, transform: { headingDeg: 30, pitchDeg: 0, rollDeg: 0, scale: [2, 1, 1], heightOffsetM: 0 }, properties: { assetRef: "seed:bench:wood", footprintM: [1.8, 0.6] }, layerId: "design" },
    { id: "hidden-tree", kind: "asset", category: "tree", geometry: { type: "Point", coordinates: [114, 30] }, transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 }, properties: {}, layerId: "hidden" }
  ];
  return doc;
}

test("builds point, line, surface and rotated footprint descriptors", () => {
  const descriptors = Layers.buildFeatureDescriptors(documentFixture(), { selectedIds: ["bench"], errorIds: ["line"] });
  assert.deepEqual(descriptors.map((item) => `${item.objectId}:${item.role}`), [
    "null:boundary", "surface:geometry", "line:geometry", "bench:geometry", "bench:footprint"
  ]);
  assert.equal(descriptors.find((item) => item.objectId === "line").styleToken, "error");
  assert.equal(descriptors.find((item) => item.objectId === "bench").styleToken, "selected");
  assert.equal(descriptors.find((item) => item.role === "footprint").geometry.type, "Polygon");
});

test("adds a non-selectable cyan design boundary to the 2D scene overlay", () => {
  const boundary = Layers.buildFeatureDescriptors(documentFixture(), {}).find((item) => item.role === "boundary");
  assert.equal(boundary.objectId, null);
  assert.equal(boundary.kind, "boundary");
  assert.equal(boundary.styleToken, "boundary");
  assert.equal(boundary.geometry.type, "Polygon");
});

test("locked layers produce locked style tokens unless selected or erroneous", () => {
  const doc = documentFixture();
  doc.layers[0].locked = true;
  const descriptors = Layers.buildFeatureDescriptors(doc, {});
  assert.equal(descriptors.find((item) => item.objectId === "surface").styleToken, "locked");
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
  assert.equal(adapter.getLayer().options.zIndex, 1200);
  adapter.mount();
  assert.equal(adapter.getSource() instanceof VectorSource, true);
  adapter.render(documentFixture(), {});
  assert.equal(adapter.hitTest([1, 2]), "bench");
  adapter.fitBoundary(documentFixture().objects[0].geometry);
  adapter.dispose();
  assert.deepEqual(calls.filter((call) => Array.isArray(call)).map((call) => call[0]), ["mount", "add", "fit", "remove"]);
});

test("adapter uses the map view projection for scene geometry and boundary fitting", () => {
  class VectorSource {
    clear() { this.features = []; }
    addFeatures(features) { this.features = features; }
  }
  class VectorLayer { constructor(options) { this.options = options; } }
  class Feature {
    constructor(options) { this.options = options; this.values = {}; }
    setProperties(values) { this.values = values; }
  }
  class Geometry {
    constructor(coordinates) { this.coordinates = coordinates; }
    getExtent() { return [114, 30, 114.002, 30.002]; }
  }
  const projectionCalls = [];
  const ol = {
    source: { Vector: VectorSource }, layer: { Vector: VectorLayer }, Feature,
    geom: { Point: Geometry, LineString: Geometry, Polygon: Geometry },
    proj: {
      fromLonLat(position) { projectionCalls.push(["mercator", position]); return [999999, 999999]; },
      transform(position, source, target) { projectionCalls.push([source, target]); return position.slice(); }
    }
  };
  const map = {
    addLayer() {}, removeLayer() {},
    getView() {
      return {
        getProjection() { return { getCode: () => "EPSG:4326" }; },
        fit() {}
      };
    }
  };
  const adapter = Layers.createSceneLayerAdapter({ ol, map });
  adapter.render(documentFixture(), {});
  const bench = adapter.getSource().features.find((feature) => feature.values.sceneObjectId === "bench" && feature.values.sceneRole === "geometry");
  assert.deepEqual(bench.options.geometry.coordinates, [114.0005, 30.0005]);
  assert.equal(projectionCalls.some(([source, target]) => source === "EPSG:4326" && target === "EPSG:4326"), true);
  assert.equal(projectionCalls.some(([kind]) => kind === "mercator"), false);
});

test("2D scene symbols keep placed assets and paths visible over imagery", () => {
  class VectorSource { clear() {} addFeatures() {} }
  class VectorLayer { constructor(options) { this.options = options; } }
  class Feature {
    constructor() { this.values = {}; }
    setProperties(values) { this.values = values; }
    get(key) { return this.values[key]; }
  }
  class Geometry { constructor(coordinates) { this.coordinates = coordinates; } }
  class Style { constructor(options) { this.options = options; } }
  class Fill { constructor(options) { this.options = options; } }
  class Stroke { constructor(options) { this.options = options; } }
  class Circle { constructor(options) { this.options = options; } }
  const ol = {
    source: { Vector: VectorSource }, layer: { Vector: VectorLayer }, Feature,
    geom: { Point: Geometry, LineString: Geometry, Polygon: Geometry },
    proj: { fromLonLat: (position) => position },
    style: { Style, Fill, Stroke, Circle }
  };
  const adapter = Layers.createSceneLayerAdapter({ ol, map: { addLayer() {}, removeLayer() {} } });
  const footprint = new Feature();
  footprint.setProperties({ sceneStyleToken: "normal", sceneRole: "footprint", sceneKind: "asset", sceneCategory: "bench" });
  const path = new Feature();
  path.setProperties({ sceneStyleToken: "normal", sceneRole: "geometry", sceneKind: "line", sceneCategory: "path" });

  const footprintStyle = adapter.getLayer().options.style(footprint);
  const pathStyle = adapter.getLayer().options.style(path).options;
  assert.equal(footprintStyle, null);
  assert.equal(pathStyle.stroke.options.width >= 4, true);
});

test("2D assets use rotated top-view icons and show footprints only while selected", () => {
  class VectorSource { clear() { this.features = []; } addFeatures(features) { this.features = features; } }
  class VectorLayer { constructor(options) { this.options = options; } changed() { this.changedCount = (this.changedCount || 0) + 1; } }
  class Feature {
    constructor(options) { this.options = options; this.values = {}; }
    setProperties(values) { this.values = values; }
    get(key) { return this.values[key]; }
  }
  class Geometry { constructor(coordinates) { this.coordinates = coordinates; } }
  class Style { constructor(options) { this.options = options; } }
  class Fill { constructor(options) { this.options = options; } }
  class Stroke { constructor(options) { this.options = options; } }
  class Circle { constructor(options) { this.options = options; } }
  class Icon { constructor(options) { this.options = options; } }
  const ol = {
    source: { Vector: VectorSource }, layer: { Vector: VectorLayer }, Feature,
    geom: { Point: Geometry, LineString: Geometry, Polygon: Geometry },
    proj: { fromLonLat: (position) => position },
    style: { Style, Fill, Stroke, Circle, Icon }
  };
  const adapter = Layers.createSceneLayerAdapter({ ol, map: { addLayer() {}, removeLayer() {} } });
  adapter.setAssets([{ id: "seed:bench:wood", topViewUrl: "bench-top.png" }]);
  adapter.render(documentFixture(), {});
  const geometry = adapter.getSource().features.find((feature) => feature.values.sceneObjectId === "bench" && feature.values.sceneRole === "geometry");
  const footprint = adapter.getSource().features.find((feature) => feature.values.sceneObjectId === "bench" && feature.values.sceneRole === "footprint");
  const iconStyle = adapter.getLayer().options.style(geometry).options;
  assert.equal(iconStyle.image instanceof Icon, true);
  assert.equal(iconStyle.image.options.src, "bench-top.png");
  assert.equal(iconStyle.image.options.rotation, Math.PI / 6);
  assert.equal(adapter.getLayer().options.style(footprint), null);

  geometry.setProperties({ ...geometry.values, sceneStyleToken: "selected" });
  footprint.setProperties({ ...footprint.values, sceneStyleToken: "selected" });
  assert.ok(adapter.getLayer().options.style(footprint));
});
