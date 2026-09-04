const test = require("node:test");
const assert = require("node:assert/strict");

const { createVillageClient } = require("./village-client.js");

function rpcOnlyClient(calls, response = { data: { id: "ok" }, error: null }) {
  return { rpc: async (name, args) => (calls.push([name, args]), response) };
}

test("ensurePersonalSpace携带项目和村庄且拒绝缺失上下文", async () => {
  const calls = [];
  const client = createVillageClient({ supabaseClient: rpcOnlyClient(calls) });

  await assert.rejects(() => client.ensurePersonalSpace({ villageId: "v1" }), /PROJECT_REQUIRED/);
  await client.ensurePersonalSpace({ teachingProjectId: "p1", villageId: "v1", villageRole: "formal" });

  assert.deepEqual(calls[0], ["ensure_context_space", {
    p_teaching_project_id: "p1",
    p_village_id: "v1",
    p_space_type: "formal_personal",
    p_title: null,
    p_group_id: null
  }]);
});

test("练习村庄个人空间使用practice_personal", async () => {
  const calls = [];
  const client = createVillageClient({ supabaseClient: rpcOnlyClient(calls) });
  await client.ensurePersonalSpace({ teachingProjectId: "p1", villageId: "mibu", villageRole: "practice" });
  assert.equal(calls[0][1].p_space_type, "practice_personal");
});

test("管理员草稿、发布与绑定只调用受控RPC", async () => {
  const calls = [];
  const client = createVillageClient({ supabaseClient: rpcOnlyClient(calls) });
  await client.createDraft({ name: "新村", isPractice: false, boundary: { type: "MultiPolygon", coordinates: [] } });
  await client.saveDatasetDraft({ villageId: "v1", sourceKind: "uploaded_bundle", layerManifest: { layers: [] } });
  await client.publishDataset({ datasetId: "d1" });
  await client.bindFormalVillage({ teachingProjectId: "p1", villageId: "v1" });
  await client.saveRealityDraft({ villageId: "v1", ionAssetId: 123, title: "实景" });
  await client.publishRealityModel({ modelId: "r1" });
  assert.deepEqual(calls.map((call) => call[0]), [
    "create_village_draft",
    "save_village_dataset_draft",
    "publish_village_dataset",
    "bind_formal_village",
    "save_village_reality_model_draft",
    "publish_village_reality_model"
  ]);
});

test("Supabase错误会转换为稳定错误码", async () => {
  const client = createVillageClient({
    supabaseClient: rpcOnlyClient([], { data: null, error: { message: "FORMAL_VILLAGE_LOCKED: has data" } })
  });
  await assert.rejects(
    () => client.bindFormalVillage({ teachingProjectId: "p1", villageId: "v2" }),
    (error) => error.code === "FORMAL_VILLAGE_LOCKED"
  );
});
