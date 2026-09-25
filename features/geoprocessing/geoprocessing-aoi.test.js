const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAoi, createAoiController } = require("./geoprocessing-aoi.js");

const BOUNDS = [113.6578225, 23.6739555, 113.6695615, 23.6806181];
const INSIDE = { type: "Polygon", coordinates: [[[113.661, 23.676], [113.665, 23.676], [113.665, 23.679], [113.661, 23.679], [113.661, 23.676]]] };
const OUTSIDE = { type: "Polygon", coordinates: [[[113.65, 23.67], [113.66, 23.67], [113.66, 23.68], [113.65, 23.67]]] };

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
  interaction.handlers.drawend();

  assert.deepEqual(map.removedInteractions, [interaction]);
  assert.deepEqual(controller.getGeoJSON(), INSIDE);
  controller.setVillageBounds([0, 0, 1, 1]);
  assert.deepEqual(controller.validate(), { ok: false, code: "AOI_OUT_OF_BOUNDS" });
  controller.setVillageBounds(BOUNDS);
  controller.setMaxAreaSqKm(0.01);
  assert.equal(controller.validate().code, "AOI_TOO_LARGE");
  assert.throws(() => controller.setMaxAreaSqKm(0), /AOI_MAX_AREA_INVALID/);
});
