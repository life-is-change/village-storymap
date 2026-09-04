const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeoprocessingClient } = require("./geoprocessing-client.js");

const AOI = { type: "Polygon", coordinates: [[[113.66, 23.67], [113.67, 23.67], [113.67, 23.68], [113.66, 23.67]]] };

function fakeSupabase() {
  const fake = { calls: [], removedChannels: [] };
  fake.rpc = async (name, payload) => {
    fake.calls.push([name, payload]);
    return { data: "run-id", error: null };
  };
  fake.channel = () => ({
    on() { return this; },
    subscribe() { return this; }
  });
  fake.removeChannel = (channel) => fake.removedChannels.push(channel);
  fake.storage = {
    from() {
      return {
        async createSignedUrl(path) {
          return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
        }
      };
    }
  };
  return fake;
}

test("submit sends only whitelisted fields and never owner_id", async () => {
  const fake = fakeSupabase();
  const client = createGeoprocessingClient({ supabaseClient: fake });
  await client.submit({
    courseId: "mibu-village-planning",
    teachingProjectId: "project-1",
    villageId: "mibu",
    datasetId: "dataset-1",
    aoi: AOI,
    requestedSteps: ["buildings", "roads_water", "contours"],
    parameters: { building_score_threshold: 0.35, contour_interval_m: 5, smoothing_sigma: 1 },
    owner_id: "must-not-pass"
  });

  assert.equal(fake.calls[0][0], "submit_geoprocessing_run");
  assert.equal("owner_id" in fake.calls[0][1], false);
  assert.equal(fake.calls[0][1].p_teaching_project_id, "project-1");
  assert.equal(fake.calls[0][1].p_dataset_id, "dataset-1");
  assert.deepEqual(fake.calls[0][1].p_parameters, {
    building_threshold: 0.35,
    contour_interval: 5,
    contour_smoothing: 1
  });
});

test("subscribe removes channel on dispose", () => {
  const fake = fakeSupabase();
  const client = createGeoprocessingClient({ supabaseClient: fake });
  const dispose = client.subscribe("run-id", () => {});
  dispose();
  assert.equal(fake.removedChannels.length, 1);
});

test("importRun delegates ownership validation to the secure RPC", async () => {
  const fake = fakeSupabase();
  const payloads = {
    buildings: { type: "FeatureCollection", features: [{ id: "b1", geometry: { type: "Polygon", coordinates: [] }, properties: {} }] },
    waterways: { type: "FeatureCollection", features: [{ id: "w1", geometry: { type: "LineString", coordinates: [] }, properties: {} }] },
    water_areas: { type: "FeatureCollection", features: [{ id: "w2", geometry: { type: "Polygon", coordinates: [] }, properties: {} }] }
  };
  const client = createGeoprocessingClient({
    supabaseClient: fake,
    fetchImpl: async (url) => ({ ok: true, async json() { return payloads[url.split("/").pop().replace(".geojson", "")]; } })
  });
  await client.importRun("run-id", [
    { artifact_type: "buildings", storage_path: "buildings.geojson" },
    { artifact_type: "waterways", storage_path: "waterways.geojson" },
    { artifact_type: "water_areas", storage_path: "water_areas.geojson" }
  ]);
  assert.equal(fake.calls[0][0], "import_geoprocessing_result");
  assert.equal(fake.calls[0][1].p_run_id, "run-id");
  assert.equal(fake.calls[0][1].p_layers.building.features.length, 1);
  assert.equal(fake.calls[0][1].p_layers.water.features.length, 2);
});

test("isRunImported checks the owned result bundle for the source run", async () => {
  const calls = [];
  const query = {
    select(columns) { calls.push(["select", columns]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    limit(value) { calls.push(["limit", value]); return Promise.resolve({ data: [{ id: "bundle-1" }], error: null }); }
  };
  const fake = fakeSupabase();
  fake.from = (table) => { calls.push(["from", table]); return query; };
  const client = createGeoprocessingClient({ supabaseClient: fake });
  assert.equal(await client.isRunImported("run-id"), true);
  assert.deepEqual(calls[0], ["from", "personal_result_bundles"]);
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "source_run_id" && call[2] === "run-id"));
});
