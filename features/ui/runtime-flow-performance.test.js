const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("后台按页签延迟初始化且返回平台优先恢复历史页面", () => {
  const admin = read("admin.js");
  const html = read("admin.html");
  assert.match(admin, /ensureAdminTabInitialized/);
  assert.match(admin, /history\.back\(\)/);
  assert.match(html, /data-return-platform/);
});

test("首页不预热课程工作台或大体量基础数据", () => {
  const app = read("app.js");
  const initStart = app.lastIndexOf("async function init()");
  const initEnd = app.indexOf("/* ===================== Realtime", initStart);
  const init = app.slice(initStart, initEnd);
  assert.doesNotMatch(init, /await ensureCourseWorkbenchInitialized\(\)/);
  assert.doesNotMatch(init, /seedBuildingsForCopySpace\(BASE_SPACE_ID\)/);
  assert.match(init, /showVillageOverview\(\)/);
});
