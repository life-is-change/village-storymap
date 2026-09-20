(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../domain/geometry-rules") : root.SceneGeometryRulesModule
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneLayerAdapterModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (GeometryRules) {
  function buildFeatureDescriptors(document, viewState) {
    const layers = new Map((document?.layers || []).map((layer) => [layer.id, layer]));
    const selected = new Set(viewState?.selectedIds || []);
    const errors = new Set(viewState?.errorIds || []);
    const descriptors = [];
    for (const object of document?.objects || []) {
      const layer = layers.get(object.layerId);
      if (!layer || layer.visible === false) continue;
      const styleToken = viewState?.forcedStyleToken || (errors.has(object.id) ? "error" : selected.has(object.id) ? "selected" : layer.locked ? "locked" : "normal");
      descriptors.push({ objectId: object.id, role: "geometry", kind: object.kind, category: object.category, geometry: object.geometry, layerId: object.layerId, styleToken, properties: object.properties || {} });
      if ((object.kind === "asset" || object.kind === "structure") && Array.isArray(object.properties?.footprintM)) {
        const scale = object.transform?.scale || [1, 1, 1];
        descriptors.push({
          objectId: object.id,
          role: "footprint",
          kind: object.kind,
          category: object.category,
          geometry: GeometryRules.rotatedFootprint(object.geometry.coordinates, {
            widthM: object.properties.footprintM[0] * scale[0],
            depthM: object.properties.footprintM[1] * scale[1]
          }, object.transform?.headingDeg || 0),
          layerId: object.layerId,
          styleToken,
          properties: object.properties || {}
        });
      }
    }
    return descriptors;
  }

  function createSceneLayerAdapter(options) {
    const ol = options?.ol;
    const map = options?.map;
    const projection = options?.projection || "EPSG:3857";
    const source = new ol.source.Vector();
    const styleCache = new Map();
    let renderedFeatures = [];

    function getValue(feature, key) {
      return typeof feature.get === "function" ? feature.get(key) : feature.values?.[key];
    }

    function makeStyle(token, role) {
      if (!ol.style) return undefined;
      const key = `${token}:${role}`;
      if (styleCache.has(key)) return styleCache.get(key);
      const colors = {
        normal: ["rgba(42, 141, 114, 0.24)", "#238d72"],
        selected: ["rgba(255, 184, 77, 0.3)", "#ff9f1c"],
        locked: ["rgba(110, 118, 129, 0.15)", "#737b85"],
        error: ["rgba(214, 64, 69, 0.22)", "#d64045"],
        compareA: ["rgba(65, 105, 161, 0.18)", "#4169a1"],
        compareB: ["rgba(182, 70, 150, 0.16)", "#b64696"]
      };
      const [fill, stroke] = colors[token] || colors.normal;
      const style = new ol.style.Style({
        fill: new ol.style.Fill({ color: role === "footprint" ? "rgba(0,0,0,0.02)" : fill }),
        stroke: new ol.style.Stroke({ color: stroke, width: token === "selected" ? 3 : 2, lineDash: role === "footprint" ? [5, 4] : undefined }),
        image: new ol.style.Circle({ radius: token === "selected" ? 7 : 6, fill: new ol.style.Fill({ color: stroke }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) })
      });
      styleCache.set(key, style);
      return style;
    }

    const layer = new ol.layer.Vector({
      source,
      zIndex: Number(options?.zIndex) || 900,
      properties: { sceneEditOverlay: true },
      style: (feature) => makeStyle(getValue(feature, "sceneStyleToken"), getValue(feature, "sceneRole"))
    });
    let mounted = false;

    function projectPosition(position) {
      if (projection === "EPSG:3857" && ol.proj?.fromLonLat) return ol.proj.fromLonLat(position);
      if (ol.proj?.transform) return ol.proj.transform(position, "EPSG:4326", projection);
      return position.slice();
    }

    function projectCoordinates(value) {
      if (Array.isArray(value) && typeof value[0] === "number") return projectPosition(value);
      return Array.isArray(value) ? value.map(projectCoordinates) : value;
    }

    function makeGeometry(geometry) {
      const coordinates = projectCoordinates(geometry.coordinates);
      if (geometry.type === "Point") return new ol.geom.Point(coordinates);
      if (geometry.type === "LineString") return new ol.geom.LineString(coordinates);
      if (geometry.type === "Polygon") return new ol.geom.Polygon(coordinates);
      throw new Error(`Unsupported scene geometry: ${geometry.type}`);
    }

    function makeFeature(descriptor) {
      const feature = new ol.Feature({ geometry: makeGeometry(descriptor.geometry) });
      feature.setProperties({
        sceneObjectId: descriptor.objectId,
        sceneRole: descriptor.role,
        sceneKind: descriptor.kind,
        sceneCategory: descriptor.category,
        sceneLayerId: descriptor.layerId,
        sceneStyleToken: descriptor.styleToken,
        sceneBaseStyleToken: descriptor.styleToken === "locked" ? "locked" : "normal"
      });
      return feature;
    }

    return {
      mount() {
        if (!mounted) { map.addLayer(layer); mounted = true; }
        return layer;
      },
      render(document, viewState) {
        const features = buildFeatureDescriptors(document, { ...(viewState || {}), forcedStyleToken: options?.forcedStyleToken || viewState?.forcedStyleToken }).map(makeFeature);
        source.clear();
        source.addFeatures(features);
        renderedFeatures = features;
        return features;
      },
      updateSelection(ids, viewState) {
        const selected = new Set(ids || []);
        const errors = new Set(viewState?.errorIds || []);
        for (const feature of renderedFeatures) {
          const id = getValue(feature, "sceneObjectId");
          const token = errors.has(id) ? "error" : selected.has(id) ? "selected" : getValue(feature, "sceneBaseStyleToken") || "normal";
          feature.setProperties?.({ sceneStyleToken: token });
        }
        layer.changed?.();
        return selected.size;
      },
      hitTest(pixel) {
        return map.forEachFeatureAtPixel(pixel, (feature) => getValue(feature, "sceneObjectId"), { layerFilter: (candidate) => candidate === layer }) || null;
      },
      fitBoundary(boundary) {
        if (!boundary) return;
        const geometry = makeGeometry(boundary);
        map.getView().fit(geometry.getExtent(), { padding: [48, 48, 48, 48], maxZoom: 20, duration: 300 });
      },
      dispose() {
        if (mounted) map.removeLayer(layer);
        mounted = false;
        source.clear();
        renderedFeatures = [];
      },
      getLayer: () => layer,
      getSource: () => source
    };
  }

  return { buildFeatureDescriptors, createSceneLayerAdapter };
});
