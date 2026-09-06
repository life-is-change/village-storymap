(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyReviewPanelModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const STATUS_LABELS = Object.freeze({
    pending: "待校核",
    confirmed_unchanged: "已确认无误",
    modified: "已修改",
    deleted: "已删除",
    added: "新增对象"
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function normalizeReview(review = {}) {
    return {
      geometryStatus: String(review.geometryStatus ?? review.geometry_status ?? "pending"),
      geometryRevision: Number(review.geometryRevision ?? review.geometry_revision ?? 0) || 0,
      latestModifiedBy: String(review.latestModifiedBy ?? review.latest_modified_by ?? "")
    };
  }

  function renderSurveyProgress(progress = {}, focusPending = false) {
    const reviewed = Number(progress.reviewedBaseline || 0);
    const total = Number(progress.baselineTotal || 0);
    return `<div class="survey-review-progress" role="status">
      <span>几何校核 <strong>${reviewed} / ${total}</strong></span>
      <button type="button" data-survey-focus aria-pressed="${focusPending}">${focusPending ? "退出聚焦" : "聚焦未校核"}</button>
    </div>`;
  }

  function renderObjectReview(review = {}) {
    const normalized = normalizeReview(review);
    const label = STATUS_LABELS[normalized.geometryStatus] || STATUS_LABELS.pending;
    return `<section class="survey-object-review" data-survey-object-review>
      <div><span>几何状态</span><strong>${escapeHtml(label)}</strong></div>
      <div class="survey-object-review-meta">修订 ${normalized.geometryRevision}${normalized.latestModifiedBy ? ` · 最近处理 ${escapeHtml(normalized.latestModifiedBy)}` : ""}</div>
      ${normalized.geometryStatus === "pending"
        ? '<button type="button" data-survey-confirm>确认几何无误</button>'
        : ""}
    </section>`;
  }

  function createSurveyReviewPanel({ root: panelRoot, onConfirm, onToggleFocus } = {}) {
    if (!panelRoot) throw new Error("SURVEY_REVIEW_PANEL_ROOT_REQUIRED");
    let progress = { reviewedBaseline: 0, baselineTotal: 0 };
    let focusPending = false;
    let objectReview = null;

    function render() {
      panelRoot.innerHTML = `${renderSurveyProgress(progress, focusPending)}${objectReview ? renderObjectReview(objectReview) : ""}`;
      panelRoot.hidden = false;
    }

    async function handleClick(event) {
      if (event.target?.closest?.("[data-survey-focus]")) {
        focusPending = !focusPending;
        await onToggleFocus?.(focusPending);
        render();
      } else if (event.target?.closest?.("[data-survey-confirm]") && objectReview) {
        await onConfirm?.(objectReview);
      }
    }

    panelRoot.addEventListener("click", handleClick);
    return {
      setProgress(nextProgress, nextFocus = focusPending) {
        progress = nextProgress || progress;
        focusPending = Boolean(nextFocus);
        render();
      },
      setObjectReview(nextReview) {
        objectReview = nextReview || null;
        render();
      },
      hide() {
        panelRoot.hidden = true;
        objectReview = null;
      },
      destroy() {
        panelRoot.removeEventListener("click", handleClick);
        panelRoot.innerHTML = "";
      }
    };
  }

  return { STATUS_LABELS, renderSurveyProgress, renderObjectReview, createSurveyReviewPanel };
});

