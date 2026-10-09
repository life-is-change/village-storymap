const test = require("node:test");
const assert = require("node:assert/strict");
const Toolbar = require("./scene-studio-toolbar");

test("3d toolbar keeps primary tools visible and reveals object actions only for a selection", () => {
  const html = Toolbar.renderToolbarHtml({
    mode: "3d", phase: "editing", activeTool: "select",
    sections: { assets: { bench: [{ id: "bench", label: "木座椅" }] } }, selectedIds: ["o1"],
    canUndo: true, canRedo: false, interactionStatus: "已选 2 个边界点，右键完成"
  });
  for (const value of ["draw-boundary", "select", "move"]) assert.match(html, new RegExp(`data-action="tool" data-value="${value}"`));
  for (const action of ["duplicate", "delete"]) assert.match(html, new RegExp(`data-action="${action}"`));
  assert.doesNotMatch(html, /data-action="undo"|data-action="redo"/);
  assert.match(html, /已选 2 个边界点/);
  assert.doesNotMatch(html, /data-action="milestone"|data-action="close"|scene-studio-asset-tray/);
  assert.doesNotMatch(html, /projectSettingsDrawer/);

  const withoutSelection = Toolbar.renderToolbarHtml({ mode: "3d", phase: "editing", activeTool: "select", sections: { assets: {} }, selectedIds: [] });
  assert.doesNotMatch(withoutSelection, /data-action="duplicate"|data-action="delete"/);
});

test("toolbar delegates actions and releases its listener", () => {
  const listeners = new Map();
  const root = { innerHTML: "", setAttribute() {}, focus() {}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const actions = [];
  const toolbar = Toolbar.createSceneStudioToolbar({ root, onAction: (action) => actions.push(action) });
  toolbar.render({ mode: "3d", sections: { assets: {} } });
  listeners.get("click")({ target: { closest: () => ({ dataset: { action: "tool", value: "move" } }) } });
  assert.deepEqual(actions, [{ type: "tool", value: "move" }]);
  toolbar.dispose();
  assert.equal(listeners.size, 0);
});

test("an existing boundary exposes a real adjustment workflow", () => {
  const normal = Toolbar.renderToolbarHtml({ mode: "3d", phase: "editing", activeTool: "select", hasBoundary: true, sections: { assets: {} }, selectedIds: [] });
  assert.match(normal, /data-action="tool" data-value="edit-boundary"/);
  assert.match(normal, />调整范围</);
  const editing = Toolbar.renderToolbarHtml({ mode: "3d", phase: "editing", activeTool: "edit-boundary", hasBoundary: true, sections: { assets: {} }, selectedIds: [] });
  assert.match(editing, /data-action="finish-boundary-edit"/);
  assert.match(editing, /data-action="cancel-boundary-edit"/);
  assert.match(editing, /data-action="delete-boundary-vertex"/);
});
