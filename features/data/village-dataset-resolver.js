(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VillageDatasetResolverModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SUPPORTED_TYPES = new Set([
    "building", "road", "cropland", "openSpace", "water", "contours", "elevationBands", "imagery"
  ]);
  const TYPE_ALIASES = Object.freeze({
    buildings: "building",
    roads: "road"
  });
  const FEATURE_CODE_FIELDS = Object.freeze({
    building: ["房屋编码", "建筑编码", "编码", "CODE", "Code", "code", "ID", "id"],
    road: ["道路编码", "编码", "osm_id", "CODE", "Code", "code", "ID", "id", "NAME", "Name", "name"],
    water: ["水体编码", "水系编码", "编码", "osm_id", "CODE", "Code", "code", "ID", "id", "NAME", "Name", "name"],
    contours: ["id", "ID", "elev", "ELEV", "Contour", "CONTOUR"]
  });

  function required(value, code) {
    const normalized = String(value ?? "").trim();
    if (!normalized) throw new Error(code);
    return normalized;
  }

  function requireWriteContext(context = {}) {
    return {
      teachingProjectId: required(context.teachingProjectId, "PROJECT_CONTEXT_REQUIRED"),
      villageId: required(context.villageId, "VILLAGE_CONTEXT_REQUIRED"),
      spaceId: required(context.spaceId, "SPACE_CONTEXT_REQUIRED")
    };
  }

  function extentFromBoundary(boundary) {
    const points = [];
    (function walk(value) {
      if (Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
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

  function resolveEntry(entry, signedUrls) {
    const rawType = String(entry?.type || "");
    const type = TYPE_ALIASES[rawType] || rawType;
    if (!SUPPORTED_TYPES.has(type)) throw new Error("UNSUPPORTED_LAYER_TYPE");
    if (entry.url || entry.signedUrl) throw new Error("UNTRUSTED_RESOURCE_URL");
    const path = String(entry.path || entry.storagePath || entry.storage_path || "").trim();
    if (!path) return [type, null];
    const url = path ? signedUrls?.[path] : null;
    if (!url) throw new Error("SIGNED_RESOURCE_REQUIRED");
    return [type, url];
  }

  function normalizeFeatureCollection(data, type) {
    const features = Array.isArray(data?.features) ? data.features : Array.isArray(data) ? data : [];
    const codeFields = FEATURE_CODE_FIELDS[type] || ["CODE", "Code", "code", "ID", "id"];
    const prefix = String(type || "feature").replace(/[^a-z0-9]+/gi, "_").toUpperCase();
    return {
      ...(Array.isArray(data) ? {} : (data || {})),
      type: "FeatureCollection",
      features: features.map((feature, index) => {
        const properties = { ...(feature?.properties || {}) };
        const existing = codeFields.map((field) => properties[field]).find((value) => String(value ?? "").trim());
        if (!existing) {
          properties.id = `AUTO_${prefix}_${String(index + 1).padStart(6, "0")}`;
        } else if (!String(properties.id ?? "").trim()) {
          properties.id = String(existing);
        }
        return { ...(feature || {}), properties };
      })
    };
  }

  function resolveBasemapGeoref(resources = {}, fallback = {}) {
    const extent = Array.isArray(resources.initialExtent) ? resources.initialExtent.map(Number) : [];
    if (resources.storageBacked && resources.imagery && extent.length === 4
        && extent.every(Number.isFinite) && extent[0] < extent[2] && extent[1] < extent[3]) {
      return {
        imageUrl: resources.imagery,
        minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3],
        crs: "EPSG:4326"
      };
    }
    return { ...fallback };
  }

  function entryPath(entry = {}) {
    return String(entry.path || entry.storagePath || entry.storage_path || "").trim();
  }

  function collectStoragePaths(dataset = {}) {
    const manifest = dataset.layerManifest?.layers || dataset.layer_manifest?.layers
      || dataset.layerManifest || dataset.layer_manifest || [];
    const layers = Array.isArray(manifest) ? manifest : [];
    const imagery = dataset.imageryConfig || dataset.imagery_config;
    return Array.from(new Set([
      ...layers.map(entryPath),
      entryPath(imagery)
    ].filter(Boolean)));
  }

  async function createSignedUrlMap(supabaseClient, dataset, options = {}) {
    if (!supabaseClient?.storage?.from) throw new Error("DATASET_STORAGE_REQUIRED");
    const bucket = String(options.bucket || "village-datasets");
    const expiresIn = Number(options.expiresIn || 900);
    const storage = supabaseClient.storage.from(bucket);
    const entries = await Promise.all(collectStoragePaths(dataset).map(async (path) => {
      const { data, error } = await storage.createSignedUrl(path, expiresIn);
      if (error) throw error;
      const url = data?.signedUrl || data?.signedURL;
      if (!url) throw new Error("SIGNED_RESOURCE_REQUIRED");
      return [path, url];
    }));
    return Object.fromEntries(entries);
  }

  function resolveDatasetResources({ village = {}, dataset = {}, signedUrls = {} } = {}) {
    const boundary = village.boundary;
    const manifest = dataset.layerManifest?.layers || dataset.layer_manifest?.layers
      || dataset.layerManifest || dataset.layer_manifest || [];
    if (!Array.isArray(manifest)) throw new Error("LAYER_MANIFEST_INVALID");
    const layers = {};
    let imagery = null;
    manifest.forEach((entry) => {
      const [type, url] = resolveEntry(entry, signedUrls);
      if (!url) return;
      if (type === "imagery") imagery = url;
      else layers[type] = url;
    });
    const imageryConfig = dataset.imageryConfig || dataset.imagery_config;
    if (imageryConfig && entryPath(imageryConfig)) {
      const [, url] = resolveEntry({ ...imageryConfig, type: "imagery" }, signedUrls);
      imagery = url;
    }
    return {
      boundary,
      initialExtent: extentFromBoundary(boundary),
      imagery,
      layers,
      storageBacked: collectStoragePaths(dataset).length > 0,
      realityModel: village.realityModel || null
    };
  }

  return {
    SUPPORTED_TYPES,
    collectStoragePaths,
    createSignedUrlMap,
    extentFromBoundary,
    normalizeFeatureCollection,
    requireWriteContext,
    resolveBasemapGeoref,
    resolveDatasetResources
  };
});
