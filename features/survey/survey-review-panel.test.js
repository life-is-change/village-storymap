const test = require("node:test");
const assert = require("node:assert/strict");

const panel = require("./survey-review-panel.js");

test("renders compact progress and low-noise activity filters", () => {
  const html = panel.renderSurveyProgress({ baselineTotal: 380, reviewedBaseline: 126 }, false);
  assert.match(html, /现状进度/);
  assert.match(html, /126\s*\/\s*380/);
  assert.match(html, /聚焦未校核/);
  assert.match(html, /data-survey-filter="geometry"/);
  assert.match(html, /data-survey-filter="photo"/);
  assert.match(html, /data-survey-filter="discussion"/);
});

test("object review action is primary only while pending", () => {
  const pending = panel.renderObjectReview({ geometryStatus: "pending", geometryRevision: 2 });
  assert.match(pending, /确认几何无误/);
  assert.match(pending, /data-survey-confirm/);
  const modified = panel.renderObjectReview({ geometryStatus: "modified", geometryRevision: 3 });
  assert.doesNotMatch(modified, /data-survey-confirm/);
  assert.match(modified, /已修改/);
});

test("练习村显示可发现的活动标记入口但不冒充正式校核进度", () => {
  const html = panel.renderSurveyActivityOnly("photo");

  assert.match(html, /现状标记/);
  assert.match(html, /data-survey-filter="photo" aria-pressed="true"/);
  assert.match(html, /几何变化/);
  assert.match(html, /照片/);
  assert.match(html, /讨论/);
  assert.doesNotMatch(html, /聚焦未校核/);
  assert.doesNotMatch(html, /\d+\s*\/\s*\d+/);
});
