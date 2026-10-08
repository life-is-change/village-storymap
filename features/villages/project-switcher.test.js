const test = require("node:test");
const assert = require("node:assert/strict");

const { createProjectSwitcher } = require("./project-switcher.js");

test("目标村庄加载失败时保持原上下文", async () => {
  let active = { teachingProjectId: "p1", villageId: "mibu", spaceId: "s1" };
  let rolledBack = false;
  const switcher = createProjectSwitcher({
    hasUnsavedChanges: () => false,
    loadTarget: async () => { throw new Error("LOAD_FAILED"); },
    commitContext: (next) => { active = next; },
    rollbackContext: () => { rolledBack = true; },
    getContext: () => active
  });
  await assert.rejects(() => switcher.switchTo({ teachingProjectId: "p1", villageId: "v2" }), /LOAD_FAILED/);
  assert.equal(active.villageId, "mibu");
  assert.equal(rolledBack, true);
});

test("未保存编辑会阻止项目切换", async () => {
  const switcher = createProjectSwitcher({
    hasUnsavedChanges: () => true,
    resolveUnsaved: async () => "cancel",
    getContext: () => ({ villageId: "mibu" })
  });
  assert.equal(await switcher.switchTo({ villageId: "v2" }), false);
});

test("目标加载完成后才卸载并提交新上下文", async () => {
  const order = [];
  let active = { villageId: "mibu" };
  const switcher = createProjectSwitcher({
    getContext: () => active,
    hasUnsavedChanges: () => false,
    loadTarget: async (entry) => (order.push("load"), { ...entry, spaceId: "formal-shared" }),
    unloadTarget: async () => { order.push("unload"); },
    commitContext: (next) => { order.push("commit"); active = next; }
  });
  await switcher.switchTo({ villageId: "v2" });
  assert.deepEqual(order, ["load", "unload", "commit"]);
  assert.equal(active.spaceId, "formal-shared");
});

test("快速连续切换时自动提交最后一次选择", async () => {
  let releaseFirst;
  let active = { villageId: "mibu" };
  const committed = [];
  const switcher = createProjectSwitcher({
    getContext: () => active,
    loadTarget: async (entry) => {
      if (entry.villageId === "v2") await new Promise((resolve) => { releaseFirst = resolve; });
      return entry;
    },
    commitContext: (next) => { active = next; committed.push(next.villageId); }
  });
  const first = switcher.switchTo({ villageId: "v2" });
  await Promise.resolve();
  const last = switcher.switchTo({ villageId: "v3" });
  releaseFirst();
  await Promise.all([first, last]);
  assert.deepEqual(committed, ["v2", "v3"]);
  assert.equal(active.villageId, "v3");
});
