const test = require("node:test");
const assert = require("node:assert/strict");

const DraftStore = require("./local-draft-store");

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

const identity = { userId: "u1", groupId: "g1", spaceId: "s1", projectId: "p1" };

test("stores drafts under an account and workspace isolated key", () => {
  const storage = memoryStorage();
  const store = DraftStore.createLocalDraftStore(storage);
  const record = { revision: 4, document: { projectId: "p1" }, savedAt: "2026-09-14T03:00:00.000Z" };
  store.write(identity, record);
  assert.equal(DraftStore.buildDraftKey(identity), "scene-edit:u1:g1:s1:p1");
  assert.deepEqual(store.read(identity), record);
  store.remove(identity);
  assert.equal(store.read(identity), null);
});

test("stores administrator sandbox drafts without requiring a group", () => {
  const storage = memoryStorage();
  const store = DraftStore.createLocalDraftStore(storage);
  const adminIdentity = {
    userId: "admin-1",
    scopeKind: "admin_sandbox",
    ownerId: "admin-1",
    groupId: null,
    spaceId: "shared",
    projectId: "p-admin"
  };
  const record = { revision: 1, document: { projectId: "p-admin" } };

  store.write(adminIdentity, record);

  assert.equal(DraftStore.buildDraftKey(adminIdentity), "scene-edit:admin-1:admin_sandbox:admin-1:shared:p-admin");
  assert.deepEqual(store.read(adminIdentity), record);
});

test("malformed local data is ignored and removed", () => {
  const storage = memoryStorage();
  storage.setItem("scene-edit:u1:g1:s1:p1", "not-json");
  const store = DraftStore.createLocalDraftStore(storage);
  assert.equal(store.read(identity), null);
  assert.equal(storage.values.has("scene-edit:u1:g1:s1:p1"), false);
});
