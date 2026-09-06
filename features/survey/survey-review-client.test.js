const test = require("node:test");
const assert = require("node:assert/strict");

const { createSurveyReviewClient } = require("./survey-review-client.js");

function createQuery(rows, calls) {
  const query = {
    select(columns) { calls.push(["select", columns]); return query; },
    eq(column, value) { calls.push(["eq", column, value]); return query; },
    order(column, options) { calls.push(["order", column, options]); return Promise.resolve({ data: rows, error: null }); },
    maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); }
  };
  return query;
}

function context(overrides = {}) {
  return {
    teachingProjectId: "p1",
    villageId: "v1",
    spaceId: "s1",
    spaceType: "formal_shared",
    ...overrides
  };
}

test("lists only review rows from the active project village and space", async () => {
  const calls = [];
  const rows = [{ layer_key: "building", object_code: "B1" }];
  const supabaseClient = {
    from(table) {
      calls.push(["from", table]);
      return createQuery(rows, calls);
    }
  };
  const client = createSurveyReviewClient({ supabaseClient, getContext: () => context() });

  assert.deepEqual(await client.listReviews(), rows);
  assert.deepEqual(calls, [
    ["from", "survey_feature_reviews"],
    ["select", "*"],
    ["eq", "teaching_project_id", "p1"],
    ["eq", "village_id", "v1"],
    ["eq", "space_id", "s1"],
    ["order", "layer_key", { ascending: true }]
  ]);
});

test("gets one object review inside the same immutable context", async () => {
  const calls = [];
  const row = { layer_key: "road", object_code: "R1", geometry_revision: 2 };
  const supabaseClient = { from: () => createQuery([row], calls) };
  const client = createSurveyReviewClient({ supabaseClient, getContext: () => context() });

  assert.deepEqual(await client.getReview("road", "R1"), row);
  assert.deepEqual(calls.slice(-3), [
    ["eq", "space_id", "s1"],
    ["eq", "layer_key", "road"],
    ["eq", "object_code", "R1"]
  ]);
});

test("confirmGeometry sends context revision and lock token without caller identity", async () => {
  const calls = [];
  const supabaseClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { geometry_revision: 4 }, error: null };
    }
  };
  const client = createSurveyReviewClient({ supabaseClient, getContext: () => context() });

  assert.deepEqual(await client.confirmGeometry({
    layerKey: "building",
    objectCode: "B1",
    expectedRevision: 3,
    lockToken: "11111111-1111-4111-8111-111111111111"
  }), { geometry_revision: 4 });
  assert.deepEqual(calls, [{
    name: "confirm_survey_feature_geometry",
    args: {
      p_teaching_project_id: "p1",
      p_village_id: "v1",
      p_space_id: "s1",
      p_layer_key: "building",
      p_object_code: "B1",
      p_expected_revision: 3,
      p_lock_token: "11111111-1111-4111-8111-111111111111"
    }
  }]);
  assert.equal("p_editor_name" in calls[0].args, false);
});

test("rejects personal and practice spaces before querying Supabase", async () => {
  let touched = false;
  const supabaseClient = {
    from() { touched = true; },
    rpc() { touched = true; }
  };
  const client = createSurveyReviewClient({
    supabaseClient,
    getContext: () => context({ spaceType: "formal_personal" })
  });

  await assert.rejects(() => client.listReviews(), /FORMAL_SHARED_SPACE_REQUIRED/);
  await assert.rejects(() => client.confirmGeometry({}), /FORMAL_SHARED_SPACE_REQUIRED/);
  assert.equal(touched, false);
});

test("surfaces Supabase errors without returning stale success", async () => {
  const failure = new Error("GEOMETRY_REVISION_CONFLICT");
  const client = createSurveyReviewClient({
    supabaseClient: { rpc: async () => ({ data: null, error: failure }) },
    getContext: () => context()
  });
  await assert.rejects(
    () => client.confirmGeometry({ layerKey: "water", objectCode: "W1", expectedRevision: 1, lockToken: "lock" }),
    failure
  );
});

