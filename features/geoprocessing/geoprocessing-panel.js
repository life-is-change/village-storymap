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
  const ARTIFACT_LABELS = Object.freeze({
    buildings: "建筑轮廓",
    contours: "等高线",
    roads: "道路",
    waterways: "河流与沟渠",
    water_areas: "水面"
  });

  function getArtifactLabel(artifactType) {
    return ARTIFACT_LABELS[String(artifactType)] || String(artifactType || "成果图层");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderGeoprocessingForm({ availability = "offline" } = {}) {
    const hint = availability === "offline"
      ? "服务器暂时离线，仍可提交排队，恢复后自动处理。"
      : availability === "busy" ? "服务器正在处理其他任务，本任务将进入队列。" : "服务器可用。";
    return `<div class="geoprocessing-panel" data-geoprocessing-root>
      <div class="geoprocessing-availability" data-availability="${escapeHtml(availability)}">
        <span class="geoprocessing-status-dot" aria-hidden="true"></span>
        <span>${hint}</span>
      </div>
      <div class="geoprocessing-section-heading">
        <strong>研究范围</strong><span>先在影像上绘制本次处理范围</span>
      </div>
      <div class="geoprocessing-aoi-actions">
        <button class="geoprocessing-btn is-primary" type="button" data-aoi-start>在二维地图绘制范围</button>
        <button class="geoprocessing-btn is-secondary" type="button" data-aoi-clear>清除范围</button>
      </div>
      <form data-geoprocessing-form>
        <fieldset class="geoprocessing-processors"><legend>处理内容</legend>
          <div class="geoprocessing-processor-grid">
            <label><input type="checkbox" name="steps" value="buildings" checked><span><strong>建筑轮廓</strong><small>从影像识别建筑边界</small></span></label>
            <label><input type="checkbox" name="steps" value="roads_water" checked><span><strong>道路与水系</strong><small>提取 OSM 道路及水体</small></span></label>
            <label><input type="checkbox" name="steps" value="contours" checked><span><strong>等高线</strong><small>从 DEM 生成高程曲线</small></span></label>
          </div>
        </fieldset>
        <div class="geoprocessing-parameter-grid">
          <label><span>建筑阈值</span><input name="buildingThreshold" type="number" min="0.1" max="0.95" step="0.05" value="0.35"></label>
          <label><span>等高距</span><select name="contourInterval"><option value="5" selected>5 m</option><option value="10">10 m</option></select></label>
          <label><span>平滑程度</span><select name="smoothing"><option value="0">无</option><option value="1" selected>轻度</option></select></label>
        </div>
        <button class="geoprocessing-submit" type="submit">提交个人图底任务</button>
      </form>
      <p class="geoprocessing-message" data-geoprocessing-message></p>
    </div>`;
  }

  function renderRunStatus(run) {
    const progress = Number(run?.progress || 0);
    return `<div class="geoprocessing-run" data-run-id="${escapeHtml(run?.id)}">
      <div class="geoprocessing-run-heading"><strong>任务进度</strong><span>${escapeHtml(run?.status || "queued")}</span></div>
      <span class="geoprocessing-run-stage">${escapeHtml(run?.current_stage || "等待领取")} · ${progress}%</span>
      <progress max="100" value="${progress}"></progress>
      ${["queued", "claimed", "running", "cancel_requested"].includes(run?.status)
        ? '<button type="button" data-cancel-run>取消任务</button>' : ""}
      ${run?.status === "completed" ? `<div class="geoprocessing-result-card" data-artifact-list>正在生成安全下载链接…</div>
        <div class="geoprocessing-result-actions">
          <button type="button" data-preview-run>在地图中预览</button>
          ${run?.imported
            ? '<button type="button" data-run-saved disabled>已保存到个人空间</button>'
            : '<button type="button" data-save-run>保存到我的个人空间</button>'}
        </div>` : ""}
    </div>`;
  }

  async function restoreLatestRun({ client, villageId }) {
    const runs = await client.listMine(villageId);
    return Array.isArray(runs) ? (runs[0] || null) : null;
  }

  function isActiveRun(run) {
    return ["queued", "claimed", "running", "cancel_requested"].includes(run?.status);
  }

  function shouldNotifyCompletion(previousRun, nextRun) {
    return isActiveRun(previousRun) && nextRun?.status === "completed";
  }

  async function startAoiWithPreview({ onStartAoi, aoiController, showMessage }) {
    try {
      await onStartAoi?.();
      aoiController.start();
      showMessage?.("村庄影像预览已加载，请依次点击边界点，双击完成范围绘制。");
      return true;
    } catch (error) {
      showMessage?.("当前村庄的 TIF 预览尚未生成，请教师先运行预览生成命令后再绘制范围。");
      return false;
    }
  }

  function createGeoprocessingPanel({
    container, client, aoiController, courseId, teachingProjectId = null,
    villageId, datasetId = null, availability = "offline",
    onCompleted, onPreview, onImported, onStartAoi
  }) {
    let run = null;
    let unsubscribe = null;
    let artifacts = [];
    function showMessage(message) {
      const node = container.querySelector("[data-geoprocessing-message]");
      if (node) node.textContent = message;
    }
    async function loadArtifactLinks() {
      const slot = container.querySelector("[data-artifact-list]");
      if (!slot || !run?.id) return;
      try {
        artifacts = await client.listArtifacts(run.id);
        const links = await Promise.all(artifacts.map(async (artifact) => {
          const signed = await client.createArtifactUrl(artifact.storage_path);
          const url = signed?.signedUrl || signed?.signedURL || "#";
          return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener"><span>${escapeHtml(getArtifactLabel(artifact.artifact_type))}</span><strong>${Number(artifact.feature_count || 0)} 个要素</strong></a></li>`;
        }));
        slot.innerHTML = `<strong>个人成果</strong><ul>${links.join("")}</ul>`;
      } catch (_) {
        slot.textContent = "成果链接暂时不可用，请稍后重试。";
      }
    }
    function updateRun(next) {
      const previous = run;
      run = next;
      const old = container.querySelector("[data-geoprocessing-run-slot]");
      if (old) old.innerHTML = renderRunStatus(run);
      if (run?.status === "completed") {
        loadArtifactLinks();
        if (shouldNotifyCompletion(previous, run)) onCompleted?.(run);
      }
    }
    async function restore() {
      try {
        const latest = await restoreLatestRun({ client, villageId });
        if (!latest) return;
        const imported = latest.status === "completed" && typeof client.isRunImported === "function"
          ? await client.isRunImported(latest.id)
          : false;
        updateRun({ ...latest, imported });
        if (isActiveRun(latest)) {
          unsubscribe?.();
          unsubscribe = client.subscribe(latest.id, updateRun);
        }
      } catch (_) {
        showMessage("历史任务暂时无法恢复，可继续提交新任务。");
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
        courseId, teachingProjectId, villageId, datasetId,
        aoi: validation.geometry, requestedSteps: steps,
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
      if (event.target.closest("[data-aoi-start]")) {
        await startAoiWithPreview({ onStartAoi, aoiController, showMessage });
      }
      if (event.target.closest("[data-aoi-clear]")) aoiController.clear();
      if (event.target.closest("[data-cancel-run]") && run?.id) {
        await client.cancel(run.id);
        updateRun({ ...run, status: "cancel_requested" });
      }
      if (event.target.closest("[data-preview-run]") && run?.id) {
        try {
          if (!artifacts.length) artifacts = await client.listArtifacts(run.id);
          await onPreview?.(artifacts, run);
          showMessage("成果已临时加载到地图，可分别检查建筑、道路、水系和等高线。");
        } catch (_) {
          showMessage("成果预览失败，请稍后重试。");
        }
      }
      if (event.target.closest("[data-save-run]") && run?.id) {
        try {
          const bundle = await client.importRun(run.id);
          updateRun({ ...run, imported: true });
          showMessage("成果已保存到我的个人空间，并保留为新的图层版本。");
          await onImported?.(bundle, run);
        } catch (_) {
          showMessage("保存失败，个人空间未发生改变，请稍后重试。");
        }
      }
    }
    return {
      mount() {
        container.innerHTML = `${renderGeoprocessingForm({ availability })}<div data-geoprocessing-run-slot></div>`;
        container.querySelector("[data-geoprocessing-form]").addEventListener("submit", submit);
        container.addEventListener("click", click);
        restore();
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

  return {
    DEFAULT_STEPS,
    DEFAULT_PARAMETERS,
    getArtifactLabel,
    createGeoprocessingPanel,
    renderGeoprocessingForm,
    renderRunStatus,
    restoreLatestRun,
    shouldNotifyCompletion,
    startAoiWithPreview
  };
});
