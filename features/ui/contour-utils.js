(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ContourUtilsModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const CONTOUR_VALUE_FIELDS = [
    "elevation_m", "ELEVATION_M", "ELEV", "elev", "ELEVATION", "elevation",
    "VALUE", "value", "CONTOUR", "contour"
  ];

  function resolveContourValue(feature) {
    for (const field of CONTOUR_VALUE_FIELDS) {
      const value = feature?.get?.(field);
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
  }

  return { resolveContourValue };
});
