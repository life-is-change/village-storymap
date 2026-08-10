(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EffectiveBuildingFeaturesModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalizeCode(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function rowToFeature(row) {
    return {
      type: "Feature",
      properties: {
        ...(row?.props || {}),
        code: row?.object_code,
        "房屋编码": row?.object_code,
        "房屋名称": row?.object_name || row?.object_code
      },
      geometry: row?.geom
    };
  }

  function resolveEffectiveBuildingFeatureCollection({
    baseFeatures = [], dbRows = [], personalRows = [], isPersonalSpace = false,
    getBaseCode = (feature) => feature?.properties?.code
  } = {}) {
    if (isPersonalSpace) {
      return {
        type: "FeatureCollection",
        features: (personalRows || []).filter((row) => !row?.is_deleted && row?.geom).map(rowToFeature)
      };
    }

    const blocked = new Set((dbRows || []).map((row) => normalizeCode(row?.object_code)).filter(Boolean));
    const features = (baseFeatures || []).filter((feature) => {
      const code = normalizeCode(getBaseCode(feature));
      return code && !blocked.has(code);
    });
    (dbRows || []).forEach((row) => {
      if (!row?.is_deleted && row?.geom) features.push(rowToFeature(row));
    });
    return { type: "FeatureCollection", features };
  }

  function shouldReloadBuildingSpace(loadedSpaceId, currentSpaceId, hasDataSource) {
    return !hasDataSource || String(loadedSpaceId || "") !== String(currentSpaceId || "");
  }

  function getFootprintScaleFromExpected(footprint, expectedLength, expectedWidth) {
    const sizeX = Number(footprint?.sizeX);
    const sizeY = Number(footprint?.sizeY);
    const originalLong = Number(expectedLength);
    const originalShort = Number(expectedWidth);
    if (![sizeX, sizeY, originalLong, originalShort].every((value) => Number.isFinite(value) && value > 0)) {
      return { x: 1, y: 1 };
    }
    const directScore = Math.abs(Math.log((sizeX / sizeY) / (originalLong / originalShort)));
    const swappedScore = Math.abs(Math.log((sizeY / sizeX) / (originalLong / originalShort)));
    const currentX = swappedScore < directScore ? sizeY : sizeX;
    const currentY = swappedScore < directScore ? sizeX : sizeY;
    const clamp = (value) => Math.max(0.25, Math.min(4, value));
    return { x: clamp(currentX / originalLong), y: clamp(currentY / originalShort) };
  }

  function createSerialTaskRunner(task) {
    let pending = Promise.resolve();
    return (...args) => {
      const next = pending.catch(() => undefined).then(() => task(...args));
      pending = next;
      return next;
    };
  }

  return {
    createSerialTaskRunner,
    getFootprintScaleFromExpected,
    resolveEffectiveBuildingFeatureCollection,
    shouldReloadBuildingSpace
  };
});
