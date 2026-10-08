const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.resolve(__dirname, "..", "..", "app.js"), "utf8");
const app3d = fs.readFileSync(path.resolve(__dirname, "..", "..", "app-3d.js"), "utf8");

test("练习村庄运行时始终使用当前村庄和教学项目而不是硬编码米埗村", () => {
  assert.doesNotMatch(app, /villageRole\s*===\s*["']formal["']\s*\?\s*activeVillageContext\.villageId\s*:\s*["']mibu["']/);
  assert.doesNotMatch(app, /usesDynamicDataset\s*=\s*activeVillageContext\?\.villageRole\s*===\s*["']formal["']/);
  assert.match(app, /villageId:\s*activeVillageContext\?\.villageId/);
});

test("切换村庄时同步影像范围、重定位地图并强制刷新二维图层", () => {
  assert.match(app, /applyVillageDatasetToPlanMap\(prepared\.datasetResources\)/);
  assert.match(app, /planHighResLayer\.setSource\(new ImageStatic/);
  assert.match(app, /view\.fit\(extent/);
  assert.match(app, /refresh2DOverlay\(\{ forceFullRebuild: true \}\)/);
});

test("二维和三维都在渲染前规范化本地数据包对象编号", () => {
  assert.match(app, /normalizeFeatureCollection\(geojson, layerKey\)/);
  assert.match(app3d, /normalizeFeatureCollection\(baseCollection, "building"\)/);
  assert.match(app3d, /function getRoadCodeFromFeatureLike[\s\S]*?props\["id"\]/);
});

test("三维运行时切村时重建当前村庄影像并使用最新地理范围", () => {
  assert.match(app3d, /function getBasemapGeoref\(\)[\s\S]*?normalizeBasemapGeoref\(window\.__BASEMAP_GEOREF\)[\s\S]*?activeBasemapGeoref/);
  assert.match(app3d, /async function reload\(selectCode\)[\s\S]*?await addViewerImageryLayers/);
});
