const test = require("node:test");
const assert = require("node:assert/strict");
const Startup = require("./scene-studio-startup.js");

test("one studio session reuses prepared 3D without repeating cloud refresh", async () => {
  let calls = 0;
  const api = { enter: async () => { calls++; } };
  const ready = Startup.create3DReadiness({ preparedApi: api, load: async () => api });
  assert.equal(await ready(), api);
  assert.equal(await ready(), api);
  assert.equal(calls, 0);
  const nextSession = Startup.create3DReadiness({ load: async () => api });
  await Promise.all([nextSession(), nextSession()]);
  assert.equal(calls, 1, "a new opening refreshes once; its editor and mode hook share readiness");
});

test("failed 3D readiness retries instead of caching failure", async () => {
  let calls = 0;
  const api = { enter: async () => { if (++calls === 1) throw Error("offline"); } };
  const ready = Startup.create3DReadiness({ load: async () => api });
  await assert.rejects(ready(), /offline/);
  assert.equal(await ready(), api);
  assert.equal(calls, 2);
});

test("scene studio prepares the 2D baseline and Cesium concurrently", async () => {
  const events = [];
  let releaseLayers;
  let release3D;
  const layersReady = new Promise((resolve) => { releaseLayers = resolve; });
  const threeDReady = new Promise((resolve) => { release3D = resolve; });
  const pending = Startup.prepareSceneStudio({
    ensurePlanMap: async () => { events.push("map"); },
    ensureSelectedLayersLoaded: async () => { events.push("layers:start"); await layersReady; events.push("layers:end"); },
    refresh2DOverlay: async () => events.push("overlay"),
    ensureVillage3DLoaded: async () => { events.push("3d:start"); await threeDReady; return { enter: async () => events.push("3d:enter") }; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.includes("layers:start"), true);
  assert.equal(events.includes("3d:start"), true);
  releaseLayers();
  release3D();
  const api = await pending;
  assert.equal(typeof api.enter, "function");
  assert.ok(events.indexOf("overlay") > events.indexOf("layers:end"));
});
