const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveContourValue } = require("./contour-utils.js");

test("contour labels accept elevation_m from generated personal contours", () => {
  const feature = { get: (key) => ({ elevation_m: 126.5 })[key] };
  assert.equal(resolveContourValue(feature), 126.5);
});
