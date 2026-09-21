(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CesiumGroundPickerModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function pickGroundDegrees(options) {
    const { Cesium, viewer, screenPosition } = options || {};
    if (!Cesium || !viewer?.scene || !screenPosition) return null;
    let cartesian = null;
    if (!options?.skipDepth && viewer.scene.pickPositionSupported && typeof viewer.scene.pickPosition === "function") {
      try { cartesian = viewer.scene.pickPosition(screenPosition); } catch (_error) { cartesian = null; }
    }
    if (!cartesian) {
      const ray = viewer.camera?.getPickRay?.(screenPosition);
      if (ray) cartesian = viewer.scene.globe?.pick?.(ray, viewer.scene) || null;
    }
    if (!cartesian) return null;
    const position = Cesium.Cartographic.fromCartesian(cartesian);
    if (!position) return null;
    return [
      Cesium.Math.toDegrees(position.longitude),
      Cesium.Math.toDegrees(position.latitude),
      Number.isFinite(position.height) ? position.height : 0
    ];
  }

  return { pickGroundDegrees };
});
