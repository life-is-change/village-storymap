const test = require("node:test");
const assert = require("node:assert/strict");
const { renderGeoprocessingForm } = require("./geoprocessing-panel.js");

test("panel defaults to all processors and safe parameters", () => {
  const html = renderGeoprocessingForm({ availability: "available" });
  assert.match(html, /value="buildings"[^>]*checked/);
  assert.match(html, /value="roads_water"[^>]*checked/);
  assert.match(html, /value="contours"[^>]*checked/);
  assert.match(html, /value="5"[^>]*selected/);
  assert.match(html, /value="0.35"/);
});
