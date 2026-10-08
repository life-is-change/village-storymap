const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveBuildingHeight,
  resolveVillageCamera,
  buildMain3dResources,
  normalizeRealityConfig,
  resolveRealityConfigForContext,
  hasCompleteVillageContext
} = require("./village-3d-config.js");

test("白模高度优先高度字段、其次层数、最后9米", () => {
  assert.equal(resolveBuildingHeight({ 建筑高度: 12, 层数: 2 }), 12);
  assert.equal(resolveBuildingHeight({ 建筑高度: 0, 层数: 2 }), 6);
  assert.equal(resolveBuildingHeight({ 层数: 2 }), 6);
  assert.equal(resolveBuildingHeight({}), 9);
});

test("相机中心和范围来自当前村庄边界", () => {
  const camera = resolveVillageCamera({
    type: "Polygon",
    coordinates: [[[110, 20], [112, 20], [112, 22], [110, 20]]]
  });
  assert.equal(camera.centerLongitude, 111);
  assert.equal(camera.centerLatitude, 21);
  assert.ok(camera.range > 1000);
});

test("主三维资源只读取当前村庄解析结果", () => {
  assert.deepEqual(buildMain3dResources({
    initialExtent: [110, 20, 112, 22],
    imagery: "signed-imagery",
    layers: { building: "signed-building", road: "signed-road" }
  }), {
    buildingUrl: "signed-building",
    roadUrl: "signed-road",
    imageryUrl: "signed-imagery",
    initialExtent: [110, 20, 112, 22]
  });
});

test("无实景时禁用，发布资源以更新时间形成revision", () => {
  assert.deepEqual(normalizeRealityConfig(null), {
    enabled: false,
    ionAssetId: 0,
    title: "",
    terrainEnabled: true,
    heightOffset: 0,
    revision: ""
  });
  assert.deepEqual(normalizeRealityConfig({
    ion_asset_id: 7654321,
    title: "新村实景",
    terrain_enabled: false,
    height_offset: -2,
    published_at: "2026-09-02T00:00:00Z"
  }), {
    enabled: true,
    ionAssetId: 7654321,
    title: "新村实景",
    terrainEnabled: false,
    heightOffset: -2,
    revision: "2026-09-02T00:00:00Z"
  });
});

test("米埗上下文缺失资源时保留实景兼容兜底，但正式村庄绝不借用米埗模型", () => {
  assert.equal(resolveRealityConfigForContext(null).ionAssetId, 5133927);
  assert.equal(resolveRealityConfigForContext({ villageId: "00000000-0000-4000-8000-000000000001" }).ionAssetId, 5133927);
  assert.equal(resolveRealityConfigForContext({ villageId: "formal-1", village: {} }).enabled, false);
  assert.equal(resolveRealityConfigForContext({
    villageId: "formal-1",
    village: { realityModel: { ion_asset_id: 7654321, title: "正式村实景" } }
  }).ionAssetId, 7654321);
});

test("只有完整项目和村庄上下文才对数据库查询追加隔离条件", () => {
  assert.equal(hasCompleteVillageContext({ teachingProjectId: "p1", villageId: "v1" }), true);
  assert.equal(hasCompleteVillageContext({ teachingProjectId: "p1" }), false);
  assert.equal(hasCompleteVillageContext({}), false);
});
