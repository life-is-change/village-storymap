const test = require("node:test");
const assert = require("node:assert/strict");
const { createScenePreviewAdapter } = require("./scene-preview-adapter");

function scene(ids) {
  return { layers: [{ id: "design", visible: true }], selectionBoundary: { type: "Polygon", coordinates: [[[114, 30], [114.001, 30], [114, 30.001], [114, 30]]] }, objects: ids.map((id) => ({
    id, kind: "asset", category: "tree", geometry: { type: "Point", coordinates: [114, 30] }, layerId: "design",
    properties: { assetRef: "tree" }, transform: { headingDeg: 90, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 2 }
  })) };
}

test("renders models with Cesium degree conversion, reuses ids and removes stale resources", async () => {
  const calls = [];
  const entities = new Map();
  const viewer = {
    entities: {
      add(value) { entities.set(value.id, value); calls.push(["add", value.id]); return value; },
      remove(value) { entities.delete(value.id); calls.push(["remove", value.id]); }
    },
    camera: { flyTo(options) { calls.push(["fly", options.destination]); } },
    flyTo(entity) { calls.push(["fly-object", entity]); }
  };
  const Cesium = {
    Cartesian3: {
      fromDegrees(lon, lat, height) { calls.push(["degrees", lon, lat, height]); return { lon, lat, height }; },
      fromDegreesArray(values) { return values; }
    },
    HeadingPitchRoll: class HeadingPitchRoll { constructor(heading, pitch, roll) { Object.assign(this, { heading, pitch, roll }); } },
    Transforms: { headingPitchRollQuaternion(position, hpr) { return { position, hpr }; } },
    Color: { WHITE: { withAlpha: (alpha) => ({ alpha }) }, GRAY: {}, RED: {}, YELLOW: {}, fromCssColorString: () => ({}) },
    HeightReference: { RELATIVE_TO_GROUND: "relative" }
  };
  const adapter = createScenePreviewAdapter({ Cesium, viewer, assetResolver: async () => "signed://tree.glb" });
  await adapter.render(scene(["one", "two"]), new Map([["tree", { id: "tree", fileType: "glb", storagePath: "tree.glb", status: "published" }]]));
  assert.equal(entities.has("scene-edit:selection-boundary"), true);
  assert.equal(entities.get("scene-edit:selection-boundary").polyline.clampToGround, true);
  assert.equal(calls.filter(([name]) => name === "degrees").length, 2);
  assert.equal(entities.get("scene-edit:one").model.uri, "signed://tree.glb");
  assert.equal(entities.get("scene-edit:one").orientation.hpr.heading, Math.PI / 2);
  await adapter.render(scene(["one"]), new Map([["tree", { id: "tree", fileType: "glb", storagePath: "tree.glb", status: "published" }]]));
  assert.equal(calls.filter((call) => call[0] === "add" && call[1] === "scene-edit:one").length, 1);
  assert.deepEqual(calls.at(-1), ["remove", "scene-edit:two"]);
  adapter.select(["one"]);
  assert.equal(entities.get("scene-edit:one").show, true);
  assert.equal(adapter.flyToObject("one"), true);
  assert.equal(calls.some(([name, value]) => name === "fly-object" && value?.id === "scene-edit:one"), true);
  adapter.flyToBoundary(scene([]).selectionBoundary);
  assert.equal(calls.some(([name]) => name === "fly"), true);
  adapter.dispose();
  assert.equal(entities.size, 0);
});

test("limits model resolution to four and uses a labeled box when GLB resolution fails", async () => {
  let active = 0;
  let maximum = 0;
  const viewer = { entities: { values: [], add(value) { this.values.push(value); return value; }, remove() {} }, camera: { flyTo() {} } };
  const Cesium = { Cartesian3: { fromDegrees: (...v) => v, fromDegreesArray: (v) => v }, HeadingPitchRoll: class {}, Transforms: { headingPitchRollQuaternion: () => ({}) }, Color: { WHITE: { withAlpha: () => ({}) }, GRAY: {} }, HeightReference: {} };
  const adapter = createScenePreviewAdapter({
    Cesium, viewer,
    assetResolver: async (_asset, descriptor) => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (descriptor.sourceObjectId === "bad") throw new Error("missing");
      return `signed://${descriptor.sourceObjectId}`;
    }
  });
  const rendering = adapter.render(scene(["a", "b", "c", "d", "e", "bad"]), new Map([["tree", { id: "tree", fileType: "glb", storagePath: "tree.glb", status: "published" }]]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 4);
  await rendering;
  const bad = viewer.entities.values.find((entity) => entity.id === "scene-edit:bad");
  assert.equal(bad.box !== undefined, true);
  assert.equal(bad.label.text.includes("模型不可用"), true);
});

test("bundled local models bypass remote signing and stay relative to terrain", async () => {
  const entities = [];
  const viewer = { entities: { add(value) { entities.push(value); return value; }, remove() {} }, camera: { flyTo() {} } };
  const Cesium = {
    Cartesian3: { fromDegrees: (...value) => value, fromDegreesArray: (value) => value },
    HeadingPitchRoll: class {},
    Transforms: { headingPitchRollQuaternion: () => ({}) },
    Color: { WHITE: { withAlpha: () => ({}) }, GRAY: {} },
    HeightReference: { RELATIVE_TO_GROUND: "relative" }
  };
  let signingCalls = 0;
  const adapter = createScenePreviewAdapter({
    Cesium,
    viewer,
    assetResolver: async () => { signingCalls += 1; throw new Error("local asset must not be signed"); }
  });
  await adapter.render(scene(["local"]), new Map([["tree", {
    id: "tree", fileType: "glb", url: "3D_scenes_edit/assets/models/tree.glb", status: "published"
  }]]));
  const model = entities.find((entity) => entity.id === "scene-edit:local")?.model;
  assert.equal(signingCalls, 0);
  assert.equal(model?.uri, "3D_scenes_edit/assets/models/tree.glb");
  assert.equal(model?.heightReference, "relative");
});

test("maps Cesium picks to document ids and reuses a real model placement ghost", () => {
  const entities = [];
  let additions = 0;
  const viewer = { entities: { add(value) { entities.push(value); return value; }, remove(value) { const index = entities.indexOf(value); if (index >= 0) entities.splice(index, 1); } }, camera: {} };
  viewer.entities.add = (value) => { additions += 1; entities.push(value); return value; };
  const Cesium = {
    Cartesian3: { fromDegrees: (...value) => value },
    Color: { YELLOW: { withAlpha: (alpha) => ({ alpha }) }, WHITE: { withAlpha: (alpha) => ({ alpha }) } },
    ColorBlendMode: { MIX: "mix" },
    HeightReference: { RELATIVE_TO_GROUND: "relative" }
  };
  const adapter = createScenePreviewAdapter({ Cesium, viewer });
  assert.equal(adapter.pickObjectId({ id: { properties: { sourceObjectId: { getValue: () => "o1" } } } }), "o1");
  assert.equal(adapter.pickObjectId({ id: { id: "scene-edit:o2" } }), "o2");
  assert.equal(adapter.pickObjectId({ id: { id: "other" } }), null);
  const asset = { id: "table", displayName: "休闲桌", url: "3D_scenes_edit/assets/models/table.glb?v=test" };
  adapter.setGhost(asset, [114, 23, 1]);
  adapter.setGhost(asset, [114.001, 23.002, 2]);
  assert.equal(additions, 1);
  assert.equal(entities[0].id, "scene-edit-placement-ghost");
  assert.deepEqual(entities[0].position, [114.001, 23.002, 0]);
  assert.equal(entities[0].model.uri, "3D_scenes_edit/assets/models/table.glb?v=test");
  assert.equal(entities[0].model.heightReference, "relative");
  assert.equal(entities[0].box, undefined);
  assert.equal(entities[0].label.heightReference, "relative");
  adapter.clearGhost();
  assert.equal(entities.length, 0);
});
