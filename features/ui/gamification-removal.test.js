const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

test("contribution points and levels are absent from the student and admin UI", () => {
  const panel = fs.readFileSync(path.join(root, "features", "ui", "space-panel.js"), "utf8");
  const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  const profileHtml = fs.readFileSync(path.join(root, "profile.html"), "utf8");
  const profileJs = fs.readFileSync(path.join(root, "profile-center.js"), "utf8");
  assert.doesNotMatch(panel, /communityScoreBadge|贡献值/);
  assert.doesNotMatch(admin, /admin-contribution-badge|贡献值|formatContribution|fetchUserStatsMap/);
  assert.doesNotMatch(profileHtml, /贡献值|Lv\.1|profileFieldContribution/);
  assert.doesNotMatch(profileJs, /refreshContribution|formatContribution|profileFieldContribution|读取贡献值/);
});
