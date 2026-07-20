const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const spaceEventsSource = fs.readFileSync(
  path.join(root, "features/ui/space-panel-events.js"),
  "utf8"
);
const viewSwitcherSource = fs.readFileSync(
  path.join(root, "features/ui/view-switcher.js"),
  "utf8"
);

test("workspace context bar follows the selected course task", () => {
  assert.match(appSource, /function updateWorkspaceContextBar\(/);
  assert.match(appSource, /onTaskChanged:/);
  assert.match(appSource, /workspaceStageLabel/);
  assert.match(appSource, /workspaceVillageLabel/);
});

test("project settings drawer has one explicit open state", () => {
  assert.match(appSource, /function setProjectSettingsOpen\(/);
  assert.match(appSource, /projectSettingsBtn\.addEventListener/);
  assert.match(appSource, /projectSettingsCloseBtn\.addEventListener/);
});

test("2D overview no longer replaces the object panel with the global message board", () => {
  const overviewFunction = appSource.match(
    /function showPlan2DOverview\(\)[\s\S]*?(?=\nfunction getEditNamespaceObjectType)/
  )?.[0] || "";

  assert.doesNotMatch(overviewFunction, /refreshCommunityMessageBoard/);
  assert.match(overviewFunction, /currentSelectedObject/);
});

test("changing only 2D and 3D view does not clear the selected object", () => {
  const viewHandler = spaceEventsSource.match(
    /const viewModeButtons[\s\S]*?(?=\n\s*const layerButtons)/
  )?.[0] || "";

  assert.doesNotMatch(viewHandler, /setCurrentSelectedObject\(null\)/);
  assert.match(viewHandler, /switchTo2DView|switchTo3DView/);
});

test("object panel guidance stays meaningful in both 2D and 3D", () => {
  assert.match(viewSwitcherSource, /选择地图对象，查看属性、照片与相关讨论/);
  assert.match(viewSwitcherSource, /2D 与 3D 共用对象信息/);
});
