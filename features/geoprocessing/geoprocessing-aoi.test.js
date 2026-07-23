const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAoi } = require("./geoprocessing-aoi.js");

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
});
