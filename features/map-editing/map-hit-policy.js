(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MapHitPolicyModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function pickFeatureAtPixel(planMap, pixel, isNonInteractiveLayerKey, deleteLayerKey = "") {
    let clicked = null;
    planMap.forEachFeatureAtPixel(pixel, (feature) => {
      const layerKey = feature?.get?.("layerKey");
      if (deleteLayerKey && layerKey !== deleteLayerKey) return false;
      if (isNonInteractiveLayerKey(layerKey) && layerKey !== deleteLayerKey) return false;
      clicked = feature;
      return true;
    });
    return clicked;
  }

  return { pickFeatureAtPixel };
});
