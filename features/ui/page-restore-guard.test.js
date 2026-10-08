const test = require("node:test");
const assert = require("node:assert/strict");

const moduleApi = require("./page-restore-guard.js");

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type, event) {
      listeners.get(type)?.(event);
    }
  };
}

test("restoring the application document from the back-forward cache reloads it once", () => {
  const target = createEventTarget();
  let reloadCount = 0;
  const guard = moduleApi.createPageRestoreGuard({
    target,
    reload: () => { reloadCount += 1; }
  });

  target.dispatch("pageshow", { persisted: false });
  assert.equal(reloadCount, 0);

  target.dispatch("pageshow", { persisted: true });
  target.dispatch("pageshow", { persisted: true });
  assert.equal(reloadCount, 1);

  guard.dispose();
});

test("disposing the page restore guard stops later restore events from reloading", () => {
  const target = createEventTarget();
  let reloadCount = 0;
  const guard = moduleApi.createPageRestoreGuard({
    target,
    reload: () => { reloadCount += 1; }
  });

  guard.dispose();
  target.dispatch("pageshow", { persisted: true });
  assert.equal(reloadCount, 0);
});
