const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const spacePanelSource = fs.readFileSync(path.join(root, "features/ui/space-panel.js"), "utf8");
const spacePanelEventsSource = fs.readFileSync(
  path.join(root, "features/ui/space-panel-events.js"),
  "utf8"
);

test("space panel targets stable context mounts", () => {
  assert.match(spacePanelSource, /workspaceViewModeSwitch/);
  assert.match(spacePanelSource, /spaceHeaderSelect/);
  assert.doesNotMatch(spacePanelSource, /querySelector\("\[data-mode-switch\]"\)/);
});

test("settings expose layers, issues, tools and export together", () => {
  for (const label of ["图层控制", "问题与留言", "空间工具", "导出"]) {
    assert.match(spacePanelSource, new RegExp(label));
  }
});

test("settings events no longer bind the abstract collaboration planning switch", () => {
  assert.doesNotMatch(spacePanelEventsSource, /querySelector\("\[data-mode-switch\]"\)/);
  assert.match(spacePanelEventsSource, /querySelectorAll\("\[data-space-view\]"\)/);
});
