const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Panel = require("./scene-studio-panel");

test("builds student-first view models for every persistence state", () => {
  const cases = [
    ["no-project", "尚未创建方案"],
    ["drawing-boundary", "请在地图上绘制设计范围"],
    ["boundary-error", "设计范围需要修正"],
    ["editing", "正在编辑"],
    ["offline", "已保存到本机"],
    ["conflict", "发现两个版本"],
    ["readonly", "只读查看"]
  ];
  for (const [phase, expected] of cases) {
    const model = Panel.buildViewModel({ phase, saveStatus: phase === "offline" ? "offline" : phase === "conflict" ? "conflict" : "saved" });
    assert.match(model.banner.message, new RegExp(expected));
  }
});

test("view model exposes tools, layers, objects, assets, properties and milestones without approval controls", () => {
  const model = Panel.buildViewModel({
    phase: "editing",
    activeTool: "select",
    selectedIds: ["o1"],
    layers: [{ id: "design", name: "方案要素", visible: true, locked: false }],
    objects: [{ id: "o1", category: "bench", properties: { displayName: "木座椅" } }],
    assets: [{ id: "seed:bench:wood", category: "bench", label: "木座椅", scope: "seed" }],
    selectedObject: { id: "o1", transform: { headingDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 }, properties: {} },
    canUndo: true,
    canRedo: false
  });
  assert.equal(model.tools.some((tool) => tool.id === "draw-surface"), true);
  assert.equal(model.sections.layers.length, 1);
  assert.equal(model.sections.objects.length, 1);
  assert.equal(model.sections.assets.bench.length, 1);
  assert.equal(model.properties.id, "o1");
  assert.equal(model.actions.some((action) => action.id === "milestone"), true);
  assert.equal(JSON.stringify(model).includes("审批"), false);
});

test("keyboard shortcuts are scoped away from text entry", () => {
  assert.equal(Panel.shortcutForEvent({ key: "z", ctrlKey: true, shiftKey: false, target: { tagName: "DIV" } }), "undo");
  assert.equal(Panel.shortcutForEvent({ key: "Z", metaKey: true, shiftKey: true, target: { tagName: "DIV" } }), "redo");
  assert.equal(Panel.shortcutForEvent({ key: "d", ctrlKey: true, target: { tagName: "DIV" } }), "duplicate");
  assert.equal(Panel.shortcutForEvent({ key: "Delete", target: { tagName: "DIV" } }), "delete");
  assert.equal(Panel.shortcutForEvent({ key: "g", target: { tagName: "DIV" } }), "group");
  assert.equal(Panel.shortcutForEvent({ key: "z", ctrlKey: true, target: { tagName: "INPUT" } }), null);
  assert.equal(Panel.shortcutForEvent({ key: "Delete", target: { tagName: "TEXTAREA" } }), null);
});

test("DOM adapter renders accessible regions and delegates declared actions", () => {
  const listeners = {};
  const actions = [];
  const root = {
    innerHTML: "",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener(name) { delete listeners[name]; },
    focus() { this.focused = true; }
  };
  const panel = Panel.createSceneStudioPanel({ root, onAction: (action) => actions.push(action) });
  panel.render(Panel.buildViewModel({ phase: "editing", layers: [], objects: [{ id: "o1", kind: "asset", category: "bench", properties: {} }], selectedIds: ["o1"], assets: [] }));
  assert.match(root.innerHTML, /aria-label="场景编辑工具"/);
  assert.match(root.innerHTML, /data-panel="layers"/);
  assert.match(root.innerHTML, /data-panel="assets"/);
  assert.match(root.innerHTML, /data-panel="properties"/);
  assert.match(root.innerHTML, /data-action="delete"/);
  assert.match(root.innerHTML, /data-action="cancel"/);
  const target = { closest: () => ({ dataset: { action: "undo", value: "" } }) };
  listeners.click({ target });
  assert.equal(actions[0].type, "undo");
  panel.focus();
  assert.equal(root.focused, true);
  panel.dispose();
  assert.deepEqual(Object.keys(listeners), []);
});

test("3D mode exposes vertical and orientation fine tuning without vertex tools in the property panel", () => {
  const root = { innerHTML: "", setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {} };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({ mode: "3d", phase: "editing", selectedObject: { id: "o1", kind: "asset", category: "bench", transform: { headingDeg: 0, pitchDeg: 2, rollDeg: 3, scale: [1, 1, 1.5], heightOffsetM: .5 }, properties: { materialRef: "wood" } } }));
  assert.match(root.innerHTML, /data-path="transform\.scaleZ"/);
  assert.match(root.innerHTML, /data-path="transform\.pitchDeg"/);
  assert.match(root.innerHTML, /data-path="transform\.rollDeg"/);
  assert.match(root.innerHTML, /data-path="properties\.materialRef"/);
});

test("3D mode renders contextual design tools over the canvas", () => {
  const root = { innerHTML: "", setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {} };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({ mode: "3d", phase: "editing", assets: [{ id: "bench", kind: "asset", category: "bench", label: "木座椅" }] }));
  assert.match(root.innerHTML, /scene-studio-contextual-tools/);
  assert.match(root.innerHTML, />3D 设计</);
  assert.match(root.innerHTML, />2D 校核</);
  assert.doesNotMatch(root.innerHTML, />3D 预览</);
});

test("2D mode exposes only review and fine-tuning tools", () => {
  const root = { innerHTML: "", setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {} };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({ mode: "2d", phase: "editing" }));
  for (const tool of ["select", "box-select", "move", "rotate", "scale", "measure", "pan"]) {
    assert.match(root.innerHTML, new RegExp(`data-action="tool" data-value="${tool}"`));
  }
  for (const tool of ["draw-surface", "draw-rectangle", "draw-line", "place-asset", "edit-nodes", "edit-boundary"]) {
    assert.doesNotMatch(root.innerHTML, new RegExp(`data-action="tool" data-value="${tool}"`));
  }
});

test("editor groups scene structure and switches one inspector panel at a time", () => {
  const listeners = {};
  const root = {
    innerHTML: "", setAttribute() {}, focus() {},
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener() {}
  };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({
    mode: "3d", phase: "editing",
    layers: [{ id: "design", name: "方案要素", visible: true, locked: false }],
    assets: [{ id: "bench", kind: "asset", category: "bench", label: "木座椅" }]
  }));

  assert.match(root.innerHTML, /aria-label="场景结构"/);
  assert.match(root.innerHTML, /class="scene-studio-layer-name"[^>]*>方案要素/);
  assert.match(root.innerHTML, /默认图层/);
  assert.doesNotMatch(root.innerHTML, /data-action="layer-delete" data-value="design"/);
  assert.match(root.innerHTML, /aria-label="隐藏 方案要素"/);
  assert.match(root.innerHTML, /aria-label="锁定 方案要素"/);
  assert.match(root.innerHTML, /data-active-inspector="assets"/);
  assert.doesNotMatch(root.innerHTML, /scene-studio-asset-tray/);

  listeners.click({ target: { closest: () => ({ dataset: { action: "panel-tab", value: "properties" } }) } });
  assert.match(root.innerHTML, /data-active-inspector="properties"/);
});

test("user layers can be renamed and deleted while the default layer explains its role", () => {
  const listeners = {};
  const actions = [];
  const root = {
    innerHTML: "", setAttribute() {}, focus() {},
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener() {}
  };
  const panel = Panel.createSceneStudioPanel({ root, onAction: (action) => actions.push(action) });
  panel.render(Panel.buildViewModel({ phase: "editing", layers: [
    { id: "design", name: "方案要素", visible: true, locked: false },
    { id: "layer-2", name: "图层 2", visible: true, locked: false }
  ] }));
  assert.match(root.innerHTML, /data-action="layer-rename"[^>]*data-value="layer-2"/);
  assert.match(root.innerHTML, /data-action="layer-delete" data-value="layer-2"/);
  listeners.change({ target: { value: "休憩设施", closest: () => ({ dataset: { action: "layer-rename", value: "layer-2" } }) } });
  assert.deepEqual(actions[0], { type: "layer-rename", value: "layer-2", path: "", source: actions[0].source, name: "休憩设施" });
});

test("layer controls use a two-row layout and visually separate the destructive action", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
  assert.match(css, /\.scene-studio-row\[data-layer-id\][^{]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.scene-studio-layer-actions[^\{]*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /\.scene-studio-layer-actions\s+\.is-danger[^\{]*\{[^}]*margin-left:/s);
});

test("opening the property inspector requests camera-safe inspection mode", () => {
  const listeners = {};
  const actions = [];
  const root = {
    innerHTML: "", setAttribute() {}, focus() {},
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener() {}
  };
  const panel = Panel.createSceneStudioPanel({ root, onAction: (action) => actions.push(action) });
  panel.render(Panel.buildViewModel({ mode: "3d", phase: "editing" }));
  listeners.click({ target: { closest: () => ({ dataset: { action: "panel-tab", value: "properties" } }) } });
  assert.equal(actions.at(-1).type, "inspect-properties");
});

test("asset library uses category filters, search and a collapsible compact grid", () => {
  const listeners = {};
  const root = {
    innerHTML: "", setAttribute() {}, focus() {},
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener() {}
  };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({
    mode: "3d", phase: "editing",
    assets: [
      { id: "bench", category: "bench", label: "木座椅" },
      { id: "tree", category: "tree", label: "香樟树" },
      { id: "curb", category: "curb", label: "石质路缘" }
    ]
  }));

  assert.match(root.innerHTML, /data-action="asset-search"/);
  assert.match(root.innerHTML, /data-action="asset-category" data-value="all"/);
  assert.match(root.innerHTML, /data-action="asset-group" data-value="site"/);
  assert.match(root.innerHTML, /场地地面/);
  assert.match(root.innerHTML, /class="scene-asset-grid"/);
  assert.match(root.innerHTML, /data-action="toggle-inspector"/);
  assert.doesNotMatch(root.innerHTML, />curb</);

  listeners.click({ target: { closest: () => ({ dataset: { action: "toggle-inspector", value: "" } }) } });
  assert.match(root.innerHTML, /data-inspector-collapsed="true"/);
  assert.match(root.innerHTML, />展开素材与属性</);
});

test("status updates do not rebuild the scene workspace", () => {
  let writes = 0;
  let html = "";
  const statusNode = { textContent: "" };
  const saveNode = { textContent: "", dataset: {} };
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; writes += 1; },
    setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {},
    querySelector(selector) {
      if (selector === "[data-scene-status]") return statusNode;
      if (selector === ".scene-save-chip") return saveNode;
      return null;
    }
  };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({ mode: "3d", phase: "editing" }));
  panel.updateStatus("正在移动对象");
  panel.updateSaveState({ status: "saving", revision: 4 });

  assert.equal(writes, 1);
  assert.equal(statusNode.textContent, "正在移动对象");
  assert.equal(saveNode.textContent, "正在保存… · R4");
  assert.equal(saveNode.dataset.status, "saving");
});

test("asset filtering updates only the asset browser instead of rebuilding the 3D workspace", () => {
  const listeners = {};
  let writes = 0;
  let html = "";
  const assetBrowser = { innerHTML: "" };
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; writes += 1; },
    setAttribute() {}, focus() {},
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener() {},
    querySelector(selector) { return selector === ".scene-asset-browser" ? assetBrowser : null; }
  };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({
    mode: "3d", phase: "editing",
    assets: [{ id: "bench", category: "bench", label: "木座椅" }, { id: "tree", category: "tree", label: "香樟树" }]
  }));

  listeners.click({ target: { closest: () => ({ dataset: { action: "asset-group", value: "planting" } }) } });
  listeners.click({ target: { closest: () => ({ dataset: { action: "asset-category", value: "tree" } }) } });
  assert.equal(writes, 1);
  assert.match(assetBrowser.innerHTML, /香樟树/);
  assert.doesNotMatch(assetBrowser.innerHTML, /木座椅/);
});

test("selection updates object rows and properties without rebuilding the 3D workspace", () => {
  let writes = 0;
  let html = "";
  const classes = new Map();
  const rows = ["o1", "o2"].map((id) => ({
    dataset: { value: id },
    classList: { toggle(name, enabled) { classes.set(id + ":" + name, enabled); } },
    setAttribute() {}
  }));
  const properties = { innerHTML: "" };
  const root = {
    get innerHTML() { return html; }, set innerHTML(value) { html = value; writes += 1; },
    setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {},
    querySelectorAll(selector) { return selector === ".scene-object-row" ? rows : []; },
    querySelector(selector) { return selector === ".scene-properties-content" ? properties : null; }
  };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({ mode: "3d", phase: "editing", objects: [
    { id: "o1", kind: "asset", category: "bench", properties: { displayName: "木座椅" } },
    { id: "o2", kind: "asset", category: "tree", properties: { displayName: "落叶乔木" } }
  ] }));
  panel.updateSelection(Panel.buildViewModel({ mode: "3d", phase: "editing", selectedIds: ["o2"], selectedObject: { id: "o2", kind: "asset", category: "tree", transform: {}, properties: { displayName: "落叶乔木" } } }));
  assert.equal(writes, 1);
  assert.equal(classes.get("o1:is-selected"), false);
  assert.equal(classes.get("o2:is-selected"), true);
  assert.match(properties.innerHTML, /落叶乔木/);
});

test("switching from move to property inspection updates tool buttons without rebuilding the workspace", () => {
  let writes = 0;
  let html = "";
  const buttons = ["select", "move"].map((value) => ({
    dataset: { value }, pressed: "",
    setAttribute(name, next) { if (name === "aria-pressed") this.pressed = next; }
  }));
  const root = {
    get innerHTML() { return html; }, set innerHTML(value) { html = value; writes += 1; },
    setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {},
    querySelectorAll(selector) { return selector === '[data-action="tool"]' ? buttons : []; },
    querySelector() { return null; }
  };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({ mode: "3d", phase: "editing", activeTool: "move" }));
  panel.updateActiveTool("select");
  assert.equal(writes, 1);
  assert.deepEqual(buttons.map((button) => button.pressed), ["true", "false"]);
});

test("conflict state offers exactly the three explicit recovery choices and versions expose immutable actions", () => {
  const root = { innerHTML: "", setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {} };
  const panel = Panel.createSceneStudioPanel({ root });
  panel.render(Panel.buildViewModel({ phase: "conflict", conflict: { remoteRevision: 9 }, versions: [{ id: "v1", label: "中期方案", revision: 4, created_at: "2026-09-14", submission_status: "milestone" }] }));
  assert.equal((root.innerHTML.match(/data-action="conflict-/g) || []).length, 3);
  assert.match(root.innerHTML, /保留本地副本/);
  assert.match(root.innerHTML, /载入远端版本/);
  assert.match(root.innerHTML, /另存为新方案/);
  assert.match(root.innerHTML, /data-action="compare-version"/);
  assert.match(root.innerHTML, /在2D叠加对比/);
  assert.match(root.innerHTML, /data-action="restore-version"/);
  assert.match(root.innerHTML, /data-action="submit-version"/);
});
