const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modulePath = path.resolve(__dirname, "platform-entry-controller.js");
const moduleApi = fs.existsSync(modulePath) ? require(modulePath) : {};

test("platform entry reveals the 2D loading shell before asynchronous preparation completes", async () => {
  assert.equal(typeof moduleApi.createPlatformEntryController, "function");

  const events = [];
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    showShell: () => events.push("shell"),
    setLoading: (loading) => events.push(`loading:${loading}`),
    prepare: async () => {
      events.push("prepare");
      await preparation;
      return { group: { id: "group-1" } };
    },
    openWorkspace: async (_view, group) => events.push(`open:${group.id}`),
    recordActivity: async () => events.push("activity")
  });

  const pending = controller.enter();
  assert.deepEqual(events, ["shell", "loading:true", "prepare"]);

  releasePreparation();
  await pending;
  assert.deepEqual(events.slice(0, 5), ["shell", "loading:true", "prepare", "open:group-1", "activity"]);
  assert.equal(events.at(-1), "loading:false");
});

test("repeated platform entry clicks share one in-flight initialization", async () => {
  assert.equal(typeof moduleApi.createPlatformEntryController, "function");

  let prepareCount = 0;
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    prepare: async () => {
      prepareCount += 1;
      await preparation;
      return { group: null };
    },
    openWorkspace: async () => {}
  });

  const first = controller.enter();
  const second = controller.enter();
  assert.equal(first, second);
  assert.equal(prepareCount, 1);

  releasePreparation();
  await first;
});

test("a different village selected during entry is queued and opened after the first request", async () => {
  assert.equal(typeof moduleApi.createPlatformEntryController, "function");
  const prepared = [];
  const opened = [];
  let releaseFirst;
  const firstPreparation = new Promise((resolve) => { releaseFirst = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    prepare: async (request) => {
      prepared.push(request.villageId);
      if (request.villageId === "village-a") await firstPreparation;
      return { group: { id: request.villageId } };
    },
    openWorkspace: async (_view, group) => opened.push(group.id)
  });

  const first = controller.enter({ villageId: "village-a" });
  const second = controller.enter({ villageId: "village-b" });
  assert.notEqual(first, second);
  assert.deepEqual(prepared, ["village-a"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(prepared, ["village-a", "village-b"]);
  assert.deepEqual(opened, ["village-a", "village-b"]);
});

test("activity logging is non-blocking after the workspace becomes usable", async () => {
  assert.equal(typeof moduleApi.createPlatformEntryController, "function");

  let releaseActivity;
  const activity = new Promise((resolve) => { releaseActivity = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    prepare: async () => ({ group: null }),
    openWorkspace: async () => {},
    recordActivity: () => activity
  });

  await controller.enter();
  assert.equal(controller.isEntering(), false);
  releaseActivity();
});
