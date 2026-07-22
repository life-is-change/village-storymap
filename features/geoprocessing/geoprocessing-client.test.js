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
  return fake;
}

test("submit sends only whitelisted fields and never owner_id", async () => {
  const fake = fakeSupabase();
  const client = createGeoprocessingClient({ supabaseClient: fake });
  await client.submit({
    courseId: "mibu-village-planning",
    villageId: "mibu",
    aoi: AOI,
    requestedSteps: ["buildings", "roads_water", "contours"],
    parameters: { building_score_threshold: 0.35, contour_interval_m: 5, smoothing_sigma: 1 },
    owner_id: "must-not-pass"
  });

  assert.equal(fake.calls[0][0], "submit_geoprocessing_run");
  assert.equal("owner_id" in fake.calls[0][1], false);
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
