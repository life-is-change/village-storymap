(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyReviewModelModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SURVEY_LAYERS = Object.freeze(["building", "road", "water"]);
  const REVIEWED_V0_STATUSES = new Set(["confirmed_unchanged", "modified", "deleted"]);
  const DOWNSTREAM_READY_STATUSES = new Set(["confirmed_unchanged", "modified", "added"]);

  function normalize(value) {
    return String(value ?? "").trim();
  }

  function normalizeReviewRow(row = {}) {
    const revision = Number(row.geometry_revision ?? row.geometryRevision ?? 0);
    return {
      layerKey: normalize(row.layer_key ?? row.layerKey),
      objectCode: normalize(row.object_code ?? row.objectCode),
      isV0Baseline: Boolean(row.is_v0_baseline ?? row.isV0Baseline),
      geometryStatus: normalize(row.geometry_status ?? row.geometryStatus) || "pending",
      geometryRevision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      isDeleted: Boolean(row.is_deleted ?? row.isDeleted),
      latestModifiedBy: normalize(row.latest_modified_by ?? row.latestModifiedBy),
      latestModifiedAt: normalize(row.latest_modified_at ?? row.latestModifiedAt)
    };
  }

  function isGeometryReviewed(row) {
    const review = normalizeReviewRow(row);
    return review.isV0Baseline
      ? REVIEWED_V0_STATUSES.has(review.geometryStatus)
      : review.geometryStatus === "added";
  }

  function canUseDownstreamActions(row) {
    const review = normalizeReviewRow(row);
    return !review.isDeleted && DOWNSTREAM_READY_STATUSES.has(review.geometryStatus);
  }

  function buildSurveyProgress(rows = []) {
    const normalized = (Array.isArray(rows) ? rows : [])
      .map(normalizeReviewRow)
      .filter((row) => SURVEY_LAYERS.includes(row.layerKey));
    const baseline = normalized.filter((row) => row.isV0Baseline);
    const additions = normalized.filter((row) => !row.isV0Baseline && row.geometryStatus === "added");
    const deleted = baseline.filter((row) => row.geometryStatus === "deleted" || row.isDeleted).length;
    const removedAdditions = additions.filter((row) => row.isDeleted).length;

    return {
      baselineTotal: baseline.length,
      reviewedBaseline: baseline.filter((row) => REVIEWED_V0_STATUSES.has(row.geometryStatus)).length,
      confirmedUnchanged: baseline.filter((row) => row.geometryStatus === "confirmed_unchanged").length,
      modified: baseline.filter((row) => row.geometryStatus === "modified").length,
      deleted,
      added: additions.length,
      removedAdditions,
      currentActive: baseline.length - deleted + additions.length - removedAdditions,
      byLayer: Object.fromEntries(SURVEY_LAYERS.map((layerKey) => {
        const layerRows = baseline.filter((row) => row.layerKey === layerKey);
        return [layerKey, {
          baselineTotal: layerRows.length,
          reviewedBaseline: layerRows.filter((row) => REVIEWED_V0_STATUSES.has(row.geometryStatus)).length
        }];
      }))
    };
  }

  function getSurveyFeatureStyle(row, options = {}) {
    const review = normalizeReviewRow(row);
    const pending = review.geometryStatus === "pending";
    const focusPending = options.focusPending === true;
    return {
      opacity: focusPending && !pending ? 0.18 : 1,
      emphasis: focusPending && pending ? "pending" : "none",
      hidden: false
    };
  }

  return {
    SURVEY_LAYERS,
    normalizeReviewRow,
    isGeometryReviewed,
    canUseDownstreamActions,
    buildSurveyProgress,
    getSurveyFeatureStyle
  };
});
