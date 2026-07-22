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
