const test = require("node:test");
const assert = require("node:assert/strict");

const { createGroupBaselineClient, normalizeBaselineError } = require("./group-baseline-client.js");

function harness(overrides = {}) {
  const calls = [];
  const rows = overrides.rows || {};
  const supabaseClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (overrides.rpcError) return { data: null, error: overrides.rpcError };
      return { data: overrides.rpcData?.[name] || { ok: true }, error: null };
    },
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(field, value) { filters.push([field, value]); return query; },
        order() { return query; },
        then(resolve) {
          calls.push({ table, filters });
          resolve({ data: rows[table] || [], error: null });
        }
      };
      return query;
    }
  };
  const getContext = () => ({
    teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "group_plan"
  });
  return { client: createGroupBaselineClient({ supabaseClient, getContext }), calls };
}

test("client applies an explicitly previewed baseline", async () => {
  const { client, calls } = harness();
  await client.applyUpdate({ targetSnapshotId: "v2", expectedBaseSnapshotId: "v1" });
  assert.deepEqual(calls[0], {
    name: "apply_group_baseline_update",
    args: {
      p_teaching_project_id: "p1",
      p_village_id: "v1",
      p_space_id: "s1",
      p_target_snapshot_id: "v2",
      p_expected_base_snapshot_id: "v1"
    }
  });
});

test("client loads baseline state from the active group context", async () => {
  const { client, calls } = harness();
  await client.getState();
  assert.deepEqual(calls[0], {
    name: "get_group_plan_baseline_state",
    args: {
      p_teaching_project_id: "p1",
      p_village_id: "v1",
      p_space_id: "s1"
    }
  });
});

test("preview uses immutable active context and target snapshot only", async () => {
  const { client, calls } = harness();
  await client.previewUpdate({ targetSnapshotId: "v2", teachingProjectId: "other" });
  assert.equal(calls[0].name, "preview_group_baseline_update");
  assert.equal(calls[0].args.p_teaching_project_id, "p1");
  assert.equal(calls[0].args.p_target_snapshot_id, "v2");
});

test("conflicts and restore points remain scoped to the active group space", async () => {
  const { client, calls } = harness({ rows: {
    group_baseline_conflicts: [{ id: "c1" }],
    group_plan_restore_points: [{ id: "r1" }]
  } });
  assert.deepEqual(await client.listConflicts(), [{ id: "c1" }]);
  assert.deepEqual(await client.listRestorePoints(), [{ id: "r1" }]);
  assert.deepEqual(calls[0].filters, [["space_id", "s1"], ["resolution_status", "unresolved"]]);
  assert.deepEqual(calls[1].filters, [["space_id", "s1"]]);
});

test("stable baseline error codes are retained for the UI", () => {
  assert.equal(normalizeBaselineError({ message: "GROUP_SPACE_BUSY" }).code, "GROUP_SPACE_BUSY");
  assert.equal(normalizeBaselineError({ details: "BASELINE_VERSION_CONFLICT" }).code, "BASELINE_VERSION_CONFLICT");
  assert.equal(normalizeBaselineError({ message: "permission denied" }).code, "GROUP_BASELINE_REQUEST_FAILED");
});

test("baseline client rejects non-group contexts", async () => {
  const client = createGroupBaselineClient({
    supabaseClient: {},
    getContext: () => ({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "formal_shared" })
  });
  await assert.rejects(() => client.previewUpdate({ targetSnapshotId: "v2" }), /GROUP_PLAN_SPACE_REQUIRED/);
});

module.exports = { harness };
