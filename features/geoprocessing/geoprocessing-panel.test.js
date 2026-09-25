const test = require("node:test");
const assert = require("node:assert/strict");
const {
  renderGeoprocessingForm,
  renderRunStatus,
  restoreLatestRun,
  startAoiWithPreview,
  shouldNotifyCompletion,
  getArtifactLabel,
  createSubmissionGuard,
  refreshSourceStatus
} = require("./geoprocessing-panel.js");
const { formatAoiValidationMessage, formatSubmissionError } = require("./geoprocessing-panel.js");

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

test("failed run shows the worker's stored reason and run id instead of only failed", () => {
  const html = renderRunStatus({ id: "run-42", status: "failed", progress: 1,
    error_code: "DATASET_NOT_FOUND", error_message: "Missing configured imagery" });
  assert.match(html, /DATASET_NOT_FOUND/);
  assert.match(html, /Missing configured imagery/);
  assert.match(html, /run-42/);
  assert.doesNotMatch(html, /等待领取/);
});

test("worker failure text is escaped before rendering", () => {
  const html = renderRunStatus({ id: "run-1", status: "failed", error_message: "<img src=x>" });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
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

test("personal workspace failure is not misreported as missing TIF preview", async () => {
  const messages = [];
  await startAoiWithPreview({
    onStartAoi: async () => { throw new Error("PERSONAL_SPACE_UNAVAILABLE"); },
    aoiController: { start() { assert.fail("must not draw in shared space"); } },
    showMessage: (message) => messages.push(message)
  });
  assert.match(messages[0], /个人空间/);
  assert.doesNotMatch(messages[0], /TIF/);
});

test("AOI too large message gives measured area and village limit", () => {
  assert.match(formatAoiValidationMessage({ code: "AOI_TOO_LARGE", areaSqKm: 0.76, maxAreaSqKm: 0.5 }), /0\.76.*0\.50/);
});

test("backend AOI size rejection gives actionable guidance", () => {
  assert.match(formatSubmissionError({ message: "AOI_TOO_LARGE" }), /缩小范围/);
});

test("missing local imagery disables drawing and submission with a clear reason", () => {
  const html = renderGeoprocessingForm({ availability: "available", sourceStatus: { state: "missing", error_code: "LOCAL_IMAGERY_MISSING" } });
  assert.match(html, /本地遥感影像/);
  assert.match(html, /data-aoi-start[^>]*disabled/);
  assert.match(html, /class="geoprocessing-submit"[^>]*disabled/);
  assert.match(html, /data-source-refresh/);
});

test("refreshing source status enables controls and updates AOI limits after the worker recovers", async () => {
  const draw = { disabled: true };
  const submit = { disabled: true };
  const hint = { textContent: "" };
  const limits = [];
  const elements = { "[data-aoi-start]": draw, ".geoprocessing-submit": submit, "[data-source-hint]": hint };
  const status = await refreshSourceStatus({
    client: { getSourceStatus: async () => ({ state: "ready", bounds: [1, 2, 3, 4], max_aoi_sq_km: 2 }) },
    villageId: "village-1",
    container: { querySelector: (selector) => elements[selector] },
    aoiController: {
      setVillageBounds: (bounds) => limits.push(bounds),
      setMaxAreaSqKm: (limit) => limits.push(limit)
    },
    activeRun: false
  });
  assert.equal(status.state, "ready");
  assert.equal(draw.disabled, false);
  assert.equal(submit.disabled, false);
  assert.match(hint.textContent, /已就绪/);
  assert.deepEqual(limits, [[1, 2, 3, 4], 2]);
});

test("submission guard prevents a second request while the first is pending", async () => {
  const guard = createSubmissionGuard();
  let finish;
  let calls = 0;
  const first = guard.run(async () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  });
  const second = await guard.run(async () => { calls += 1; return "duplicate"; });
  assert.equal(second.accepted, false);
  assert.equal(calls, 1);
  finish("run-1");
  assert.deepEqual(await first, { accepted: true, value: "run-1" });
  assert.equal(guard.isSubmitting(), false);
});

test("submission guard unlocks after failure", async () => {
  const guard = createSubmissionGuard();
  await assert.rejects(guard.run(async () => { throw new Error("NETWORK_ERROR"); }), /NETWORK_ERROR/);
  assert.equal(guard.isSubmitting(), false);
  assert.deepEqual(await guard.run(async () => "run-2"), { accepted: true, value: "run-2" });
});
