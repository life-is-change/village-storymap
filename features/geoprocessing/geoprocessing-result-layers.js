(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GeoprocessingResultLayersModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const ARTIFACT_LAYER_MAP = Object.freeze({
    buildings: "building",
    roads: "road",
    waterways: "water",
    water_areas: "water",
    contours: "contours"
  });
  const LAYER_KEYS = Object.freeze(["building", "road", "water", "contours"]);

  function mapArtifactType(artifactType) {
    return ARTIFACT_LAYER_MAP[String(artifactType || "")] || null;
  }

  function groupArtifacts(artifacts = []) {
    const grouped = Object.fromEntries(LAYER_KEYS.map((key) => [key, []]));
    (Array.isArray(artifacts) ? artifacts : []).forEach((artifact) => {
      const layerKey = mapArtifactType(artifact?.artifact_type);
      if (layerKey) grouped[layerKey].push(artifact);
    });
    return grouped;
  }

  function createResultLayerPreview({ map, ol, fetchJson }) {
    if (!map || !ol || typeof fetchJson !== "function") throw new Error("RESULT_PREVIEW_DEPENDENCIES_REQUIRED");
    const VectorSource = ol.VectorSource || ol.source?.Vector;
    const VectorLayer = ol.VectorLayer || ol.layer?.Vector;
    const GeoJSON = ol.GeoJSON || ol.format?.GeoJSON;
    const sources = {};
    const layers = {};
    let previewActive = false;
    LAYER_KEYS.forEach((layerKey, index) => {
      const source = new VectorSource();
      const layer = new VectorLayer({ source, zIndex: 1100 + index });
      sources[layerKey] = source;
      layers[layerKey] = layer;
      map.addLayer(layer);
    });

    function clear() {
      LAYER_KEYS.forEach((key) => sources[key].clear());
      previewActive = false;
    }

    return {
      async show(artifacts) {
        clear();
        const projection = map.getView?.().getProjection?.();
        await Promise.all((Array.isArray(artifacts) ? artifacts : []).map(async (artifact) => {
          const layerKey = mapArtifactType(artifact?.artifact_type);
          if (!layerKey) return;
          const geojson = await fetchJson(artifact);
          const features = new GeoJSON().readFeatures(geojson, {
            dataProjection: "EPSG:4326",
            featureProjection: projection
          });
          sources[layerKey].addFeatures(features);
        }));
        previewActive = true;
      },
      clear,
      hasPreview() {
        return previewActive;
      },
      syncVisibleLayers(selectedLayerKeys = []) {
        const selected = new Set(Array.isArray(selectedLayerKeys) ? selectedLayerKeys : []);
        const showFigureGround = selected.has("figureGround");
        LAYER_KEYS.forEach((layerKey) => {
          layers[layerKey]?.setVisible?.(showFigureGround || selected.has(layerKey));
        });
      },
      setVisible(layerKey, visible) {
        layers[layerKey]?.setVisible?.(Boolean(visible));
      },
      destroy() {
        clear();
        LAYER_KEYS.forEach((key) => map.removeLayer(layers[key]));
      }
    };
  }

  return { ARTIFACT_LAYER_MAP, LAYER_KEYS, mapArtifactType, groupArtifacts, createResultLayerPreview };
});
