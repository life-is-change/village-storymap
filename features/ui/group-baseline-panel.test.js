const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createGroupBaselinePanel,
  renderGroupBaselinePanel
} = require("./group-baseline-panel.js");

const projectRoot = path.resolve(__dirname, "../..");
const indexSource = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");

function rootHarness() {
  return {
    innerHTML: "",
    querySelector() { return null; },
    addEventListener() {}
  };
}

test("panel renders the current and latest baseline with a compact mixed summary", () => {
  const html = renderGroupBaselinePanel({
    status: "ready",
    current: { id: "v1", version_name: "V1.0" },
    latest: { id: "v2", version_name: "V2.0" },
    preview: {
      baseline: { added: 2, updated: 5, deleted: 1 },
      group: { added: 1, updated: 8, deleted: 0 },
      potential_conflicts: 2
    },
    conflicts: [{ id: "c1", layer_key: "building", object_code: "B01" }]
  });

  assert.match(html, /当前基线[\s\S]*V1\.0/);
  assert.match(html, /可更新至[\s\S]*V2\.0/);
  assert.match(html, /基线变化 8 个/);
  assert.match(html, /组内覆盖 9 个/);
  assert.match(html, /预计冲突 2 个/);
  assert.match(html, /data-locate-layer="building"[^>]*data-locate-object="B01"/);
});

test("panel explains missing group space and missing frozen baseline", () => {
  assert.match(renderGroupBaselinePanel({ status: "no-group" }), /请先加入小组/);
  assert.match(renderGroupBaselinePanel({ status: "no-baseline" }), /等待管理员冻结现状版本/);
});

test("baseline update confirms then reloads server facts", async () => {
  const events = [];
  const root = rootHarness();
  const client = {
    getState: async () => ({
      space: { id: "s1", space_type: "group_plan" },
      current: { id: "v1", version_name: "V1.0" },
      latest: { id: "v2", version_name: "V2.0" }
    }),
    previewUpdate: async () => ({ baseline: {}, group: {}, potential_conflicts: 0 }),
    listConflicts: async () => [],
    applyUpdate: async () => events.push("apply")
  };
  const panel = createGroupBaselinePanel({
    root,
    client,
    confirm: async () => (events.push("confirm"), true),
    onReload: async () => events.push("reload")
  });

  await panel.refresh();
  await panel.applyLatest();
  assert.deepEqual(events, ["confirm", "apply", "reload"]);
  assert.match(root.innerHTML, /当前基线/);
});

test("busy and stale baseline errors produce specific guidance", async () => {
  const messages = [];
  let refreshCount = 0;
  const root = rootHarness();
  const client = {
    getState: async () => {
      refreshCount += 1;
      return {
        space: { id: "s1", space_type: "group_plan" },
        current: { id: "v1", version_name: "V1" },
        latest: { id: "v2", version_name: "V2" }
      };
    },
    previewUpdate: async () => ({ baseline: {}, group: {}, potential_conflicts: 0 }),
    listConflicts: async () => [],
    applyUpdate: async () => {
      const error = new Error("busy");
      error.code = refreshCount === 1 ? "GROUP_SPACE_BUSY" : "BASELINE_VERSION_CONFLICT";
      throw error;
    }
  };
  const panel = createGroupBaselinePanel({ root, client, confirm: async () => true, notify: (message) => messages.push(message) });
  await panel.refresh();
  await panel.applyLatest();
  assert.match(messages[0], /正在编辑/);

  await panel.refresh();
  await panel.applyLatest();
  assert.match(messages[1], /基线已变化/);
  assert.ok(refreshCount >= 3);
});

test("workspace loads and refreshes the baseline panel only for group plans", () => {
  assert.match(indexSource, /features\/data\/group-baseline-client\.js/);
  assert.match(indexSource, /features\/ui\/group-baseline-panel\.js/);
  assert.match(indexSource, /id="groupBaselinePanelMount"/);
  assert.match(appSource, /spaceType\s*!==\s*"group_plan"/);
  assert.match(appSource, /GroupBaselineClientModule\.createGroupBaselineClient/);
  assert.match(appSource, /GroupBaselinePanelModule\.createGroupBaselinePanel/);
});
