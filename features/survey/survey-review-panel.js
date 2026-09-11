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

  function renderActivityFilters(activityFilter = "all") {
    return `<div class="survey-progress-filters" aria-label="现状活动筛选">
      <button type="button" data-survey-filter="all" aria-pressed="${activityFilter === "all"}">全部</button>
      <button type="button" data-survey-filter="geometry" aria-pressed="${activityFilter === "geometry"}">改过几何</button>
      <button type="button" data-survey-filter="photo" aria-pressed="${activityFilter === "photo"}">有照片</button>
      <button type="button" data-survey-filter="discussion" aria-pressed="${activityFilter === "discussion"}">有讨论</button>
      <button type="button" data-survey-filter="incomplete" aria-pressed="${activityFilter === "incomplete"}">待处理</button>
      <div class="survey-marker-legend" aria-label="地图标记图例">◇ 几何变化 · ▣ 照片 · ○ 讨论 · ✎ 属性 · ! 待处理</div>
    </div>`;
  }

  function renderSurveyProgress(progress = {}, focusPending = false, activityFilter = "all") {
    const reviewed = Number(progress.reviewedBaseline || 0);
    const total = Number(progress.baselineTotal || 0);
    const confirmed = Number(progress.confirmedUnchanged || 0);
    const modified = Number(progress.modified || 0);
    const added = Number(progress.added || 0);
    const deleted = Number(progress.deleted || 0);
    const photos = Number(progress.photoCount || 0);
    const discussions = Number(progress.discussionCount || 0);
    const pending = Number(progress.unresolvedIssueCount ?? progress.pendingCount ?? Math.max(0, total - reviewed));
    return `<div class="survey-review-progress" role="status">
      <details class="survey-progress-menu"><summary aria-label="现状进度 ${reviewed} / ${total}"><span>现状</span> <strong>${reviewed} / ${total}</strong></summary>
        <div class="survey-progress-popover">
          <div class="survey-progress-summary" aria-label="现状校核统计">
            <span>确认无误 ${confirmed}</span>
            <span>已修改 ${modified}</span>
            <span>新增 ${added}</span>
            <span>已删除 ${deleted}</span>
            <span>照片 ${photos}</span>
            <span>讨论 ${discussions}</span>
            <span>待处理 ${pending}</span>
          </div>
          <button class="survey-focus-toggle" type="button" data-survey-focus aria-pressed="${focusPending}">${focusPending ? "显示全部要素" : "仅显示未校核"}</button>
          ${renderActivityFilters(activityFilter)}
        </div>
      </details>
    </div>`;
  }

  function renderSurveyActivityOnly(activityFilter = "all") {
    return `<div class="survey-review-progress survey-activity-only" role="status">
      <details class="survey-progress-menu"><summary>现状标记</summary>
        <div class="survey-progress-popover survey-activity-popover">${renderActivityFilters(activityFilter)}</div>
      </details>
    </div>`;
  }

  function renderObjectReview(review = {}) {
    const normalized = normalizeReview(review);
    const label = STATUS_LABELS[normalized.geometryStatus] || STATUS_LABELS.pending;
    return `<section class="survey-object-review" data-survey-object-review>
      <div><span>几何状态</span><strong>${escapeHtml(label)}</strong></div>
      <div class="survey-object-review-meta">修订 ${normalized.geometryRevision}${normalized.latestModifiedBy ? ` · 最近处理 ${escapeHtml(normalized.latestModifiedBy)}` : ""}</div>
      <div class="survey-object-review-actions">
        ${normalized.geometryStatus === "pending"
          ? '<button type="button" data-survey-confirm>确认几何无误</button>'
          : ""}
        ${normalized.geometryStatus !== "deleted"
          ? '<button type="button" class="secondary" data-survey-edit-geometry>编辑几何</button>'
          : ""}
      </div>
    </section>`;
  }

  function createSurveyReviewPanel({ root: panelRoot, onConfirm, onEditGeometry, onToggleFocus, onFilterChange } = {}) {
    if (!panelRoot) throw new Error("SURVEY_REVIEW_PANEL_ROOT_REQUIRED");
    let progress = { reviewedBaseline: 0, baselineTotal: 0 };
    let focusPending = false;
    let activityFilter = "all";
    let objectReview = null;
    let panelMode = "progress";

    function render() {
      panelRoot.innerHTML = panelMode === "activity"
        ? renderSurveyActivityOnly(activityFilter)
        : `${renderSurveyProgress(progress, focusPending, activityFilter)}${objectReview ? renderObjectReview(objectReview) : ""}`;
      panelRoot.hidden = false;
    }

    async function handleClick(event) {
      if (event.target?.closest?.("[data-survey-focus]")) {
        focusPending = !focusPending;
        await onToggleFocus?.(focusPending);
        render();
      } else if (event.target?.closest?.("[data-survey-filter]")) {
        const filter = String(event.target.closest("[data-survey-filter]").dataset.surveyFilter || "all");
        activityFilter = filter;
        await onFilterChange?.(filter);
        render();
      } else if (event.target?.closest?.("[data-survey-confirm]") && objectReview) {
        await onConfirm?.(objectReview);
      } else if (event.target?.closest?.("[data-survey-edit-geometry]") && objectReview) {
        await onEditGeometry?.(objectReview);
      }
    }

    panelRoot.addEventListener("click", handleClick);
    return {
      setProgress(nextProgress, nextFocus = focusPending) {
        panelMode = "progress";
        progress = nextProgress || progress;
        focusPending = Boolean(nextFocus);
        render();
      },
      setActivityOnly(nextFilter = activityFilter) {
        panelMode = "activity";
        activityFilter = String(nextFilter || "all");
        objectReview = null;
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

  return { STATUS_LABELS, renderSurveyProgress, renderSurveyActivityOnly, renderObjectReview, createSurveyReviewPanel };
});
