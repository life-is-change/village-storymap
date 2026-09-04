(function (root, factory) {
  const webcrypto = typeof module === "object" && module.exports
    ? require("node:crypto").webcrypto
    : root.crypto;
  const api = factory(webcrypto);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VillagePackageModule = api;
})(typeof window !== "undefined" ? window : globalThis, function (webcrypto) {
  const SCHEMA_VERSION = "village-v0-package/1";
  const REQUIRED_FILES = [
    "manifest.json", "validation.json", "boundary.geojson", "imagery.webp",
    "buildings.geojson", "roads.geojson", "waterways.geojson",
    "water_areas.geojson", "water.geojson", "contours.geojson"
  ];
  const ALLOWED_LAYERS = new Set(["building", "road", "water", "contours"]);

  function codedError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function normalizePackageFiles(input) {
    const entries = Array.from(input || []).map((file) => {
      const raw = String(file.webkitRelativePath || file.name || "").replaceAll("\\", "/");
      const parts = raw.split("/").filter(Boolean);
      if (!parts.length || parts.includes("..") || raw.startsWith("/")) throw codedError("PACKAGE_PATH_INVALID");
      return { file, parts };
    });
    const rootName = entries.length && entries.every((item) => item.parts.length > 1 && item.parts[0] === entries[0].parts[0])
      ? entries[0].parts[0]
      : null;
    const files = new Map();
    entries.forEach(({ file, parts }) => {
      const relative = (rootName ? parts.slice(1) : parts).join("/");
      if (!relative || relative.includes("/") || files.has(relative)) throw codedError("PACKAGE_PATH_INVALID");
      files.set(relative, file);
    });
    return files;
  }

  async function sha256Hex(file) {
    if (!webcrypto?.subtle) throw codedError("PACKAGE_HASH_UNAVAILABLE");
    const digest = await webcrypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function validateManifest(manifest) {
    if (manifest?.schema_version !== SCHEMA_VERSION) throw codedError("PACKAGE_SCHEMA_UNSUPPORTED");
    const bounds = manifest?.village?.bounds;
    if (!manifest?.village?.name || !Array.isArray(bounds) || bounds.length !== 4
      || !bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
      throw codedError("PACKAGE_VILLAGE_INVALID");
    }
    if (!Array.isArray(manifest.files) || !Array.isArray(manifest.layers)) throw codedError("PACKAGE_MANIFEST_INVALID");
    const types = new Set(manifest.layers.map((item) => item?.type));
    if (![...ALLOWED_LAYERS].every((type) => types.has(type))) throw codedError("PACKAGE_LAYER_MISSING");
    const buildings = manifest.layers.find((item) => item?.type === "building");
    if (!Number.isFinite(Number(buildings?.featureCount)) || Number(buildings.featureCount) < 1) {
      throw codedError("BUILDINGS_REQUIRED");
    }
    return manifest;
  }

  async function validatePackageSelection(input) {
    const files = input instanceof Map ? input : normalizePackageFiles(input);
    for (const name of REQUIRED_FILES) if (!files.has(name)) throw codedError(`PACKAGE_FILE_MISSING: ${name}`);
    let manifest;
    try {
      manifest = JSON.parse(await files.get("manifest.json").text());
    } catch (_) {
      throw codedError("PACKAGE_MANIFEST_INVALID");
    }
    validateManifest(manifest);
    const declarations = new Map(manifest.files.map((item) => [item?.path, item]));
    for (const name of REQUIRED_FILES.filter((item) => !["manifest.json", "validation.json"].includes(item))) {
      const declaration = declarations.get(name);
      if (!declaration || !/^[a-f0-9]{64}$/i.test(String(declaration.sha256 || ""))) {
        throw codedError(`PACKAGE_HASH_MISSING: ${name}`);
      }
      if (await sha256Hex(files.get(name)) !== String(declaration.sha256).toLowerCase()) {
        throw codedError(`PACKAGE_HASH_MISMATCH: ${name}`);
      }
    }
    return {
      files,
      manifest,
      summary: {
        valid: true,
        fileCount: files.size,
        villageName: manifest.village.name,
        bounds: manifest.village.bounds,
        featureCounts: Object.fromEntries(manifest.layers.map((item) => [item.type, Number(item.featureCount || 0)]))
      }
    };
  }

  function safeSegment(value, code) {
    const segment = String(value || "").trim();
    if (!segment || !/^[a-zA-Z0-9_-]+$/.test(segment)) throw codedError(code);
    return segment;
  }

  async function uploadVillagePackage({ supabaseClient, villageId, selection, packageId, bucket = "village-datasets" }) {
    const village = safeSegment(villageId, "VILLAGE_REQUIRED");
    const packageName = safeSegment(packageId, "PACKAGE_ID_REQUIRED");
    if (!selection?.summary?.valid || !(selection.files instanceof Map)) throw codedError("PACKAGE_NOT_VALIDATED");
    const prefix = `${village}/${packageName}`;
    const storage = supabaseClient?.storage?.from?.(bucket);
    if (!storage?.upload) throw codedError("DATASET_STORAGE_REQUIRED");
    const uploaded = [];
    try {
      for (const [name, file] of selection.files) {
        const contentType = file.type || (name.endsWith(".geojson")
          ? "application/geo+json"
          : name.endsWith(".json") ? "application/json" : name.endsWith(".webp") ? "image/webp" : undefined);
        const path = `${prefix}/${name}`;
        const { error } = await storage.upload(path, file, { upsert: false, contentType });
        if (error) throw error;
        uploaded.push(path);
      }
    } catch (error) {
      if (uploaded.length && storage.remove) {
        try { await storage.remove(uploaded); } catch (_) { /* best-effort rollback */ }
      }
      throw error;
    }
    const toStorageEntry = (item) => ({
      ...item,
      path: `${prefix}/${item.path}`
    });
    return {
      villageId: village,
      versionLabel: packageName,
      imageryConfig: toStorageEntry(selection.manifest.imagery),
      layerManifest: { layers: selection.manifest.layers.map(toStorageEntry) },
      validationSummary: { ...selection.summary, packageId: packageName },
      status: "ready"
    };
  }

  return {
    REQUIRED_FILES,
    normalizePackageFiles,
    sha256Hex,
    uploadVillagePackage,
    validateManifest,
    validatePackageSelection
  };
});
