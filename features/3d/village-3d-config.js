(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Village3DConfigModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const HEIGHT_FIELDS = ["建筑高度", "房屋高度", "height", "HEIGHT", "Height", "H", "h"];
  const FLOOR_FIELDS = ["floors", "floor", "FLOORS", "楼层", "层数", "建筑层数"];

  function finitePositive(value) {
    if (typeof value === "string") value = value.replace(/[,，]/g, "").replace(/米|m$/i, "").trim();
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? number : null;
  }

  function resolveBuildingHeight(props = {}, fallback = 9) {
    for (const field of HEIGHT_FIELDS) {
      const height = finitePositive(props?.[field]);
      if (height !== null) return height;
    }
    for (const field of FLOOR_FIELDS) {
      const floors = finitePositive(props?.[field]);
      if (floors !== null) return floors * 3;
    }
    return finitePositive(fallback) || 9;
  }

  function extentFromBoundary(boundary) {
    const points = [];
    (function walk(value) {
      if (Array.isArray(value) && value.length >= 2
          && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        points.push([Number(value[0]), Number(value[1])]);
      } else if (Array.isArray(value)) value.forEach(walk);
    })(boundary?.coordinates);
    if (!points.length) throw new Error("VILLAGE_BOUNDARY_REQUIRED");
    return [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1]))
    ];
  }

  function resolveVillageCamera(boundary, options = {}) {
    const extent = Array.isArray(boundary) ? boundary.map(Number) : extentFromBoundary(boundary);
    if (extent.length !== 4 || extent.some((value) => !Number.isFinite(value))) {
      throw new Error("VILLAGE_BOUNDARY_REQUIRED");
    }
    const centerLongitude = (extent[0] + extent[2]) / 2;
    const centerLatitude = (extent[1] + extent[3]) / 2;
    const widthMeters = Math.abs(extent[2] - extent[0]) * 111320 * Math.max(0.2, Math.cos(centerLatitude * Math.PI / 180));
    const heightMeters = Math.abs(extent[3] - extent[1]) * 110540;
    return {
      centerLongitude,
      centerLatitude,
      range: Math.max(Number(options.minimumRange || 300), Math.hypot(widthMeters, heightMeters) * 0.85),
      headingDegrees: Number(options.headingDegrees ?? 10),
      pitchDegrees: Number(options.pitchDegrees ?? -52)
    };
  }

  function buildMain3dResources(resources = {}) {
    return {
      buildingUrl: resources.layers?.building || null,
      roadUrl: resources.layers?.road || null,
      imageryUrl: resources.imagery || null,
      initialExtent: Array.isArray(resources.initialExtent) ? resources.initialExtent.map(Number) : null
    };
  }

  function normalizeRealityConfig(resource) {
    if (!resource) {
      return { enabled: false, ionAssetId: 0, title: "", terrainEnabled: true, heightOffset: 0, revision: "" };
    }
    const ionAssetId = Number(resource.ionAssetId ?? resource.ion_asset_id);
    const enabled = resource.enabled !== false && Number.isSafeInteger(ionAssetId) && ionAssetId > 0;
    return {
      enabled,
      ionAssetId: enabled ? ionAssetId : 0,
      title: enabled ? String(resource.title || "村庄实景模型").trim() : "",
      terrainEnabled: (resource.terrainEnabled ?? resource.terrain_enabled) !== false,
      heightOffset: Number.isFinite(Number(resource.heightOffset ?? resource.height_offset))
        ? Number(resource.heightOffset ?? resource.height_offset) : 0,
      revision: String(resource.revision || resource.updated_at || resource.published_at || resource.id || "")
    };
  }

  function hasCompleteVillageContext(context = {}) {
    return Boolean(String(context.teachingProjectId || "").trim() && String(context.villageId || "").trim());
  }

  function resolveRealityConfigForContext(context) {
    const raw = context?.village?.realityModel || context?.datasetResources?.realityModel || null;
    if (raw) return normalizeRealityConfig(raw);
    const villageId = String(context?.villageId || "").trim().toLowerCase();
    const isLegacyOrMibu = !villageId
      || villageId === "mibu"
      || villageId === "00000000-0000-4000-8000-000000000001";
    return normalizeRealityConfig(isLegacyOrMibu ? {
      ionAssetId: 5133927,
      title: "米埗村实景模型",
      terrainEnabled: true,
      heightOffset: 0,
      revision: "legacy-mibu-5133927"
    } : null);
  }

  return {
    HEIGHT_FIELDS,
    FLOOR_FIELDS,
    resolveBuildingHeight,
    resolveVillageCamera,
    buildMain3dResources,
    normalizeRealityConfig,
    resolveRealityConfigForContext,
    hasCompleteVillageContext
  };
});
