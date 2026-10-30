const test = require("node:test");
const assert = require("node:assert/strict");

const Geometry = require("./geometry-rules");

test('a road segment cannot leave a concave village or cross a village hole between valid endpoints',()=>{
 const boundary={type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[2,3],[2,1],[1,1],[1,3],[0,3],[0,0]]]};
 assert.equal(Geometry.containsGeometry(boundary,{type:'LineString',coordinates:[[.5,2],[2.5,2]]}),false);
 assert.equal(Geometry.containsGeometry(boundary,{type:'LineString',coordinates:[[.5,2],[.5,.5],[2.5,.5],[2.5,2]]}),true);
 const hole={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]};
 assert.equal(Geometry.containsGeometry(hole,{type:'LineString',coordinates:[[.5,1.5],[3,1.5]]}),false);
});

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
test('polygon containment checks concave edges and excluded holes, including matching holed ranges',()=>{
 const polygon=coordinates=>({type:'Polygon',coordinates});
 const u=polygon([[[0,0],[4,0],[4,4],[3,4],[3,1],[1,1],[1,4],[0,4],[0,0]]]);
 const bridge=polygon([[[.5,2],[3.5,2],[3.5,3],[.5,3],[.5,2]]]);
 assert.equal(Geometry.containsGeometry(u,bridge),false);
 const outer=[[0,0],[6,0],[6,6],[0,6],[0,0]],hole=[[2,2],[4,2],[4,4],[2,4],[2,2]],holed=polygon([outer,hole]);
 assert.equal(Geometry.containsGeometry(holed,polygon([outer])),false);
 assert.equal(Geometry.containsGeometry(holed,polygon([hole])),false);
 assert.equal(Geometry.containsGeometry(holed,holed),true);
 assert.equal(Geometry.containsGeometry(holed,polygon([[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5],[.5,.5]]])),true);
});
