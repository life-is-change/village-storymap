const test = require("node:test");
const assert = require("node:assert/strict");

const SceneDocument = require("../domain/scene-document");
const Client = require("./scene-edit-client");

function createSupabase(responses = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ type: "rpc", name, args });
      return responses[name] || { data: { ok: true }, error: null };
    },
    from(table) {
      const filters = [];
      const query = {
        select(columns) { calls.push({ type: "select", table, columns, filters }); return query; },
        eq(column, value) { filters.push(["eq", column, value]); return query; },
        is(column, value) { filters.push(["is", column, value]); return query; },
        limit(value) { calls.push({ type: "limit", table, value, filters: filters.slice() }); return query; },
        maybeSingle() { calls.push({ type: "single", table, filters: filters.slice() }); return Promise.resolve(responses[table] || { data: null, error: null }); },
        order(column, options) { calls.push({ type: "order", table, column, options, filters: filters.slice() }); return query; },
        then(resolve, reject) { return Promise.resolve(responses[table] || { data: [], error: null }).then(resolve, reject); }
      };
      return query;
    }
  };
}

function validDocument() {
  return SceneDocument.create({ projectId: "p1", villageId: "v1", groupId: "g1", spaceId: "s1", baselineRevision: 4, revision: 2 });
}

test("project lifecycle calls context-bound RPCs", async () => {
  const supabase = createSupabase();
  const client = Client.createSceneEditClient({ supabaseClient: supabase });
  await client.createProject({ teachingProjectId: "tp1", villageId: "v1", spaceId: "s1", groupId: "g1", title: "口袋公园", baselineRevision: 4 });
  await client.branchFromBaseline({ projectId: "p1", baselineRevision: 5, title: "新基线方案" });
  await client.restoreVersionAsDraft({ versionId: "ver1", title: "恢复方案" });
  await client.submitVersion("ver1");

  assert.deepEqual(supabase.calls.filter((call) => call.type === "rpc").map((call) => call.name), [
    "scene_edit_create_project", "scene_edit_branch_project", "scene_edit_restore_version", "scene_edit_submit_version"
  ]);
  assert.equal(supabase.calls[0].args.p_group_id, "g1");
  assert.equal(supabase.calls[0].args.p_scope_kind, "group");
  assert.equal(supabase.calls[0].args.p_space_id, "s1");
});

test("administrator sandbox creation and lookup stay owner isolated", async () => {
  const supabase = createSupabase({ scene_edit_projects: { data: { id: "admin-draft" }, error: null } });
  const client = Client.createSceneEditClient({ supabaseClient: supabase });
  await client.createProject({
    teachingProjectId: "tp1", villageId: "v1", spaceId: "shared", groupId: null,
    scopeKind: "admin_sandbox", ownerId: "admin-1", title: "管理员试用方案", baselineRevision: 2
  });
  assert.equal(supabase.calls[0].args.p_scope_kind, "admin_sandbox");
  assert.equal(supabase.calls[0].args.p_group_id, null);

  await client.findActiveProject({
    teachingProjectId: "tp1", villageId: "v1", spaceId: "shared", groupId: null,
    scopeKind: "admin_sandbox", ownerId: "admin-1"
  });
  const single = supabase.calls.find((call) => call.type === "single");
  assert.deepEqual(single.filters, [
    ["eq", "teaching_project_id", "tp1"], ["eq", "village_id", "v1"],
    ["eq", "scope_kind", "admin_sandbox"], ["is", "group_id", null],
    ["eq", "created_by", "admin-1"], ["eq", "space_id", "shared"], ["eq", "status", "draft"]
  ]);
});

test("save validates the canonical document and maps a stale revision", async () => {
  const conflict = { data: null, error: { code: "40001", message: "SCENE_EDIT_REVISION_CONFLICT", details: "9" } };
  const supabase = createSupabase({ scene_edit_save_draft: conflict });
  const client = Client.createSceneEditClient({ supabaseClient: supabase });
  const result = await client.saveDraft(validDocument());
  assert.deepEqual(result, { ok: false, code: "REVISION_CONFLICT", message: "SCENE_EDIT_REVISION_CONFLICT", remoteRevision: 9 });

  const invalid = validDocument();
  invalid.groupId = "";
  const rejected = await client.saveDraft(invalid);
  assert.equal(rejected.code, "VALIDATION_FAILED");
  assert.equal(supabase.calls.filter((call) => call.name === "scene_edit_save_draft").length, 1);
});

test("load, milestones and scoped lists return normalized data", async () => {
  const document = validDocument();
  const supabase = createSupabase({
    scene_edit_load_project: { data: document, error: null },
    scene_edit_create_version: { data: { id: "ver1", revision: 2 }, error: null },
    scene_edit_versions: { data: [{ id: "ver1" }], error: null },
    scene_edit_assets: { data: [{ id: "a1" }], error: null }
  });
  const client = Client.createSceneEditClient({ supabaseClient: supabase });
  assert.equal((await client.loadProject("p1")).data.projectId, "p1");
  assert.equal((await client.createVersion({ document, label: "中期", description: "第二轮", previewPath: "group/g1/p.png" })).data.id, "ver1");
  assert.deepEqual((await client.listVersions("p1")).data, [{ id: "ver1" }]);
  assert.deepEqual((await client.listAssets({ courseId: "c1", groupId: "g1" })).data, [{ id: "a1" }]);
  const assetOrder = supabase.calls.find((call) => call.type === "order" && call.table === "scene_edit_assets");
  assert.deepEqual(assetOrder.filters, [["eq", "course_id", "c1"], ["is", "archived_at", null]]);
});

test("network and authentication errors use stable codes", async () => {
  const supabase = createSupabase({ scene_edit_load_project: { data: null, error: { message: "Failed to fetch" } } });
  const client = Client.createSceneEditClient({ supabaseClient: supabase });
  assert.equal((await client.loadProject("p1")).code, "NETWORK_ERROR");
  const missing = Client.createSceneEditClient({ supabaseClient: null });
  assert.equal((await missing.loadProject("p1")).code, "AUTH_UNAVAILABLE");
});

test("finds the latest draft for the same teaching group space", async () => {
  const supabase = createSupabase({ scene_edit_projects: { data: { id: "p-existing" }, error: null } });
  const client = Client.createSceneEditClient({ supabaseClient: supabase });
  const result = await client.findActiveProject({ teachingProjectId: "tp1", villageId: "v1", groupId: "g1", scopeKind: "group", ownerId: "u1", spaceId: "s1" });
  assert.equal(result.data.id, "p-existing");
  const single = supabase.calls.find((call) => call.type === "single");
  assert.deepEqual(single.filters, [["eq", "teaching_project_id", "tp1"], ["eq", "village_id", "v1"], ["eq", "scope_kind", "group"], ["eq", "group_id", "g1"], ["eq", "space_id", "s1"], ["eq", "status", "draft"]]);
});

test("asset and component lifecycle stays behind scoped RPCs", async () => {
  const supabase = createSupabase();
  const client = Client.createSceneEditClient({ supabaseClient: supabase });
  await client.registerAsset({ course_id: "c", group_id: "g", scope_kind: "group", kind: "model", storage_path: "group/g/x.glb", display_name: "座椅", mime_type: "model/gltf-binary", file_size: 12, metadata: {}, license: "student-provided" });
  await client.updateAssetMetadata("a", { realSizeM: [2, 1, 1] });
  await client.publishAsset("a");
  await client.copySharedAsset("a", "g");
  await client.archiveAsset("a");
  await client.saveComponent({ courseId: "c", groupId: "g", scope: "group", displayName: "树池座椅", fragment: { objects: [] } });
  await client.publishComponent("component-1");
  await client.copySharedComponent("component-1", "g");
  await client.archiveComponent("component-1");
  assert.deepEqual(supabase.calls.filter((call) => call.type === "rpc").map((call) => call.name), [
    "scene_edit_register_asset",
    "scene_edit_update_asset_metadata",
    "scene_edit_publish_asset",
    "scene_edit_copy_asset",
    "scene_edit_archive_asset",
    "scene_edit_save_component",
    "scene_edit_publish_component",
    "scene_edit_copy_component",
    "scene_edit_archive_component"
  ]);
});
