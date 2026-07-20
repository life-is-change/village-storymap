const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("course task sidebar is the far-left workspace column", () => {
  const taskSidebarIndex = indexSource.indexOf('id="courseTaskSidebar"');
  const storyPanelIndex = indexSource.indexOf('id="courseContextPanel"');

  assert.notEqual(taskSidebarIndex, -1);
  assert.ok(taskSidebarIndex < storyPanelIndex);
  assert.match(indexSource, /id="courseTaskToggleBtn"/);
});

test("workspace uses rail, contextual sidebar and stable context bar", () => {
  assert.match(indexSource, /id="courseTaskSidebar"/);
  assert.match(indexSource, /id="courseContextPanel"/);
  assert.match(indexSource, /id="workspaceContextBar"/);
  assert.match(indexSource, /id="projectSettingsDrawer"/);
  assert.ok(
    indexSource.indexOf('id="courseTaskSidebar"') < indexSource.indexOf('id="courseContextPanel"')
  );
});

test("abstract collaboration and planning switches are absent", () => {
  assert.doesNotMatch(indexSource, /data-mode="collab"|data-mode="planning"/);
  assert.doesNotMatch(indexSource, />共建模式<|>规划模式</);
});

test("standalone course workbench view is removed", () => {
  assert.doesNotMatch(indexSource, /id="courseWorkbenchView"/);
  assert.doesNotMatch(appSource, /switchMainView\("courseWorkbench"\)/);
  assert.doesNotMatch(appSource, /mode-course-workbench/);
});

test("homepage platform entry refreshes course context and opens the map workspace", () => {
  const handler = appSource.match(
    /function bindStatusBadgeClick\(\)[\s\S]*?(?=\nfunction bindResizeObserver)/
  )?.[0] || "";

  assert.match(handler, /showDashboard/);
  assert.match(handler, /openCoursePlanningWorkspace\("2d"/);
});

test("homepage bridge waits for the iframe document root before binding", () => {
  const bridge = appSource.match(
    /function bindHomepageLandingBridge\(\)[\s\S]*?(?=\nfunction shouldShowVillageFillForCurrentSpace)/
  )?.[0] || "";

  assert.match(bridge, /if \(!frameDoc\?\.documentElement\) return/);
  assert.match(bridge, /frame\.addEventListener\("load", bindInFrame\)/);
});
