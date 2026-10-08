const test = require("node:test");
const assert = require("node:assert/strict");

const Geometry = require("./geometry-rules");

const origin = [114.3, 30.5];
const square = {
  type: "Polygon",
  coordinates: [[
    [114.3, 30.5],
    [114.3001, 30.5],
    [114.3001, 30.5001],
    [114.3, 30.5001],
    [114.3, 30.5]
  ]]
};

test("measures line length and polygon area in meters", () => {
  const length = Geometry.measureLengthM({ type: "LineString", coordinates: [[114.3, 30.5], [114.3001, 30.5]] });
  const area = Geometry.measureAreaM2(square);
  assert.ok(length > 9.5 && length < 9.7, `length=${length}`);
  assert.ok(area > 105 && area < 108, `area=${area}`);
});

test("snaps to a half-meter local grid", () => {
  const raw = Geometry.fromLocalMeters([1.24, 1.76], origin);
  const snapped = Geometry.snapCoordinate(raw, { origin, gridM: 0.5 });
  const local = Geometry.toLocalMeters(snapped, origin);
  assert.ok(Math.abs(local[0] - 1) < 0.001);
  assert.ok(Math.abs(local[1] - 2) < 0.001);
});

test("builds a rotated rectangular footprint around an asset", () => {
  const footprint = Geometry.rotatedFootprint(origin, { widthM: 4, depthM: 2 }, 90);
  const points = footprint.coordinates[0].map((position) => Geometry.toLocalMeters(position, origin));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1.99 && Math.max(...xs) - Math.min(...xs) < 2.01);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 3.99 && Math.max(...ys) - Math.min(...ys) < 4.01);
});

test("detects containment, polygon intersections and self intersections", () => {
  const inside = { type: "Point", coordinates: [114.30005, 30.50005] };
  const crossing = {
    type: "LineString",
    coordinates: [[114.2999, 30.50005], [114.3002, 30.50005]]
  };
  const bowTie = {
    type: "Polygon",
    coordinates: [[
      [114.3, 30.5], [114.3001, 30.5001], [114.3, 30.5001], [114.3001, 30.5], [114.3, 30.5]
    ]]
  };
  assert.equal(Geometry.containsGeometry(square, inside), true);
  assert.equal(Geometry.containsGeometry(square, crossing), false);
  assert.equal(Geometry.intersectsAny(crossing, [square]), true);
  assert.equal(Geometry.isSelfIntersecting(bowTie), true);
});

test("validates a selected public-space boundary against village and buildings", () => {
  const village = {
    type: "Polygon",
    coordinates: [[
      [114.299, 30.499], [114.301, 30.499], [114.301, 30.501], [114.299, 30.501], [114.299, 30.499]
    ]]
  };
  const building = {
    type: "Polygon",
    coordinates: [[
      [114.30004, 30.50004], [114.30006, 30.50004], [114.30006, 30.50006], [114.30004, 30.50006], [114.30004, 30.50004]
    ]]
  };
  const blocked = Geometry.validateSelectionBoundary(square, { villageBoundary: village, baselineBuildings: [building] });
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors.join(" "), /building/);
  assert.ok(blocked.measurements.areaM2 > 100);

  const narrow = {
    type: "Polygon",
    coordinates: [[origin, Geometry.fromLocalMeters([0.5, 0], origin), Geometry.fromLocalMeters([0.5, 5], origin), Geometry.fromLocalMeters([0, 5], origin), origin]]
  };
  const warned = Geometry.validateSelectionBoundary(narrow, { villageBoundary: village, baselineBuildings: [] });
  assert.equal(warned.ok, true);
  assert.match(warned.warnings.join(" "), /0.8 m/);
});
