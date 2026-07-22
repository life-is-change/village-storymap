(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GeoprocessingPanelModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_STEPS = Object.freeze(["buildings", "roads_water", "contours"]);
  const DEFAULT_PARAMETERS = Object.freeze({
    building_score_threshold: 0.35,
    contour_interval_m: 5,
    smoothing_sigma: 1
  });

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderGeoprocessingForm({ availability = "offline" } = {}) {
    const hint = availability === "offline"
      ? "服务器暂时离线，仍可提交排队，恢复后自动处理。"
      : availability === "busy" ? "服务器正在处理其他任务，本任务将进入队列。" : "服务器可用。";
    return `<div class="geoprocessing-panel" data-geoprocessing-root>
      <p class="geoprocessing-availability" data-availability="${escapeHtml(availability)}">${hint}</p>
      <div class="geoprocessing-aoi-actions">
        <button type="button" data-aoi-start>在二维地图绘制范围</button>
        <button type="button" data-aoi-clear>清除范围</button>
      </div>
      <form data-geoprocessing-form>
        <fieldset><legend>处理内容</legend>
          <label><input type="checkbox" name="steps" value="buildings" checked> 建筑轮廓识别</label>
          <label><input type="checkbox" name="steps" value="roads_water" checked> 道路与水系</label>
          <label><input type="checkbox" name="steps" value="contours" checked> 等高线</label>
        </fieldset>
        <label>建筑阈值 <input name="buildingThreshold" type="number" min="0.1" max="0.95" step="0.05" value="0.35"></label>
        <label>等高距 <select name="contourInterval"><option value="5" selected>5 m</option><option value="10">10 m</option></select></label>
        <label>平滑 <select name="smoothing"><option value="0">无</option><option value="1" selected>轻度</option></select></label>
        <button type="submit">提交个人图底任务</button>
      </form>
      <p class="geoprocessing-message" data-geoprocessing-message></p>
    </div>`;
  }

  function renderRunStatus(run) {
    const progress = Number(run?.progress || 0);
    return `<div class="geoprocessing-run" data-run-id="${escapeHtml(run?.id)}">
      <strong>任务状态：${escapeHtml(run?.status || "queued")}</strong>
      <span>${escapeHtml(run?.current_stage || "等待领取")} · ${progress}%</span>
      <progress max="100" value="${progress}"></progress>
      ${["queued", "claimed", "running", "cancel_requested"].includes(run?.status)
        ? '<button type="button" data-cancel-run>取消任务</button>' : ""}
      ${run?.status === "completed" ? '<div data-artifact-list>正在生成安全下载链接…</div>' : ""}
    </div>`;
  }

  function createGeoprocessingPanel({ container, client, aoiController, courseId, villageId, availability = "offline", onCompleted }) {
    let run = null;
    let unsubscribe = null;
    function showMessage(message) {
      const node = container.querySelector("[data-geoprocessing-message]");
      if (node) node.textContent = message;
    }
    async function loadArtifactLinks() {
      const slot = container.querySelector("[data-artifact-list]");
      if (!slot || !run?.id) return;
      try {
        const artifacts = await client.listArtifacts(run.id);
        const links = await Promise.all(artifacts.map(async (artifact) => {
          const signed = await client.createArtifactUrl(artifact.storage_path);
          const url = signed?.signedUrl || signed?.signedURL || "#";
          return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(artifact.artifact_type)} · ${Number(artifact.feature_count || 0)} 个要素</a></li>`;
        }));
        slot.innerHTML = `<strong>个人成果</strong><ul>${links.join("")}</ul>`;
      } catch (_) {
        slot.textContent = "成果链接暂时不可用，请稍后重试。";
      }
    }
    function updateRun(next) {
      run = next;
      const old = container.querySelector("[data-geoprocessing-run-slot]");
      if (old) old.innerHTML = renderRunStatus(run);
      if (run?.status === "completed") {
        loadArtifactLinks();
        onCompleted?.(run);
      }
    }
    async function submit(event) {
      event.preventDefault();
      const validation = aoiController.validate();
      if (!validation.ok) return showMessage(`范围无效：${validation.code}`);
      const form = event.currentTarget;
      const steps = [...form.querySelectorAll('input[name="steps"]:checked')].map((item) => item.value);
      if (!steps.length) return showMessage("请至少选择一个处理内容");
      const data = new FormData(form);
      const runId = await client.submit({
        courseId, villageId, aoi: validation.geometry, requestedSteps: steps,
        parameters: {
          building_score_threshold: Number(data.get("buildingThreshold")),
          contour_interval_m: Number(data.get("contourInterval")),
          smoothing_sigma: Number(data.get("smoothing"))
        }
      });
      updateRun({ id: runId, status: "queued", progress: 0 });
      unsubscribe?.();
      unsubscribe = client.subscribe(runId, updateRun);
      showMessage("任务已进入队列");
    }
    async function click(event) {
      if (event.target.closest("[data-aoi-start]")) aoiController.start();
      if (event.target.closest("[data-aoi-clear]")) aoiController.clear();
      if (event.target.closest("[data-cancel-run]") && run?.id) {
        await client.cancel(run.id);
        updateRun({ ...run, status: "cancel_requested" });
      }
    }
    return {
      mount() {
        container.innerHTML = `${renderGeoprocessingForm({ availability })}<div data-geoprocessing-run-slot></div>`;
        container.querySelector("[data-geoprocessing-form]").addEventListener("submit", submit);
        container.addEventListener("click", click);
      },
      destroy() {
        unsubscribe?.();
        aoiController.clear();
        container.removeEventListener("click", click);
        container.innerHTML = "";
      },
      getRun: () => run
    };
  }

  return { DEFAULT_STEPS, DEFAULT_PARAMETERS, createGeoprocessingPanel, renderGeoprocessingForm, renderRunStatus };
});
