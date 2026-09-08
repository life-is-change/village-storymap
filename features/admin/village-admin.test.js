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
    createTeachingProject: async (input) => (calls.push({ name: "createTeachingProject", input }), {}),
    archiveTeachingProject: async (input) => (calls.push({ name: "archiveTeachingProject", input }), {}),
    getVillageRemovalPreview: async (input) => (calls.push({ name: "getVillageRemovalPreview", input }), overrides.removalPreview || { action: "archive", storage_paths: [] }),
    archiveVillage: async (input) => (calls.push({ name: "archiveVillage", input }), {}),
    restoreVillage: async (input) => (calls.push({ name: "restoreVillage", input }), {}),
    deleteUnusedVillage: async (input) => (calls.push({ name: "deleteUnusedVillage", input }), {}),
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

test("结束当前教学项目后可用同一课程模板创建下一学期", async () => {
  const calls = [];
  const controller = createVillageAdminController(makeDeps({ calls }));
  await controller.refresh();
  await controller.archiveTeachingProject("p1");
  assert.deepEqual(calls.find((call) => call.name === "archiveTeachingProject"), {
    name: "archiveTeachingProject", input: { teachingProjectId: "p1" }
  });

  const noProjectClient = {
    ...makeDeps({ calls }).client,
    getActiveContext: async () => null
  };
  const next = createVillageAdminController(makeDeps({ calls, client: noProjectClient }));
  await next.refresh();
  await next.createTeachingProject({
    name: "2027 春季村庄规划课程", courseId: "mibu-village-planning", practiceVillageId: "v1"
  });
  assert.deepEqual(calls.find((call) => call.name === "createTeachingProject"), {
    name: "createTeachingProject",
    input: { name: "2027 春季村庄规划课程", courseId: "mibu-village-planning", practiceVillageId: "v1" }
  });
});

test("存在当前教学项目时拒绝重复创建，取消归档不调用RPC", async () => {
  const calls = [];
  const controller = createVillageAdminController(makeDeps({ calls, confirm: async () => false }));
  await controller.refresh();
  await assert.rejects(() => controller.createTeachingProject({
    name: "重复项目", courseId: "c1", practiceVillageId: "v1"
  }), /ACTIVE_PROJECT_EXISTS/);
  assert.equal(await controller.archiveTeachingProject("p1"), false);
  assert.equal(calls.some((call) => call.name === "archiveTeachingProject"), false);
});

test("未使用村庄先清理服务端给出的精确路径再删除数据库记录", async () => {
  const events = [];
  const deps = makeDeps({
    removalPreview: { action: "delete", storage_paths: ["v1/pkg/boundary.geojson"] }
  });
  deps.client.getVillageRemovalPreview = async () => ({ action: "delete", storage_paths: ["v1/pkg/boundary.geojson"] });
  deps.client.deleteUnusedVillage = async (input) => (events.push(["deleteUnusedVillage", input]), {});
  deps.supabaseClient = { storage: { from: (bucket) => ({
    remove: async (paths) => (events.push([`storage.remove:${bucket}`, paths]), { error: null })
  }) } };
  const controller = createVillageAdminController(deps);
  await controller.refresh();
  await controller.deleteVillage("v1");
  assert.deepEqual(events, [
    ["storage.remove:village-datasets", ["v1/pkg/boundary.geojson"]],
    ["deleteUnusedVillage", { villageId: "v1" }]
  ]);
});

test("Storage清理失败时不删除数据库村庄", async () => {
  let databaseDeleted = false;
  const deps = makeDeps();
  deps.client.getVillageRemovalPreview = async () => ({ action: "delete", storage_paths: ["v1/pkg/boundary.geojson"] });
  deps.client.deleteUnusedVillage = async () => { databaseDeleted = true; };
  deps.supabaseClient = { storage: { from: () => ({ remove: async () => ({ error: new Error("denied") }) }) } };
  const controller = createVillageAdminController(deps);
  await controller.refresh();
  await assert.rejects(() => controller.deleteVillage("v1"), /STORAGE_CLEANUP_FAILED/);
  assert.equal(databaseDeleted, false);
});

test("村庄使用状态变化时遵循最新预览执行归档，并支持恢复", async () => {
  const calls = [];
  const deps = makeDeps({ calls });
  deps.client.getVillageRemovalPreview = async () => ({ action: "archive", reason: "VILLAGE_IN_USE" });
  const controller = createVillageAdminController(deps);
  await controller.refresh();
  await controller.deleteVillage("v1");
  await controller.restoreVillage("v1");
  assert.equal(calls.some((call) => call.name === "deleteUnusedVillage"), false);
  assert.equal(calls.some((call) => call.name === "archiveVillage"), true);
  assert.equal(calls.some((call) => call.name === "restoreVillage"), true);
});
