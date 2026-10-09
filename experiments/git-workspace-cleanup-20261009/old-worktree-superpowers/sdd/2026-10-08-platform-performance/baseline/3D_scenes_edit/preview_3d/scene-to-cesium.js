(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneToCesiumModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const radians = (degrees) => (Number(degrees) || 0) * Math.PI / 180;

  function getAsset(assetMap, id) {
    return assetMap?.get ? assetMap.get(id) : assetMap?.[id];
  }

  function toCesiumDescriptors(document, assetMap) {
    const output = { models: [], instances: [], polygons: [], polylines: [], procedurals: [], fallbacks: [] };
    const visibleLayers = new Set((document?.layers || []).filter((layer) => layer.visible !== false).map((layer) => layer.id));
    const batches = new Map();
    for (const object of document?.objects || []) {
      if (!visibleLayers.has(object.layerId)) continue;
      const base = { sourceObjectId: object.id, layerId: object.layerId, category: object.category };
      const assetRef = object.properties?.assetRef;
      const asset = getAsset(assetMap, assetRef);
      if (object.kind === "surface") {
        output.polygons.push({ ...base, coordinatesDegrees: object.geometry.coordinates, materialRef: object.properties?.materialRef || object.category, elevationM: Number(object.properties?.elevationM) || 0, extrusionHeightM: Number(object.properties?.extrusionHeightM) || 0 });
        continue;
      }
      if (object.kind === "line") {
        output.polylines.push({
          ...base,
          assetRef,
          coordinatesDegrees: object.geometry.coordinates,
          widthM: Math.max(.05, Number(object.properties?.widthM) || Number(asset?.footprintM?.[0]) || 1),
          heightM: Number(object.properties?.heightM ?? asset?.defaultHeightM) || 0,
          renderer: asset?.renderer || "line",
          materialRef: object.properties?.materialRef || object.category
        });
        continue;
      }
      if (object.kind !== "asset" && object.kind !== "structure") continue;
      const transform = object.transform || {};
      const descriptor = {
        ...base,
        assetRef,
        storagePath: asset?.storagePath || null,
        url: asset?.url || null,
        positionDegrees: [object.geometry.coordinates[0], object.geometry.coordinates[1], Number(transform.heightOffsetM) || 0],
        orientationRadians: { heading: radians(transform.headingDeg), pitch: radians(transform.pitchDeg), roll: radians(transform.rollDeg) },
        scale: Array.isArray(transform.scale) ? transform.scale.slice(0, 3) : [1, 1, 1],
        modelMatrix: { translationDegrees: object.geometry.coordinates.slice(0, 2), heightM: Number(transform.heightOffsetM) || 0, headingPitchRollRadians: [radians(transform.headingDeg), radians(transform.pitchDeg), radians(transform.rollDeg)], scale: Array.isArray(transform.scale) ? transform.scale.slice(0, 3) : [1, 1, 1] },
        batchKey: asset?.storagePath || asset?.url ? `${asset.id || assetRef}:${asset.storagePath || asset.url}` : null
      };
      if (asset?.fileType === "glb" && (asset.storagePath || asset.url) && asset.status !== "archived") {
        output.models.push(descriptor);
        const batch = batches.get(descriptor.batchKey) || { batchKey: descriptor.batchKey, assetRef, sourceObjectIds: [] };
        batch.sourceObjectIds.push(object.id);
        batches.set(descriptor.batchKey, batch);
      } else if (String(asset?.renderer || "").startsWith("procedural-")) {
        output.procedurals.push({ ...descriptor, renderer: asset.renderer, label: object.properties?.displayName || asset.label || object.category || "组件", footprintM: object.properties?.footprintM || asset?.footprintM || [1, 1], heightM: Number(object.properties?.heightM || asset?.defaultHeightM) || 1 });
      } else {
        output.fallbacks.push({ ...descriptor, label: object.properties?.displayName || object.category || "素材", footprintM: object.properties?.footprintM || asset?.footprintM || [1, 1], heightM: Number(object.properties?.heightM || asset?.defaultHeightM) || 1 });
      }
    }
    output.instances = [...batches.values()].filter((batch) => batch.sourceObjectIds.length > 1);
    return output;
  }

  return { toCesiumDescriptors };
});
