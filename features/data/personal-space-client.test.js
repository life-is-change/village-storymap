const test = require("node:test");
const assert = require("node:assert/strict");
const { createPersonalSpaceClient } = require("./personal-space-client.js");

function fakeSupabase() {
  const fake = { calls: [], queries: [] };
  fake.rpc = async (name, payload) => {
    fake.calls.push([name, payload]);
    return { data: name === "ensure_course_personal_space" ? { id: "space-1" } : true, error: null };
  };
  fake.from = (table) => {
    const query = { table, filters: [] };
    fake.queries.push(query);
    const builder = {
      select(columns) { query.columns = columns; return this; },
      eq(key, value) { query.filters.push([key, value]); return this; },
      upsert(payload, options) { query.upsert = [payload, options]; return Promise.resolve({ data: null, error: null }); },
      update(payload) { query.update = payload; return this; },
      order(key, options) { query.order = [key, options]; return Promise.resolve({ data: [], error: null }); },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
    };
    return builder;
  };
  return fake;
}

test("ensure creates one server-owned course personal space", async () => {
  const fake = fakeSupabase();
  const client = createPersonalSpaceClient({ supabaseClient: fake });
  const result = await client.ensure({ courseId: "course-1", villageId: "mibu", title: "张三 · 个人图底空间" });
  assert.equal(result.id, "space-1");
  assert.deepEqual(fake.calls[0], ["ensure_course_personal_space", {
    p_course_id: "course-1",
    p_village_id: "mibu",
    p_title: "张三 · 个人图底空间"
  }]);
});

test("editable personal features stay inside their selected layer version", async () => {
  const fake = fakeSupabase();
  const client = createPersonalSpaceClient({ supabaseClient: fake });
  await client.upsertFeature({
    spaceId: "space-1", versionId: "version-2", layerKey: "building",
    objectCode: "H001", objectName: "建筑 1",
    geom: { type: "Polygon", coordinates: [] }, props: { confidence: 0.9 }
  });
  assert.equal(fake.queries[0].table, "personal_layer_features");
  assert.equal(fake.queries[0].upsert[0].layer_version_id, "version-2");
  assert.equal(fake.queries[0].upsert[0].space_id, "space-1");
  assert.deepEqual(fake.queries[0].upsert[1], { onConflict: "layer_version_id,object_code" });
});

test("listVersions reads only the requested personal space", async () => {
  const fake = fakeSupabase();
  const client = createPersonalSpaceClient({ supabaseClient: fake });
  await client.listVersions("space-1");
  assert.equal(fake.queries[0].table, "personal_layer_versions");
  assert.deepEqual(fake.queries[0].filters, [["space_id", "space-1"]]);
  assert.deepEqual(fake.queries[0].order, ["created_at", { ascending: false }]);
});

test("version mutations use secure RPCs without owner identifiers", async () => {
  const fake = fakeSupabase();
  const client = createPersonalSpaceClient({ supabaseClient: fake });
  await client.setCurrentVersion("space-1", "building", "version-2");
  await client.deleteVersion("version-1");
  assert.deepEqual(fake.calls, [
    ["set_personal_layer_version", {
      p_space_id: "space-1", p_layer_key: "building", p_version_id: "version-2"
    }],
    ["delete_personal_layer_version", { p_version_id: "version-1" }]
  ]);
});

test("manual edits are saved by one owner-checked transactional RPC", async () => {
  const fake = fakeSupabase();
  const client = createPersonalSpaceClient({ supabaseClient: fake });
  const changes = [{ action: "update", layerKey: "water", objectCode: "W001" }];
  await client.saveEdits("space-1", changes);
  assert.deepEqual(fake.calls[0], ["save_personal_feature_edit_batch", {
    p_space_id: "space-1",
    p_changes: changes
  }]);
});
