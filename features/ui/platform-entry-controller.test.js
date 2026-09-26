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

test("platform entry starts map prewarming without blocking project preparation", async () => {
  const events = [];
  let releasePrewarm;
  const prewarm = new Promise((resolve) => { releasePrewarm = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    showShell: () => events.push("shell"),
    prewarm: async () => { events.push("prewarm"); await prewarm; },
    prepare: async () => { events.push("prepare"); return { group: null }; },
    openWorkspace: async () => events.push("open")
  });
  await controller.enter();
  assert.deepEqual(events.slice(0, 4), ["shell", "prewarm", "prepare", "open"]);
  releasePrewarm();
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

test("cancelling an entry while preparation is pending prevents the stale workspace from opening", async () => {
  const events = [];
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    setLoading: (loading) => events.push(`loading:${loading}`),
    prepare: async () => {
      await preparation;
      return { group: { id: "stale-group" } };
    },
    openWorkspace: async () => events.push("open:stale-group"),
    recordActivity: async () => events.push("activity:stale-group"),
    onEntered: () => events.push("entered:stale-group")
  });

  const staleEntry = controller.enter();
  controller.cancel();

  assert.equal(controller.isEntering(), false);
  assert.equal(events.at(-1), "loading:false");

  releasePreparation();
  assert.equal(await staleEntry, null);
  assert.doesNotMatch(events.join(","), /open:|activity:|entered:/);
});

test("a fresh entry can start immediately after a stale entry is cancelled", async () => {
  const opened = [];
  let releaseStalePreparation;
  const stalePreparation = new Promise((resolve) => { releaseStalePreparation = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    prepare: async (request) => {
      if (request.villageId === "stale-village") {
        await stalePreparation;
      }
      return { group: { id: request.villageId } };
    },
    openWorkspace: async (_view, group) => opened.push(group.id)
  });

  const staleEntry = controller.enter({ villageId: "stale-village" });
  controller.cancel();
  await controller.enter({ villageId: "fresh-village" });

  assert.deepEqual(opened, ["fresh-village"]);

  releaseStalePreparation();
  assert.equal(await staleEntry, null);
  assert.deepEqual(opened, ["fresh-village"]);
});

test("cancelling entry also discards a different village queued by a duplicate homepage trigger", async () => {
  const opened = [];
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    prepare: async (request) => {
      if (request.villageId === "first-village") await preparation;
      return { group: { id: request.villageId } };
    },
    openWorkspace: async (_view, group) => opened.push(group.id)
  });

  const firstEntry = controller.enter({ villageId: "first-village" });
  const queuedEntry = controller.enter({ villageId: "queued-village" });
  controller.cancel();
  releasePreparation();

  assert.deepEqual(await Promise.all([firstEntry, queuedEntry]), [null, null]);
  assert.deepEqual(opened, []);
});

test("cancelling while the workspace is already opening restores the homepage after the stale open finishes", async () => {
  const events = [];
  let releaseWorkspace;
  let markWorkspaceStarted;
  const workspaceStarted = new Promise((resolve) => { markWorkspaceStarted = resolve; });
  const workspacePending = new Promise((resolve) => { releaseWorkspace = resolve; });
  const controller = moduleApi.createPlatformEntryController({
    prepare: async () => ({ group: null }),
    openWorkspace: async () => {
      events.push("workspace:start");
      markWorkspaceStarted();
      await workspacePending;
      events.push("workspace:visible");
    },
    onCancelled: () => events.push("homepage:restored")
  });

  const entry = controller.enter();
  await workspaceStarted;
  controller.cancel();
  releaseWorkspace();

  assert.equal(await entry, null);
  assert.deepEqual(events, ["workspace:start", "workspace:visible", "homepage:restored"]);
});
