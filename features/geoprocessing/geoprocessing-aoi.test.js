const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAoi, createAoiController, buildAoiDraftStorageKey } = require("./geoprocessing-aoi.js");

const BOUNDS = [113.6578225, 23.6739555, 113.6695615, 23.6806181];
const INSIDE = { type: "Polygon", coordinates: [[[113.661, 23.676], [113.665, 23.676], [113.665, 23.679], [113.661, 23.679], [113.661, 23.676]]] };
const OUTSIDE = { type: "Polygon", coordinates: [[[113.65, 23.67], [113.66, 23.67], [113.66, 23.68], [113.65, 23.67]]] };

test("AOI draft keys are isolated by account and village", () => {
  assert.equal(buildAoiDraftStorageKey("user-1", "mibu"), "village_aoi_draft_v1:user-1:mibu");
  assert.notEqual(buildAoiDraftStorageKey("user-1", "mibu"), buildAoiDraftStorageKey("user-2", "mibu"));
  assert.notEqual(buildAoiDraftStorageKey("user-1", "mibu"), buildAoiDraftStorageKey("user-1", "hongxing"));
  assert.equal(buildAoiDraftStorageKey("", "mibu"), "");
});

test("AOI outside registered imagery is rejected", () => {
  assert.deepEqual(validateAoi(OUTSIDE, BOUNDS), { ok: false, code: "AOI_OUT_OF_BOUNDS" });
});

test("valid AOI returns normalized polygon and area", () => {
  const result = validateAoi(INSIDE, BOUNDS, 2);
  assert.equal(result.ok, true);
  assert.equal(result.geometry.type, "Polygon");
  assert.ok(result.areaSqKm > 0 && result.areaSqKm < 2);
});

test("oversized AOI reports drawn area and the configured village limit", () => {
  const result = validateAoi(INSIDE, BOUNDS, 0.01);
  assert.equal(result.ok, false);
  assert.equal(result.code, "AOI_TOO_LARGE");
  assert.ok(result.areaSqKm > 0.01);
  assert.equal(result.maxAreaSqKm, 0.01);
});

test("unknown modern-village area limit does not impose the legacy 2 square kilometre cap", () => {
  const broadBounds = [113.6, 23.6, 113.8, 23.8];
  const broadAoi = { type: "Polygon", coordinates: [[
    [113.65, 23.65], [113.68, 23.65], [113.68, 23.68], [113.65, 23.68], [113.65, 23.65]
  ]] };
  const result = validateAoi(broadAoi, broadBounds, null);
  assert.equal(result.ok, true);
  assert.ok(result.areaSqKm > 2);
});

test("finishing one AOI exits drawing mode without clearing the completed polygon", () => {
  let aoiLayer = null;
  class FakeVectorSource {
    clear() {}
    getFeatures() { return [{ getGeometry: () => ({}) }]; }
  }
  class FakeVectorLayer {
    constructor(options) {
      this.source = options.source;
      this.options = options;
      aoiLayer = this;
    }
  }
  class FakeDraw {
    constructor() { this.handlers = {}; }
    on(event, handler) { this.handlers[event] = handler; }
  }
  class FakeGeoJSON {
    writeGeometryObject() { return INSIDE; }
  }
  const map = {
    addedInteractions: [],
    removedInteractions: [],
    addLayer() {},
    removeLayer() {},
    addInteraction(interaction) { this.addedInteractions.push(interaction); },
    removeInteraction(interaction) { this.removedInteractions.push(interaction); },
    getView() { return { getProjection: () => "EPSG:4326" }; }
  };
  const controller = require("./geoprocessing-aoi.js").createAoiController({
    map,
    ol: {
      VectorSource: FakeVectorSource,
      VectorLayer: FakeVectorLayer,
      Draw: FakeDraw,
      GeoJSON: FakeGeoJSON
    },
    villageBounds: BOUNDS
  });

  controller.start();
  assert.ok(aoiLayer.options.zIndex > 2, "completed AOI must render above imagery layers");
  const interaction = map.addedInteractions[0];
  assert.equal(typeof interaction.handlers.drawend, "function");
  interaction.handlers.drawend({ feature: { getGeometry: () => ({}) } });

  assert.deepEqual(map.removedInteractions, [interaction]);
  assert.deepEqual(controller.getGeoJSON(), INSIDE);
  controller.setVillageBounds([0, 0, 1, 1]);
  assert.deepEqual(controller.validate(), { ok: false, code: "AOI_OUT_OF_BOUNDS" });
  controller.setVillageBounds(BOUNDS);
  controller.setMaxAreaSqKm(0.01);
  assert.equal(controller.validate().code, "AOI_TOO_LARGE");
  assert.throws(() => controller.setMaxAreaSqKm(0), /AOI_MAX_AREA_INVALID/);
});

test("completed AOI survives controller remount for the same account and village until explicitly cleared", () => {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key)
  };
  class VectorSource {
    constructor() { this.features = []; }
    clear() { this.features = []; }
    addFeature(feature) { this.features.push(feature); }
    getFeatures() { return this.features; }
  }
  class VectorLayer { constructor(options) { this.source = options.source; } }
  class Draw {
    constructor(options) { this.source = options.source; this.handlers = {}; }
    on(name, handler) { this.handlers[name] = handler; }
  }
  class GeoJSON {
    writeGeometryObject(geometry) { return geometry; }
    readFeature(feature) { return { getGeometry: () => feature.geometry }; }
  }
  const map = {
    interactions: [],
    addLayer() {}, removeLayer() {},
    addInteraction(value) { this.interactions.push(value); },
    removeInteraction() {},
    getView() { return { getProjection: () => "EPSG:4326" }; }
  };
  const options = {
    map, ol: { VectorSource, VectorLayer, Draw, GeoJSON },
    villageBounds: BOUNDS, storage, storageKey: "aoi:user-1:mibu"
  };
  const first = createAoiController(options);
  first.start();
  const feature = { getGeometry: () => INSIDE };
  // OpenLayers fires drawend before adding the completed feature to the source.
  const interaction = map.interactions[0];
  interaction.handlers.drawend({ feature });
  interaction.source.addFeature(feature);
  assert.deepEqual(first.getGeoJSON(), INSIDE);
  first.destroy();

  const restored = createAoiController(options);
  assert.deepEqual(restored.getGeoJSON(), INSIDE);
  assert.equal(restored.validate().ok, true);
  restored.clear();
  assert.equal(saved.size, 0);
  restored.destroy();
  assert.equal(createAoiController(options).getGeoJSON(), null);
  assert.equal(createAoiController({ ...options, storageKey: "aoi:user-2:mibu" }).getGeoJSON(), null);
});
