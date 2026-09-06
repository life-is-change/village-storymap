(function (root, factory) {
  const model = typeof module === "object" && module.exports
    ? require("../survey/survey-review-model.js")
    : root.SurveyReviewModelModule;
  const api = factory(model);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyReviewOverlayModule = api;
})(typeof window !== "undefined" ? window : globalThis, function (model) {
  function buildSurveyOverlayState({ review, lock, hasUnresolvedIssue, focusPending } = {}) {
    const visual = model.getSurveyFeatureStyle(review, { focusPending });
    return {
      ...visual,
      hidden: false,
      lockOutline: lock ? "blue" : "none",
      lockEditorName: String(lock?.editorName || lock?.editor_name || ""),
      issueMarker: hasUnresolvedIssue ? "red" : "none"
    };
  }

  function keyed(source) {
    if (source instanceof Map) return source;
    return new Map(Object.entries(source || {}));
  }

  function applySurveyReviewVisuals({ layers = [], reviews, locks, issues, focusPending = false } = {}) {
    const reviewMap = keyed(reviews);
    const lockMap = keyed(locks);
    const issueMap = keyed(issues);
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
          focusPending
        });
        feature.set?.("surveyReviewVisual", state, true);
      }
      layer?.changed?.();
    }
  }

  return { buildSurveyOverlayState, applySurveyReviewVisuals };
});
