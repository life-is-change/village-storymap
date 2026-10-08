const test = require("node:test");
const assert = require("node:assert/strict");

const { requireContext } = require("../../community-tasks.js");

test("社区任务必须绑定项目、村庄和真实空间", () => {
  assert.throws(() => requireContext({ getContext: () => ({ villageId: "v1", spaceId: "s1" }) }), /PROJECT_CONTEXT_REQUIRED/);
  assert.deepEqual(requireContext({
    getContext: () => ({ teachingProjectId: "p1", villageId: "v1", spaceId: "actual-s1" })
  }, "ui-current"), {
    teachingProjectId: "p1",
    villageId: "v1",
    spaceId: "actual-s1"
  });
});
