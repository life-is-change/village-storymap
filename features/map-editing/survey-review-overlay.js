(function (root, factory) {
  const model = typeof module === "object" && module.exports
    ? require("../survey/survey-review-model.js")
    : root.SurveyReviewModelModule;
  const activityModel = typeof module === "object" && module.exports
    ? require("../survey/survey-activity-model.js")
    : root.SurveyActivityModelModule;
  const api = factory(model, activityModel);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyReviewOverlayModule = api;
})(typeof window !== "undefined" ? window : globalThis, function (model, activityModel) {
  function buildSurveyOverlayState({ review, lock, hasUnresolvedIssue, activity = {}, focusPending, activityFilter = "all", showGeometryStatus = true } = {}) {
    const visual = model.getSurveyFeatureStyle(review, { focusPending });
    const status = String(review?.geometryStatus ?? review?.geometry_status ?? "pending");
    const flags = { ...activity, unresolvedIssue: Boolean(hasUnresolvedIssue || activity.unresolvedIssue) };
    const matchesFilter = activityModel.matchesActivityFilter(flags, activityFilter);
    return {
      ...visual,
      opacity: matchesFilter ? visual.opacity : Math.min(Number(visual.opacity ?? 1), 0.22),
      hidden: false,
      geometryState: showGeometryStatus ? (lock ? "editing" : (status === "pending" ? "pending" : "reviewed")) : "none",
      lockEditorName: String(lock?.editorName || lock?.editor_name || ""),
      badges: activityModel.getVisibleBadges(flags),
      activityFlags: flags,
      matchesFilter
    };
  }

  function keyed(source) {
    if (source instanceof Map) return source;
    return new Map(Object.entries(source || {}));
  }

  function applySurveyReviewVisuals({ layers = [], reviews, locks, issues, activities, focusPending = false, activityFilter = "all", showGeometryStatus = true } = {}) {
    const reviewMap = keyed(reviews);
    const lockMap = keyed(locks);
    const issueMap = keyed(issues);
    const activityMap = keyed(activities);
    for (const layer of layers) {
      const features = layer?.getSource?.()?.getFeatures?.() || [];
      for (const feature of features) {
        const layerKey = String(feature.get?.("layerKey") || "");
        const objectCode = String(feature.get?.("sourceCode") || "");
        const key = `${layerKey}:${objectCode}`;
        const state = buildSurveyOverlayState({
          review: reviewMap.get(key),
          lock: lockMap.get(key),
          hasUnresolvedIssue: Boolean(issueMap.get(key)),
          activity: activityMap.get(key),
          focusPending,
          activityFilter,
          showGeometryStatus
        });
        feature.set?.("surveyReviewVisual", state, true);
      }
      layer?.changed?.();
    }
  }

  return { buildSurveyOverlayState, applySurveyReviewVisuals };
});
