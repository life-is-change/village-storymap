const test = require("node:test");
const assert = require("node:assert/strict");
const { toCesiumDescriptors } = require("./scene-to-cesium");

function object(id, kind, category, geometry, properties = {}, transform) {
  return { id, kind, category, geometry, properties, transform, layerId: "design", zIndex: 0 };
}

test("converts one scene document into model, instance, surface, line and fallback descriptors", () => {
  const transform = { headingDeg: 90, pitchDeg: 10, rollDeg: -5, scale: [2, 2, 3], heightOffsetM: 1.5 };
  const document = { layers: [{ id: "design", visible: true }], objects: [
    object("tree-1", "asset", "tree", { type: "Point", coordinates: [114, 30] }, { assetRef: "seed:tree:1", displayName: "树" }, transform),
    object("tree-2", "asset", "tree", { type: "Point", coordinates: [114.001, 30] }, { assetRef: "seed:tree:1" }, transform),
    object("bench-1", "asset", "bench", { type: "Point", coordinates: [114, 30.001] }, { assetRef: "group:missing", footprintM: [1.8, .7], displayName: "座椅" }, transform),
    object("grass-1", "surface", "grass", { type: "Polygon", coordinates: [[[114, 30], [114.001, 30], [114.001, 30.001], [114, 30]]] }, { materialRef: "grass", extrusionHeightM: .1 }),
    object("path-1", "line", "path", { type: "LineString", coordinates: [[114, 30], [114.001, 30.001]] }, { widthM: 2 })
  ] };
  const output = toCesiumDescriptors(document, new Map([["seed:tree:1", { id: "seed:tree:1", fileType: "glb", storagePath: "seed/tree.glb", status: "published" }]]));

  assert.equal(output.models.length, 2);
  assert.equal(output.instances.length, 1);
  assert.equal(output.models[0].batchKey, output.models[1].batchKey);
  assert.deepEqual(output.models[0].positionDegrees, [114, 30, 1.5]);
  assert.equal(output.models[0].orientationRadians.heading, Math.PI / 2);
  assert.equal(output.models[0].orientationRadians.pitch, 10 * Math.PI / 180);
  assert.deepEqual(output.models[0].scale, [2, 2, 3]);
  assert.equal(output.polygons[0].sourceObjectId, "grass-1");
  assert.equal(output.polylines[0].widthM, 2);
  assert.equal(output.fallbacks[0].sourceObjectId, "bench-1");
  assert.equal(output.fallbacks[0].label, "座椅");
});

test("routes seed renderers to recognizable procedural descriptors", () => {
  const document = { layers: [{ id: "design", visible: true }], objects: [
    object("bench", "asset", "bench", { type: "Point", coordinates: [114, 30] }, { assetRef: "seed:bench" }, { headingDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 })
  ] };
  const output = toCesiumDescriptors(document, new Map([["seed:bench", { id: "seed:bench", renderer: "procedural-bench", footprintM: [1.8, .65], defaultHeightM: .85 }]]));
  assert.equal(output.procedurals.length, 1);
  assert.equal(output.procedurals[0].renderer, "procedural-bench");
  assert.equal(output.fallbacks.length, 0);
});

test("routes bundled local GLB urls to models without requiring a storage path", () => {
  const document = { layers: [{ id: "design", visible: true }], objects: [
    object("bench", "asset", "bench", { type: "Point", coordinates: [114, 30] }, { assetRef: "seed:bench" }, { headingDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 })
  ] };
  const output = toCesiumDescriptors(document, new Map([["seed:bench", {
    id: "seed:bench", fileType: "glb", url: "3D_scenes_edit/assets/models/bench.glb", status: "published"
  }]]));
  assert.equal(output.models.length, 1);
  assert.equal(output.models[0].url, "3D_scenes_edit/assets/models/bench.glb");
  assert.equal(output.procedurals.length, 0);
});

test("omits objects on hidden layers", () => {
  const output = toCesiumDescriptors({ layers: [{ id: "hidden", visible: false }], objects: [object("x", "surface", "grass", { type: "Polygon", coordinates: [] }, {}, undefined)] }, new Map());
  assert.deepEqual(output, { models: [], instances: [], polygons: [], polylines: [], procedurals: [], fallbacks: [] });
});

test("line descriptors preserve the catalog renderer instead of collapsing every facility to a generic line", () => {
  const document = { layers: [{ id: "design", visible: true }], objects: [
    object("path-1", "line", "path", { type: "LineString", coordinates: [[114, 30], [114.001, 30.001]] }, { assetRef: "seed:path:gravel", widthM: 1.5 })
  ] };
  const output = toCesiumDescriptors(document, new Map([["seed:path:gravel", {
    id: "seed:path:gravel", renderer: "wide-line", footprintM: [1.5, 4], defaultHeightM: .04
  }]]));
  assert.equal(output.polylines[0].renderer, "wide-line");
  assert.equal(output.polylines[0].heightM, .04);
});
