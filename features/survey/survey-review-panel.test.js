const test = require("node:test");
const assert = require("node:assert/strict");

const panel = require("./survey-review-panel.js");

test("renders only compact progress and one focus action", () => {
  const html = panel.renderSurveyProgress({ baselineTotal: 380, reviewedBaseline: 126 }, false);
  assert.match(html, /几何校核/);
  assert.match(html, /126\s*\/\s*380/);
  assert.match(html, /聚焦未校核/);
  assert.doesNotMatch(html, /仅看几何未校核|已确认无误|正在被编辑/);
});

test("object review action is primary only while pending", () => {
  const pending = panel.renderObjectReview({ geometryStatus: "pending", geometryRevision: 2 });
  assert.match(pending, /确认几何无误/);
  assert.match(pending, /data-survey-confirm/);
  const modified = panel.renderObjectReview({ geometryStatus: "modified", geometryRevision: 3 });
  assert.doesNotMatch(modified, /data-survey-confirm/);
  assert.match(modified, /已修改/);
});

