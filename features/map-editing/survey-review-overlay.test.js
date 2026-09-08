const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const overlay = require("./survey-review-overlay.js");

test("review overlay maps geometry to only reviewed, pending or editing", () => {
  const state = overlay.buildSurveyOverlayState({
    review: { geometryStatus: "modified" },
    lock: { editorName: "学生甲" },
    hasUnresolvedIssue: true,
    focusPending: true
  });
  assert.equal(state.opacity, 0.18);
  assert.equal(state.geometryState, "editing");
  assert.equal(state.badges.some((item) => item.key === "issue"), true);
  assert.equal(state.hidden, false);
});

test("pending features remain fully visible in focus mode", () => {
  const state = overlay.buildSurveyOverlayState({
    review: { geometry_status: "pending" },
    focusPending: true
  });
  assert.equal(state.opacity, 1);
  assert.equal(state.emphasis, "pending");
  assert.equal(state.geometryState, "pending");
});

test("the OpenLayers style consumes the 18 percent review visual", () => {
  const source = fs.readFileSync(path.join(__dirname, "../ui/map-style.js"), "utf8");
  assert.match(source, /surveyReviewVisual/);
  assert.match(source, /visualOpacity/);
  assert.match(source, /applyColorOpacity/);
  assert.match(source, /geometryState/);
  assert.match(source, /surveyReviewVisual\.badges/);
  assert.match(source, /isFarSurveyZoom/);
});

test("geometry saves attach the held lock and current review revision", () => {
  const source = fs.readFileSync(path.join(__dirname, "geometry-editor.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  assert.match(source, /getSurveyGeometryEvidence/);
  assert.match(app, /expectedGeometryRevision/);
  assert.match(app, /lockToken/);
});
