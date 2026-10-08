const test = require("node:test");
const assert = require("node:assert/strict");

const moduleApi = require("./surface-intent-controller.js");

test("overview intent blocks every delayed workspace view until the user requests workspace again", () => {
  const controller = moduleApi.createSurfaceIntentController();

  assert.equal(controller.canShow("overview"), true);
  assert.equal(controller.canShow("plan2d"), false);
  assert.equal(controller.canShow("model3d"), false);

  controller.requestWorkspace();
  assert.equal(controller.canShow("plan2d"), true);
  assert.equal(controller.canShow("model3d"), true);

  controller.requestOverview();
  assert.equal(controller.canShow("overview"), true);
  assert.equal(controller.canShow("plan2d"), false);
  assert.equal(controller.canShow("model3d"), false);
});

test("workspace intent is changed only by an explicit request", () => {
  const controller = moduleApi.createSurfaceIntentController();

  controller.requestWorkspace();
  assert.equal(controller.getIntent(), "workspace");

  controller.canShow("overview");
  assert.equal(controller.getIntent(), "workspace");

  controller.requestOverview();
  assert.equal(controller.getIntent(), "overview");
});
