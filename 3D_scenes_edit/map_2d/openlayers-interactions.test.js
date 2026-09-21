const test = require("node:test");
const assert = require("node:assert/strict");

const Interactions = require("./openlayers-interactions");

class Interaction {
  constructor(options) { this.options = options; this.listeners = {}; }
  on(name, listener) { this.listeners[name] = listener; }
  emit(name, event) { this.listeners[name]?.(event); }
}

test("activates draw tools and returns WGS84 geometry without retaining temporary features", () => {
  const added = [];
  const removed = [];
  const created = [];
  const source = { removeFeature: (feature) => removed.push(feature) };
  const map = { addInteraction: (value) => added.push(value), removeInteraction: (value) => removed.push(value) };
  const ol = { interaction: { Draw: Interaction, Snap: Interaction }, geom: {}, format: { GeoJSON: class { writeGeometryObject() { return { type: "LineString", coordinates: [[114, 30], [114.1, 30.1]] }; } } } };
  ol.interaction.Draw.createBox = () => "box";
  const bridge = Interactions.createOpenLayersInteractions({ ol, map, source, layer: {}, projection: "EPSG:3857", onCreate: (tool, geometry) => created.push([tool, geometry]) });
  bridge.activate("draw-line");
  added[0].emit("drawend", { feature: { getGeometry: () => ({}) } });
  assert.equal(added[1] instanceof Interaction, true);
  assert.deepEqual(created, [["draw-line", { type: "LineString", coordinates: [[114, 30], [114.1, 30.1]] }]]);
  assert.equal(removed.length, 1);
  bridge.activate("draw-rectangle");
  assert.equal(added[2].options.geometryFunction, "box");
  bridge.dispose();
  assert.equal(removed.includes(added[2]), true);
});

test("select and translate emit canonical object ids and updated geometry", () => {
  const added = [];
  const selections = [];
  const changes = [];
  const collection = { getArray: () => [{ get: (key) => key === "sceneObjectId" ? "o1" : "geometry", getGeometry: () => ({}) }] };
  class Select extends Interaction { getFeatures() { return collection; } }
  const map = { addInteraction: (value) => added.push(value), removeInteraction() {} };
  const ol = {
    interaction: { Select, Translate: Interaction, Modify: Interaction },
    format: { GeoJSON: class { writeGeometryObject() { return { type: "Point", coordinates: [114, 30] }; } } }
  };
  const bridge = Interactions.createOpenLayersInteractions({ ol, map, source: {}, layer: {}, onSelect: (ids) => selections.push(ids), onGeometryChange: (id, geometry) => changes.push([id, geometry]) });
  bridge.activate("move");
  added[0].emit("select", {});
  added[1].emit("translateend", {});
  assert.deepEqual(selections, [["o1"]]);
  assert.deepEqual(changes, [["o1", { type: "Point", coordinates: [114, 30] }]]);
});

test("geometry edits use the projection reported by the map view", () => {
  const added = [];
  let writeOptions = null;
  const collection = { getArray: () => [{ get: (key) => key === "sceneObjectId" ? "o1" : "geometry", getGeometry: () => ({}) }] };
  class Select extends Interaction { getFeatures() { return collection; } }
  const map = {
    addInteraction: (value) => added.push(value), removeInteraction() {},
    getView() { return { getProjection: () => ({ getCode: () => "EPSG:4326" }) }; }
  };
  const ol = {
    interaction: { Select, Translate: Interaction },
    format: { GeoJSON: class {
      writeGeometryObject(_geometry, options) {
        writeOptions = options;
        return { type: "Point", coordinates: [114, 30] };
      }
    } }
  };
  const bridge = Interactions.createOpenLayersInteractions({ ol, map, source: {}, layer: {}, onGeometryChange() {} });
  bridge.activate("move");
  added[1].emit("translateend", {});
  assert.deepEqual(writeOptions, { dataProjection: "EPSG:4326", featureProjection: "EPSG:4326" });
});
