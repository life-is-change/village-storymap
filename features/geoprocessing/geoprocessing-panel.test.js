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
  createGeoprocessingPanel
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

test("submitting after an asynchronous status check does not reread the expired event target", async () => {
  let submitHandler;
  let resolveStatus;
  const requests = [];
  const message = { textContent: "" };
  const submitButton = { disabled: false };
  const slot = { innerHTML: "" };
  const form = {
    addEventListener(type, handler) { if (type === "submit") submitHandler = handler; },
    querySelectorAll(selector) {
      assert.equal(selector, 'input[name="steps"]:checked');
      return [{ value: "buildings" }];
    },
    querySelector(selector) { return selector === ".geoprocessing-submit" ? submitButton : null; }
  };
  const container = {
    innerHTML: "",
    addEventListener() {},
    querySelector(selector) {
      return {
        "[data-geoprocessing-form]": form,
        "[data-geoprocessing-message]": message,
        "[data-geoprocessing-run-slot]": slot,
        ".geoprocessing-submit": submitButton
      }[selector] || null;
    }
  };
  const originalFormData = globalThis.FormData;
  globalThis.FormData = class {
    get(name) { return { buildingThreshold: "0.35", contourInterval: "5", smoothing: "1" }[name]; }
  };
  try {
    const panel = createGeoprocessingPanel({
      container,
      client: {
        listMine: async () => [],
        getSourceStatus: () => new Promise((resolve) => { resolveStatus = resolve; }),
        submit: async (payload) => { requests.push(payload); return "new-run-id"; },
        subscribe: () => () => {}
      },
      aoiController: { validate: () => ({ ok: true, geometry: { type: "Polygon", coordinates: [] } }) },
      courseId: "course-1",
      teachingProjectId: "project-1",
      villageId: "village-1",
      sourceStatus: { state: "ready" }
    });
    panel.mount();
    const event = { currentTarget: form, preventDefault() {} };
    const pending = submitHandler(event);
    event.currentTarget = null;
    resolveStatus({ state: "ready" });
    await pending;
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].requestedSteps, ["buildings"]);
    assert.match(message.textContent, /任务已进入队列/);
  } finally {
    globalThis.FormData = originalFormData;
  }
});

test("unmounting the panel leaves an unfinished AOI draft intact", () => {
  let cleared = 0;
  const panel = createGeoprocessingPanel({
    container: { innerHTML: "", removeEventListener() {} },
    client: {},
    aoiController: { clear() { cleared += 1; } },
    villageId: "mibu"
  });
  panel.destroy();
  assert.equal(cleared, 0);
});
