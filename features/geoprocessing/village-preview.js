(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VillagePreviewModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_CATALOG_URL = "assets/villages/catalog.json";

  function findVillagePreview(catalog, villageId) {
    return (Array.isArray(catalog?.villages) ? catalog.villages : [])
      .find((entry) => String(entry?.id) === String(villageId)) || null;
  }

  function validateEntry(entry) {
    const bounds = entry?.bounds;
    if (!entry?.preview_path || !Array.isArray(bounds) || bounds.length !== 4
        || bounds.some((value) => !Number.isFinite(Number(value)))) {
      throw new Error("VILLAGE_PREVIEW_INVALID");
    }
    return bounds.map(Number);
  }

  function createVillagePreviewController({ map, ol, fetchJson, catalogUrl = DEFAULT_CATALOG_URL }) {
    if (!map || !ol?.ImageLayer || !ol?.ImageStatic) throw new Error("PREVIEW_MAP_REQUIRED");
    const loadJson = fetchJson || (async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`VILLAGE_PREVIEW_CATALOG_${response.status}`);
      return response.json();
    });
    let layer = null;

    return {
      async show(villageId) {
        const catalog = await loadJson(catalogUrl);
        const entry = findVillagePreview(catalog, villageId);
        if (!entry) throw new Error("VILLAGE_PREVIEW_NOT_FOUND");
        const bounds = validateEntry(entry);
        if (layer) map.removeLayer(layer);
        layer = new ol.ImageLayer({
          source: new ol.ImageStatic({
            url: entry.preview_path,
            imageExtent: bounds,
            projection: "EPSG:4326",
            crossOrigin: "anonymous"
          }),
          opacity: 1,
          visible: true
        });
        layer.setZIndex?.(3);
        map.addLayer(layer);
        map.getView()?.fit?.(bounds, { size: map.getSize?.(), padding: [30, 30, 30, 30], maxZoom: 20 });
        return entry;
      },
      clear() {
        if (layer) map.removeLayer(layer);
        layer = null;
      },
      destroy() { this.clear(); }
    };
  }

  return { DEFAULT_CATALOG_URL, findVillagePreview, createVillagePreviewController };
});
