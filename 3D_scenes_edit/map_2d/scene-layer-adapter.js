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
    if (document?.selectionBoundary) {
      descriptors.push({
        objectId: 'selection-boundary',
        role: "geometry",
        kind: "boundary",
        category: "selection-boundary",
        geometry: document.selectionBoundary,
        layerId: null,
        styleToken: selected.has('selection-boundary') ? 'selected' : 'boundary',
        properties: {}
      });
    }
    for (const object of document?.objects || []) {
      const layer = layers.get(object.layerId);
      if (!layer || layer.visible === false) continue;
      const styleToken = viewState?.forcedStyleToken || (errors.has(object.id) ? "error" : selected.has(object.id) ? "selected" : layer.locked ? "locked" : "normal");
      descriptors.push({ objectId: object.id, role: "geometry", kind: object.kind, category: object.category, geometry: object.geometry, layerId: object.layerId, styleToken, headingDeg: object.transform?.headingDeg || 0, properties: object.properties || {} });
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
          headingDeg: object.transform?.headingDeg || 0,
          properties: object.properties || {}
        });
      }
    }
    return descriptors;
  }

  function createSceneLayerAdapter(options) {
    const ol = options?.ol;
    const map = options?.map;
    const projection = options?.projection || map?.getView?.()?.getProjection?.()?.getCode?.() || "EPSG:3857";
    const source = new ol.source.Vector();
    const styleCache = new Map();
    const assetMap = new Map();
    let renderedFeatures = [];

    function getValue(feature, key) {
      return typeof feature.get === "function" ? feature.get(key) : feature.values?.[key];
    }

    function fallbackIcon(category) {
      const labels = { bench: "椅", table: "桌", tree: "树", shrub: "灌", light: "灯", bin: "桶", sign: "牌", sculpture: "景", fitness: "健", pavilion: "亭", pergola: "廊", "bus-stop": "站", stall: "摊", stage: "台", "play-equipment": "乐" };
      const label = labels[category] || "物";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><path d="M32 64h192v128H32z" rx="22" fill="#dcefe7" stroke="#19785f" stroke-width="12"/><text x="128" y="151" text-anchor="middle" font-family="sans-serif" font-size="92" font-weight="700" fill="#145c4b">${label}</text></svg>`;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    function makeStyle(token, role, kind, category, assetRef, headingDeg) {
      if (!ol.style) return undefined;
      if (role === "footprint" && !["selected", "error", "compareA", "compareB"].includes(token)) return null;
      const asset = assetMap.get(assetRef);
      const iconUrl = (kind === "asset" || kind === "structure") && role === "geometry"
        ? (asset?.topViewUrl || fallbackIcon(category))
        : null;
      const key = `${token}:${role}:${kind}:${category || ""}:${assetRef || ""}:${iconUrl || ""}:${Number(headingDeg) || 0}`;
      if (styleCache.has(key)) return styleCache.get(key);
      const colors = {
        normal: ["rgba(42, 141, 114, 0.24)", "#238d72"],
        selected: ["rgba(255, 184, 77, 0.3)", "#ff9f1c"],
        locked: ["rgba(110, 118, 129, 0.15)", "#737b85"],
        error: ["rgba(214, 64, 69, 0.22)", "#d64045"],
        compareA: ["rgba(65, 105, 161, 0.18)", "#4169a1"],
        compareB: ["rgba(182, 70, 150, 0.16)", "#b64696"],
        boundary: ["rgba(25, 211, 255, 0.08)", "#19d3ff"]
      };
      const [fill, stroke] = colors[token] || colors.normal;
      const strokeWidth = kind === "line" ? (token === "selected" ? 5 : 4) : kind === "boundary" ? 3 : (token === "selected" ? 3 : 2);
      const style = new ol.style.Style({
        fill: new ol.style.Fill({ color: fill }),
        stroke: new ol.style.Stroke({ color: stroke, width: strokeWidth }),
        image: iconUrl && ol.style.Icon
          ? new ol.style.Icon({ src: iconUrl, rotation: (Number(headingDeg) || 0) * Math.PI / 180, rotateWithView: true, scale: token === "selected" ? .22 : .19, anchor: [.5, .5], crossOrigin: "anonymous" })
          : new ol.style.Circle({ radius: token === "selected" ? 8 : 7, fill: new ol.style.Fill({ color: stroke }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) })
      });
      styleCache.set(key, style);
      return style;
    }

    function roadStyle(feature,resolution) {
      const token=getValue(feature,'sceneStyleToken'),selected=token==='selected';
      const coordinate=feature.getGeometry().getFirstCoordinate?.()||[0,0];
      const metresPerPixel=ol.proj?.getPointResolution?.(projection,resolution,coordinate,'m')||resolution||1;
      const width=Math.max(1,Math.min(800,Math.round((Number(getValue(feature,'sceneWidthM'))||4)/metresPerPixel*10)/10));
      const key=`road:${token}:${width}`;if(styleCache.has(key))return styleCache.get(key);
      const fill=token==='compareA'?'rgba(65,105,161,.5)':token==='compareB'?'rgba(182,70,150,.5)':token==='error'?'rgba(214,64,69,.7)':token==='locked'?'rgba(110,118,129,.5)':selected?'rgba(33,150,243,.8)':'rgba(79,143,202,.52)';
      const styles=[new ol.style.Style({stroke:new ol.style.Stroke({color:fill,width})}),new ol.style.Style({stroke:new ol.style.Stroke({color:selected?'#ffe082':'#1f5f9e',width:selected?4:1.4})})];
      if(selected&&ol.geom.MultiPoint)styles.push(new ol.style.Style({geometry:f=>new ol.geom.MultiPoint(f.getGeometry().getCoordinates()),image:new ol.style.Circle({radius:5,fill:new ol.style.Fill({color:'#fff'}),stroke:new ol.style.Stroke({color:'#1565c0',width:2})})}));
      styleCache.set(key,styles);return styles;
    }

    const layer = new ol.layer.Vector({
      source,
      zIndex: Number(options?.zIndex) || 1200,
      properties: { sceneEditOverlay: true },
      style: (feature,resolution) => getValue(feature,'sceneKind')==='line'&&getValue(feature,'sceneCategory')==='path'&&ol.style ? roadStyle(feature,resolution) : makeStyle(
        getValue(feature, "sceneStyleToken"), getValue(feature, "sceneRole"), getValue(feature, "sceneKind"),
        getValue(feature, "sceneCategory"), getValue(feature, "sceneAssetRef"), getValue(feature, "sceneHeadingDeg")
      )
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

    function makeFeature(descriptor,existing) {
      const feature = existing?.setGeometry ? existing : new ol.Feature({ geometry: makeGeometry(descriptor.geometry) });
      if(feature===existing)feature.setGeometry(makeGeometry(descriptor.geometry));
      feature.setProperties({
        sceneObjectId: descriptor.objectId,
        sceneRole: descriptor.role,
        sceneKind: descriptor.kind,
        sceneCategory: descriptor.category,
        sceneAssetRef: descriptor.properties?.assetRef || null,
        sceneHeadingDeg: Number(descriptor.properties?.headingDeg ?? descriptor.headingDeg) || 0,
        sceneWidthM: Number(descriptor.properties?.widthM) || 4,
        sceneLayerId: descriptor.layerId,
        sceneStyleToken: descriptor.styleToken,
        sceneBaseStyleToken: descriptor.kind === 'boundary' ? 'boundary' : descriptor.styleToken === "locked" ? "locked" : "normal"
      });
      return feature;
    }

    return {
      mount() {
        if (!mounted) { map.addLayer(layer); mounted = true; }
        return layer;
      },
      render(document, viewState) {
        const existing=new Map(renderedFeatures.map(feature=>[`${getValue(feature,'sceneObjectId')}:${getValue(feature,'sceneRole')}`,feature]));
        const features = buildFeatureDescriptors(document, { ...(viewState || {}), forcedStyleToken: options?.forcedStyleToken || viewState?.forcedStyleToken }).map(descriptor=>makeFeature(descriptor,existing.get(`${descriptor.objectId}:${descriptor.role}`)));
        source.clear();
        source.addFeatures(features);
        renderedFeatures = features;
        return features;
      },
      setAssets(assets) {
        assetMap.clear();
        for (const asset of assets || []) if (asset?.id) assetMap.set(asset.id, asset);
        styleCache.clear();
        layer.changed?.();
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
