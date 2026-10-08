(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PersonalEditVersionModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function withFeatureVersion(change, feature) {
    const versionId = feature?.get?.("personalLayerVersionId");
    return versionId ? { ...change, layerVersionId: String(versionId) } : change;
  }

  function assertChangesMatchSelections(changes, selections) {
    const currentByLayer = new Map((selections || []).map((selection) => [
      String(selection?.layer_key || ""),
      String(selection?.current_version_id || "")
    ]));
    for (const change of (changes || [])) {
      if (change?.action === "delete" && !change?.layerVersionId) {
        throw new Error("PERSONAL_LAYER_VERSION_REQUIRED");
      }
      if (!change?.layerVersionId) continue;
      if (String(change.layerVersionId) !== currentByLayer.get(String(change.layerKey || ""))) {
        throw new Error("PERSONAL_LAYER_VERSION_STALE");
      }
    }
  }

  return { assertChangesMatchSelections, withFeatureVersion };
});
