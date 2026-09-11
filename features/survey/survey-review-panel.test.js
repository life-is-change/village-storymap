const test = require("node:test");
const assert = require("node:assert/strict");

const panel = require("./survey-review-panel.js");

test("renders compact progress and low-noise activity filters", () => {
  const html = panel.renderSurveyProgress({ baselineTotal: 380, reviewedBaseline: 126, confirmedUnchanged: 90, modified: 30, deleted: 6, added: 4, photoCount: 18, discussionCount: 9, unresolvedIssueCount: 3 }, false);
  assert.match(html, /现状进度/);
  assert.match(html, /126\s*\/\s*380/);
  assert.match(html, /聚焦未校核/);
  assert.match(html, /data-survey-filter="geometry"/);
  assert.match(html, /data-survey-filter="photo"/);
  assert.match(html, /data-survey-filter="discussion"/);
  assert.match(html, /确认无误\s*90/);
  assert.match(html, /已修改\s*30/);
  assert.match(html, /照片\s*18/);
  assert.match(html, /讨论\s*9/);
  assert.match(html, /待处理\s*3/);
});

test("object review offers a direct geometry edit shortcut for editable states", () => {
  const pending = panel.renderObjectReview({ geometryStatus: "pending", geometryRevision: 2 });
  assert.match(pending, /确认几何无误/);
  assert.match(pending, /data-survey-confirm/);
  assert.match(pending, /编辑几何/);
  assert.match(pending, /data-survey-edit-geometry/);
  const modified = panel.renderObjectReview({ geometryStatus: "modified", geometryRevision: 3 });
  assert.doesNotMatch(modified, /data-survey-confirm/);
  assert.match(modified, /已修改/);
  assert.match(modified, /data-survey-edit-geometry/);
  const deleted = panel.renderObjectReview({ geometryStatus: "deleted", geometryRevision: 3 });
  assert.doesNotMatch(deleted, /data-survey-edit-geometry/);
});

test("练习村与正式村共用可校核的进度面板", () => {
  const html = panel.renderSurveyProgress({ baselineTotal: 12, reviewedBaseline: 3 }, false, "photo");
  assert.match(html, /现状进度/);
  assert.match(html, /3\s*\/\s*12/);
  assert.match(html, /data-survey-filter="photo" aria-pressed="true"/);
  assert.match(html, /聚焦未校核/);
});
