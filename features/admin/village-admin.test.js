const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVillageDraftInput,
  createVillageAdminController,
  getVillageActionState,
  validateRealityDraft
} = require("./village-admin.js");

const boundary = { type: "MultiPolygon", coordinates: [[[[113, 23], [114, 23], [114, 24], [113, 23]]]] };

function makeDeps(overrides = {}) {
  const calls = overrides.calls || [];
  const village = overrides.village || { id: "v1", name: "新村", status: "published", publishedDatasetId: "d1" };
  const dataset = overrides.dataset || {
    id: "d1", villageId: "v1", status: "ready",
    layers: [{ type: "buildings", featureCount: 2 }]
  };
  const client = {
    listVillages: async () => [village],
    getActiveContext: async () => ({ project: { id: "p1" }, villages: [village] }),
    createDraft: async (input) => (calls.push({ name: "createDraft", input }), village),
    publishDataset: async (input) => (calls.push({ name: "publishDataset", input }), dataset),
    bindFormalVillage: async (input) => (calls.push({ name: "bindFormalVillage", input }), {}),
    saveRealityDraft: async (input) => (calls.push({ name: "saveRealityDraft", input }), {}),
    publishRealityModel: async (input) => (calls.push({ name: "publishRealityModel", input }), {})
  };
  return {
    root: null,
    client,
    boundary: { getBoundary: () => ({ geometry: boundary }), loadFile: async () => ({ geometry: boundary }) },
    geoprocessing: {},
    datasets: [dataset],
    notify: () => {},
    confirm: async () => true,
    ...overrides,
    calls
  };
}

test("没有建筑成果时不能发布V0", async () => {
  const calls = [];
  const controller = createVillageAdminController(makeDeps({
    dataset: { id: "d1", status: "ready", layers: [{ type: "roads", featureCount: 3 }] },
    calls
  }));
  await assert.rejects(() => controller.publishDataset("d1"), /BUILDINGS_REQUIRED/);
  assert.equal(calls.some((call) => call.name === "publishDataset"), false);
});

test("正式村庄绑定前必须已发布V0", async () => {
  const controller = createVillageAdminController(makeDeps({
    village: { id: "v1", status: "draft", publishedDatasetId: null }
  }));
  await assert.rejects(() => controller.bindFormalVillage("v1"), /PUBLISHED_DATASET_REQUIRED/);
});

test("创建向导只提交最小字段并从米埗村继承默认坐标系", () => {
  const input = buildVillageDraftInput({
    name: "新村庄", isPractice: false, boundary, mibuDefaultCrs: "EPSG:4326"
  });
  assert.deepEqual(Object.keys(input).sort(), ["boundary", "defaultCrs", "isPractice", "name"]);
  assert.equal(input.defaultCrs, "EPSG:4326");
});

test("实景资源只接受正整数Asset ID和合理高度偏移", () => {
  assert.throws(() => validateRealityDraft({ ionAssetId: 0, heightOffset: 0 }), /REALITY_ASSET_ID_INVALID/);
  assert.throws(() => validateRealityDraft({ ionAssetId: 1, heightOffset: 1001 }), /REALITY_HEIGHT_OFFSET_INVALID/);
  assert.deepEqual(validateRealityDraft({ ionAssetId: "12", heightOffset: "-2" }), { ionAssetId: 12, heightOffset: -2 });
});

test("村庄操作状态只允许发布ready成果，并只允许已发布的正式村庄绑定", () => {
  const project = { id: "p1", formalVillageId: null };
  assert.deepEqual(getVillageActionState({
    id: "v1", isPractice: false, status: "data_ready",
    village_datasets: [{ id: "d1", status: "ready", layer_manifest: { layers: [] } }]
  }, project), {
    readyDatasetId: "d1", canPublish: true, canBind: false, isBound: false
  });
  assert.deepEqual(getVillageActionState({
    id: "v1", isPractice: false, status: "published", publishedDatasetId: "d1"
  }, { ...project, formalVillageId: "v1" }), {
    readyDatasetId: null, canPublish: false, canBind: false, isBound: true
  });
});
