const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const panelSource = fs.readFileSync(path.join(root, "features/ui/space-panel.js"), "utf8");
const eventsSource = fs.readFileSync(path.join(root, "features/ui/space-panel-events.js"), "utf8");

test("space create rename and delete controls sit beside the top selector", () => {
  const selectorIndex = indexSource.indexOf('id="spaceHeaderSelect"');
  const actionsIndex = indexSource.indexOf('id="workspaceSpaceActions"');
  assert.ok(selectorIndex >= 0 && actionsIndex > selectorIndex);
  assert.match(indexSource, /id="addSpaceTopBtn"[^>]*data-add-space/);
  assert.match(indexSource, /id="renameCurrentSpaceBtn"[^>]*data-space-rename-trigger/);
  assert.match(indexSource, /id="deleteCurrentSpaceBtn"[^>]*data-space-delete/);
});

test("project settings does not duplicate the space management header", () => {
  assert.doesNotMatch(panelSource, /menu-l1-title">空间管理/);
});

test("administrator can manage every non-system space", () => {
  const permission = appSource.match(
    /function canManageSpace\([\s\S]*?(?=\nfunction canEditCurrentSpace)/
  )?.[0] || "";
  assert.match(permission, /space\.id !== BASE_SPACE_ID && isAdminIdentity\(actor\)/);
});

test("persistent top space buttons bind only once and follow the current space", () => {
  assert.match(panelSource, /renameCurrentSpaceBtn/);
  assert.match(panelSource, /deleteCurrentSpaceBtn/);
  assert.match(eventsSource, /spaceActionBound/);
});

test("managed village context uses semantic space labels and hides manual space actions", () => {
  assert.doesNotMatch(panelSource, /label: "(?:我创建的空间|他人创建的空间|未标注创建者|系统空间)/);
  assert.match(panelSource, /我的个人体验空间/);
  assert.match(panelSource, /全班共享现状空间/);
  assert.match(panelSource, /workspaceSpaceActions/);
  assert.match(panelSource, /managedVillageContext/);
});

test("realtime space sync reapplies the active village context", () => {
  const syncFunction = appSource.match(
    /async function syncSpacesFromSupabase\(\)[\s\S]*?(?=\n\s*function saveAppState)/
  )?.[0] || "";
  assert.match(syncFunction, /activeVillageContext\?\.teachingProjectId/);
  assert.match(syncFunction, /filterSpacesForContext\(\{\s*spaces:/);
  assert.match(syncFunction, /mapContextSpaceToWorkspace/);
  assert.match(syncFunction, /isStaff:\s*false/);
  assert.match(appSource, /teachingProjectId:\s*row\.teaching_project_id/);
  assert.match(appSource, /villageId:\s*row\.village_id/);
});
