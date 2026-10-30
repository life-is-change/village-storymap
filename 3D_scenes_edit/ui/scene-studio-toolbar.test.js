const test = require("node:test");
const assert = require("node:assert/strict");
const Toolbar = require("./scene-studio-toolbar");

test('selected roads edit vertices and move directly in 3D with an explicit edit exit',()=>{
 const model={mode:'3d',activeTool:'select',selectedIds:['road'],properties:{kind:'line',category:'path',properties:{widthM:4}}};
 const html=Toolbar.renderToolbarHtml(model);assert.match(html,/data-action="edit-road"/);assert.match(html,/整体移动/);assert.doesNotMatch(html,/平移（2D）|调整形状（2D）/);
 const editing=Toolbar.renderToolbarHtml({...model,activeTool:'edit-road-nodes'});assert.match(editing,/删除选中顶点/);assert.match(editing,/结束编辑/);
});

test('drawing has an explicit finish and discard bar without unrelated editing actions',()=>{
 const html=Toolbar.renderToolbarHtml({mode:'3d',activeTool:'draw-line',activeAssetLabel:'碎石步道',selectedIds:['old'],properties:{kind:'line'},hasBoundary:true});
 assert.match(html,/碎石步道/);assert.match(html,/data-action="finish-drawing"/);assert.match(html,/放弃本次绘制/);
 assert.doesNotMatch(html,/data-action="duplicate"|data-action="delete"|data-value="move"|data-value="edit-boundary"/);
 const placing=Toolbar.renderToolbarHtml({mode:'3d',activeTool:'place-asset',activeAssetLabel:'乔木'});assert.match(placing,/结束放置/);assert.match(placing,/已放置.*保留/);
});

test("3d toolbar keeps primary tools visible and reveals object actions only for a selection", () => {
  const html = Toolbar.renderToolbarHtml({
    mode: "3d", phase: "editing", activeTool: "select",
    sections: { assets: { bench: [{ id: "bench", label: "木座椅" }] } }, selectedIds: ["o1"],
    canUndo: true, canRedo: false, interactionStatus: "已选 2 个边界点，右键完成"
  });
  for (const value of ["select", "move"]) assert.match(html, new RegExp(`data-action="tool" data-value="${value}"`));
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
  assert.doesNotMatch(normal, /data-value="edit-boundary"/);
  const editing = Toolbar.renderToolbarHtml({ mode: "3d", phase: "editing", activeTool: "edit-boundary", hasBoundary: true, sections: { assets: {} }, selectedIds: [] });
  assert.match(editing, /data-action="finish-boundary-edit"/);
  assert.match(editing, /data-action="cancel-boundary-edit"/);
  assert.match(editing, /data-action="delete-boundary-vertex"/);
});
