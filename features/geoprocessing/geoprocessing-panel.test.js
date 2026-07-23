const test = require("node:test");
const assert = require("node:assert/strict");
const {
  renderGeoprocessingForm,
  renderRunStatus,
  restoreLatestRun,
  startAoiWithPreview,
  shouldNotifyCompletion,
  getArtifactLabel
} = require("./geoprocessing-panel.js");

test("panel defaults to all processors and safe parameters", () => {
  const html = renderGeoprocessingForm({ availability: "available" });
  assert.match(html, /value="buildings"[^>]*checked/);
  assert.match(html, /value="roads_water"[^>]*checked/);
  assert.match(html, /value="contours"[^>]*checked/);
  assert.match(html, /value="5"[^>]*selected/);
  assert.match(html, /value="0.35"/);
  assert.match(html, /geoprocessing-processor-grid/);
  assert.match(html, /geoprocessing-submit/);
  assert.match(html, /geoprocessing-status-dot/);
});

test("artifact names are presented as student-facing Chinese layer names", () => {
  assert.equal(getArtifactLabel("buildings"), "建筑轮廓");
  assert.equal(getArtifactLabel("contours"), "等高线");
  assert.equal(getArtifactLabel("water_areas"), "水面");
});

test("completed run offers map preview and explicit personal-space save", () => {
  const html = renderRunStatus({ id: "run-1", status: "completed", progress: 100 });
  assert.match(html, /data-preview-run/);
  assert.match(html, /在地图中预览/);
  assert.match(html, /data-save-run/);
  assert.match(html, /保存到我的个人空间/);
  assert.match(html, /geoprocessing-result-card/);
});

test("saved run renders a disabled saved state instead of another import action", () => {
  const html = renderRunStatus({ id: "run-1", status: "completed", progress: 100, imported: true });
  assert.match(html, /data-run-saved/);
  assert.match(html, /已保存到个人空间/);
  assert.doesNotMatch(html, /data-save-run/);
});

test("completion notification only fires for an active to completed transition", () => {
  assert.equal(shouldNotifyCompletion({ status: "running" }, { status: "completed" }), true);
  assert.equal(shouldNotifyCompletion(null, { status: "completed" }), false);
  assert.equal(shouldNotifyCompletion({ status: "completed" }, { status: "completed" }), false);
  assert.equal(shouldNotifyCompletion({ status: "failed" }, { status: "completed" }), false);
});

test("panel restoration selects the latest owned village run", async () => {
  const calls = [];
  const latest = { id: "run-latest", status: "completed", created_at: "2026-07-22T08:00:00Z" };
  const result = await restoreLatestRun({
    villageId: "mibu",
    client: {
      async listMine(villageId) {
        calls.push(villageId);
        return [latest, { id: "run-old", status: "completed" }];
      }
    }
  });
  assert.deepEqual(calls, ["mibu"]);
  assert.equal(result, latest);
});

test("AOI drawing starts only after the village preview is ready", async () => {
  const calls = [];
  await startAoiWithPreview({
    onStartAoi: async () => calls.push("preview"),
    aoiController: { start() { calls.push("draw"); } },
    showMessage() {}
  });
  assert.deepEqual(calls, ["preview", "draw"]);
});

test("AOI drawing stays stopped when the village preview is unavailable", async () => {
  const calls = [];
  const ok = await startAoiWithPreview({
    onStartAoi: async () => { throw new Error("VILLAGE_PREVIEW_NOT_FOUND"); },
    aoiController: { start() { calls.push("draw"); } },
    showMessage(message) { calls.push(message); }
  });
  assert.equal(ok, false);
  assert.equal(calls.some((item) => item === "draw"), false);
  assert.match(calls[0], /预览/);
});
