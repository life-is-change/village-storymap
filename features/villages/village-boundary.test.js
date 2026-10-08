const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeGeoJsonBoundary,
  summarizeBoundary,
  createBoundaryController
} = require("./village-boundary.js");

const polygon = (x = 113, y = 23) => ({
  type: "Polygon",
  coordinates: [[
    [x, y], [x + 1, y], [x + 1, y + 1], [x, y]
  ]]
});

test("多面GeoJSON归一化为MultiPolygon并返回范围", () => {
  const result = normalizeGeoJsonBoundary({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: polygon(113, 23) },
      { type: "Feature", properties: {}, geometry: polygon(114, 23) }
    ]
  });
  assert.equal(result.geometry.type, "MultiPolygon");
  assert.deepEqual(result.bounds, [113, 23, 115, 24]);
  assert.equal(result.polygonCount, 2);
});

test("单个Feature也归一化为MultiPolygon", () => {
  const result = normalizeGeoJsonBoundary({ type: "Feature", properties: {}, geometry: polygon() });
  assert.equal(result.geometry.type, "MultiPolygon");
  assert.equal(summarizeBoundary(result.geometry).vertexCount, 4);
});

test("拒绝非面、空集合和越界坐标", () => {
  assert.throws(() => normalizeGeoJsonBoundary({ type: "Point", coordinates: [113, 23] }), /BOUNDARY_POLYGON_REQUIRED/);
  assert.throws(() => normalizeGeoJsonBoundary({ type: "FeatureCollection", features: [] }), /BOUNDARY_EMPTY/);
  assert.throws(() => normalizeGeoJsonBoundary(polygon(181, 23)), /BOUNDARY_COORDINATE_OUT_OF_RANGE/);
});

test("控制器把ZIP委托给受控上传器并归一化结果", async () => {
  const calls = [];
  const controller = createBoundaryController({
    uploadShapefile: async (file) => {
      calls.push(file.name);
      return polygon(113, 23);
    }
  });
  const result = await controller.loadFile({ name: "boundary.zip" });
  assert.deepEqual(calls, ["boundary.zip"]);
  assert.equal(result.geometry.type, "MultiPolygon");
  assert.deepEqual(controller.getBoundary().bounds, [113, 23, 114, 24]);
});
