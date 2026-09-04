const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "admin.js"), "utf8");

test("管理员页面保持本地处理和后台发布的职责边界", () => {
  assert.doesNotMatch(html, /data-village-platform-process/);
  assert.doesNotMatch(runtime, /adminProcessingVillage/);
  assert.doesNotMatch(runtime, /functions\.invoke\("normalize-village-boundary"/);
});

test("村庄后台呈现三步式V0流程和独立的中期3D模型区", () => {
  assert.match(html, /data-village-step="create"/);
  assert.match(html, /data-village-step="import"/);
  assert.match(html, /data-village-step="publish"/);
  assert.match(html, /webkitdirectory/);
  assert.match(html, /学期中期 · 3D 实景模型/);
  assert.match(html, /Cesium ion Asset ID/);
  assert.match(html, /不替换或干扰二维建筑白模/);
});
