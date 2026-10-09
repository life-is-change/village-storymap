const test = require("node:test");
const assert = require("node:assert/strict");

const Autosave = require("./autosave-controller");

function fakeClock() {
  let now = 0;
  let id = 0;
  const jobs = new Map();
  return {
    setTimeout(fn, delay) { const jobId = ++id; jobs.set(jobId, { at: now + delay, fn }); return jobId; },
    clearTimeout(jobId) { jobs.delete(jobId); },
    async tick(ms) {
      now += ms;
      const due = [...jobs.entries()].filter(([, job]) => job.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [jobId, job] of due) { jobs.delete(jobId); await job.fn(); }
    }
  };
}

const identity = { userId: "u", groupId: "g", spaceId: "s", projectId: "p" };

test("writes locally immediately and debounces remote saving for one second", async () => {
  const clock = fakeClock();
  const writes = [];
  const removals = [];
  const saves = [];
  const savedRevisions = [];
  const controller = Autosave.createAutosaveController({
    clock,
    delayMs: 1000,
    save: async (document) => { saves.push(document.revision); return { ok: true, data: { revision: document.revision + 1 } }; },
    localDraftStore: { write: (_identity, record) => writes.push(record), remove: (_identity, revision) => removals.push(revision) },
    onSaved: (result) => savedRevisions.push(result.data.revision)
  });
  controller.markDirty({ revision: 2 }, identity);
  controller.markDirty({ revision: 3 }, identity);
  assert.equal(writes.length, 2);
  assert.equal(controller.getState().status, "dirty");
  await clock.tick(999);
  assert.deepEqual(saves, []);
  await clock.tick(1);
  assert.deepEqual(saves, [3]);
  assert.deepEqual(removals, [3]);
  assert.deepEqual(savedRevisions, [4]);
  assert.equal(controller.getState().savedRevision, 4);
  assert.equal(controller.getState().status, "saved");
});

test("an edit made during a save triggers one following save", async () => {
  const clock = fakeClock();
  const pending = [];
  const revisions = [];
  const controller = Autosave.createAutosaveController({
    clock,
    save(document) {
      revisions.push(document.revision);
      return new Promise((resolve) => pending.push(resolve));
    },
    localDraftStore: { write() {}, remove() {} }
  });
  controller.markDirty({ revision: 1 }, identity);
  const first = controller.flush();
  controller.markDirty({ revision: 2 }, identity);
  await Promise.resolve();
  pending.shift()({ ok: true, data: { revision: 2 } });
  await first;
  await Promise.resolve();
  assert.deepEqual(revisions, [1, 2]);
  pending.shift()({ ok: true, data: { revision: 3 } });
  await controller.flush();
  assert.equal(controller.getState().status, "saved");
});

test("failures retain the draft and expose offline or conflict state", async () => {
  const records = [];
  const states = [];
  const controller = Autosave.createAutosaveController({
    save: async () => ({ ok: false, code: "NETWORK_ERROR" }),
    localDraftStore: { write: (_identity, record) => records.push(record), remove() { throw new Error("must not remove"); } },
    onStateChange: (state) => states.push(state.status)
  });
  controller.markDirty({ revision: 5 }, identity);
  await controller.flush();
  assert.equal(controller.getState().status, "offline");
  assert.equal(records.at(-1).document.revision, 5);

  controller.setSave(async () => ({ ok: false, code: "REVISION_CONFLICT", remoteRevision: 8 }));
  await controller.flush();
  assert.equal(controller.getState().status, "conflict");
  assert.equal(controller.getState().remoteRevision, 8);
  assert.equal(states.includes("offline"), true);
  assert.equal(states.includes("conflict"), true);
  controller.resolve("saved");
  assert.equal(controller.getState().status, "saved");
  assert.equal(controller.getState().remoteRevision, null);
});
