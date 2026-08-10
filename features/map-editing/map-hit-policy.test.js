const test = require("node:test");
const assert = require("node:assert/strict");
const { pickFeatureAtPixel } = require("./map-hit-policy.js");

function feature(layerKey, versionId) {
  return { get: (key) => ({ layerKey, personalLayerVersionId: versionId })[key] };
}

test("delete mode can hit the active personal contour while normal clicks ignore contours", () => {
  const contour = feature("contours", "contour-v2");
  const map = { forEachFeatureAtPixel: (_pixel, visitor) => visitor(contour) };
  const isNonInteractive = (layerKey) => layerKey === "contours";

  assert.equal(pickFeatureAtPixel(map, [1, 2], isNonInteractive), null);
  const clicked = pickFeatureAtPixel(map, [1, 2], isNonInteractive, "contours");
  assert.equal(clicked, contour);
  assert.equal(clicked.get("personalLayerVersionId"), "contour-v2");
});

test("delete mode skips overlapping upper layers until it finds the target layer", () => {
  const building = feature("building", "building-v1");
  const contour = feature("contours", "contour-v2");
  const map = {
    forEachFeatureAtPixel: (_pixel, visitor) => {
      if (visitor(building)) return;
      visitor(contour);
    }
  };
  const clicked = pickFeatureAtPixel(map, [1, 2], (key) => key === "contours", "contours");
  assert.equal(clicked, contour);
});
