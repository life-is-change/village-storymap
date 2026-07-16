const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("course task sidebar is the far-left workspace column", () => {
  const taskSidebarIndex = indexSource.indexOf('id="courseTaskSidebar"');
  const storyPanelIndex = indexSource.indexOf('class="story-panel"');

  assert.notEqual(taskSidebarIndex, -1);
  assert.ok(taskSidebarIndex < storyPanelIndex);
  assert.match(indexSource, /id="courseTaskToggleBtn"/);
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
