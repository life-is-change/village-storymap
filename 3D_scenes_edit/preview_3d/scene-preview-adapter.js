(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./scene-to-cesium") : root.SceneToCesiumModule);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ScenePreviewAdapterModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SceneToCesium) {
  function flattenPositions(coordinates) {
    return (coordinates || []).flatMap((position) => [position[0], position[1]]);
  }

  async function mapLimit(items, limit, worker) {
    let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  }

  function createScenePreviewAdapter(options) {
    const Cesium = options.Cesium;
    const viewer = options.viewer;
    const assetResolver = options.assetResolver || (async (asset) => asset?.url || asset?.storagePath);
    const records = new Map();
    let selectedIds = new Set();
    let disposed = false;
    let ghostEntity = null;
    let ghostAssetKey = null;

    function color(name, alpha) {
      const value = Cesium.Color?.[name] || Cesium.Color?.GRAY;
      return alpha !== undefined && value?.withAlpha ? value.withAlpha(alpha) : value;
    }

    function upsert(sourceObjectId, graphics, uri) {
      const id = `scene-edit:${sourceObjectId}`;
      const current = records.get(sourceObjectId);
      if (current) {
        if (current.uri?.startsWith?.("blob:") && current.uri !== uri) globalThis.URL?.revokeObjectURL?.(current.uri);
        Object.assign(current.entity, graphics, { show: true });
        current.uri = uri || null;
        return current.entity;
      }
      const entity = viewer.entities.add({ id, ...graphics, show: true, properties: { sourceObjectId } });
      records.set(sourceObjectId, { entity, uri: uri || null });
      return entity;
    }

    function removeStale(nextIds) {
      for (const [id, record] of records) {
        if (nextIds.has(id)) continue;
        viewer.entities.remove(record.entity);
        if (record.uri?.startsWith?.("blob:")) globalThis.URL?.revokeObjectURL?.(record.uri);
        records.delete(id);
      }
    }

    function fallbackGraphics(descriptor, unavailable) {
      const dimensions = descriptor.footprintM || [1, 1];
      const height = descriptor.heightM || 1;
      const [longitude, latitude, heightOffset = 0] = descriptor.positionDegrees || [];
      const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, heightOffset + height / 2);
      return {
        position,
        orientation: Cesium.Transforms?.headingPitchRollQuaternion?.(position, new Cesium.HeadingPitchRoll(descriptor.orientationRadians.heading, descriptor.orientationRadians.pitch, descriptor.orientationRadians.roll)),
        box: { dimensions: { x: dimensions[0], y: dimensions[1], z: height }, material: color("GRAY", .65), outline: true, heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND },
        label: { text: unavailable ? `${descriptor.label || descriptor.category}（模型不可用）` : descriptor.label || descriptor.category, showBackground: true, heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND }
      };
    }

    function proceduralGraphics(descriptor) {
      const dimensions = descriptor.footprintM || [1, 1];
      const height = descriptor.heightM || 1;
      const [longitude, latitude, heightOffset = 0] = descriptor.positionDegrees || [];
      const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, heightOffset + height / 2);
      const base = {
        position,
        orientation: Cesium.Transforms?.headingPitchRollQuaternion?.(position, new Cesium.HeadingPitchRoll(descriptor.orientationRadians.heading, descriptor.orientationRadians.pitch, descriptor.orientationRadians.roll))
      };
      const renderer = descriptor.renderer;
      if (renderer === "procedural-tree" || renderer === "procedural-shrub") return {
        ...base,
        cylinder: { length: height, topRadius: renderer === "procedural-tree" ? .16 : dimensions[0] * .35, bottomRadius: renderer === "procedural-tree" ? .24 : dimensions[0] * .45, material: color("DARKGREEN", .95), heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND },
        ellipsoid: { radii: { x: dimensions[0] * .5, y: dimensions[1] * .5, z: height * .38 }, material: color("GREEN", .9), heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND }
      };
      if (["procedural-pavilion", "procedural-pergola", "procedural-shelter"].includes(renderer)) return {
        ...base,
        box: { dimensions: { x: dimensions[0], y: dimensions[1], z: Math.max(.18, height * .12) }, material: color("SADDLEBROWN", .9), outline: true, heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND },
        cylinder: { length: height, topRadius: .12, bottomRadius: .16, material: color("DARKGRAY", .95), heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND }
      };
      if (renderer === "procedural-light" || renderer === "procedural-sign") return {
        ...base,
        cylinder: { length: height, topRadius: .08, bottomRadius: .12, material: color("DARKGRAY", .95), heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND },
        ellipsoid: { radii: { x: dimensions[0] * .45, y: dimensions[1] * .45, z: Math.max(.15, height * .08) }, material: color("YELLOW", .9), heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND }
      };
      const palette = renderer === "procedural-bench" || renderer === "procedural-table" ? "SADDLEBROWN"
        : renderer === "procedural-play" || renderer === "procedural-fitness" ? "ORANGE"
          : renderer === "procedural-stage" ? "SLATEGRAY" : "STEELBLUE";
      return { ...base, box: { dimensions: { x: dimensions[0], y: dimensions[1], z: height }, material: color(palette, .9), outline: true, heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND } };
    }

    async function render(document, assetMap) {
      if (disposed) return { ok: false, code: "DISPOSED" };
      const descriptors = SceneToCesium.toCesiumDescriptors(document, assetMap);
      const nextIds = new Set();
      const boundary = document?.selectionBoundary?.coordinates?.[0] || [];
      if (boundary.length >= 3) {
        const boundaryId = "selection-boundary";
        nextIds.add(boundaryId);
        upsert(boundaryId, {
          polyline: { positions: Cesium.Cartesian3.fromDegreesArray(flattenPositions(boundary)), width: 5, clampToGround: true, material: color("CYAN") },
          polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(flattenPositions(boundary)), material: color("CYAN", .16), classificationType: Cesium.ClassificationType?.BOTH }
        });
      }
      for (const descriptor of descriptors.polygons) {
        nextIds.add(descriptor.sourceObjectId);
        const outer = descriptor.coordinatesDegrees?.[0] || [];
        upsert(descriptor.sourceObjectId, { polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(flattenPositions(outer)), material: color("WHITE", .7), height: descriptor.elevationM, extrudedHeight: descriptor.elevationM + descriptor.extrusionHeightM } });
      }
      for (const descriptor of descriptors.polylines) {
        nextIds.add(descriptor.sourceObjectId);
        upsert(descriptor.sourceObjectId, { polyline: { positions: Cesium.Cartesian3.fromDegreesArray(flattenPositions(descriptor.coordinatesDegrees)), width: descriptor.widthM, material: color("WHITE") } });
      }
      for (const descriptor of descriptors.fallbacks) {
        nextIds.add(descriptor.sourceObjectId);
        upsert(descriptor.sourceObjectId, fallbackGraphics(descriptor, false));
      }
      for (const descriptor of descriptors.procedurals) {
        nextIds.add(descriptor.sourceObjectId);
        upsert(descriptor.sourceObjectId, proceduralGraphics(descriptor));
      }
      await mapLimit(descriptors.models, 4, async (descriptor) => {
        nextIds.add(descriptor.sourceObjectId);
        const asset = assetMap?.get ? assetMap.get(descriptor.assetRef) : assetMap?.[descriptor.assetRef];
        try {
          const uri = asset?.url || await assetResolver(asset, descriptor);
          if (!uri) throw new Error("Empty model URL");
          const position = Cesium.Cartesian3.fromDegrees(...descriptor.positionDegrees);
          const hpr = new Cesium.HeadingPitchRoll(descriptor.orientationRadians.heading, descriptor.orientationRadians.pitch, descriptor.orientationRadians.roll);
          upsert(descriptor.sourceObjectId, {
            position,
            orientation: Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
            model: { uri, scale: descriptor.scale[0], minimumPixelSize: 16, heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND }
          }, uri);
        } catch (_error) {
          upsert(descriptor.sourceObjectId, fallbackGraphics({ ...descriptor, label: descriptor.category, footprintM: asset?.footprintM, heightM: asset?.defaultHeightM }, true));
        }
      });
      removeStale(nextIds);
      select([...selectedIds]);
      return { ok: true, counts: Object.fromEntries(Object.entries(descriptors).map(([key, value]) => [key, value.length])) };
    }

    function select(ids) {
      selectedIds = new Set(ids || []);
      for (const [id, record] of records) {
        record.entity.show = true;
        record.entity.isSceneEditSelected = selectedIds.has(id);
        if (record.entity.model) record.entity.model.silhouetteSize = selectedIds.has(id) ? 2 : 0;
      }
    }

    function flyToBoundary(boundary) {
      const points = boundary?.coordinates?.[0] || [];
      if (!points.length) return false;
      const center = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / points.length);
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(center[0], center[1], 250) });
      return true;
    }

    function flyToObject(id) {
      const entity = records.get(String(id || ""))?.entity;
      if (!entity || typeof viewer.flyTo !== "function") return false;
      const options = { duration: 0.45 };
      if (Cesium.HeadingPitchRange) options.offset = new Cesium.HeadingPitchRange(0, -.55, 35);
      viewer.flyTo(entity, options);
      return true;
    }

    function pickObjectId(picked) {
      const entity = picked?.id || picked?.primitive?.id || null;
      const property = entity?.properties?.sourceObjectId;
      const value = typeof property?.getValue === "function" ? property.getValue() : property;
      if (value !== undefined && value !== null && String(value)) return String(value);
      const entityId = String(entity?.id || "");
      return entityId.startsWith("scene-edit:") && entityId !== "scene-edit:placement-ghost"
        ? entityId.slice("scene-edit:".length)
        : null;
    }

    function clearGhost() {
      if (ghostEntity) viewer.entities.remove(ghostEntity);
      ghostEntity = null;
      ghostAssetKey = null;
    }

    function setGhost(asset, coordinate) {
      if (!asset || !Array.isArray(coordinate)) return null;
      const uri = asset.url || asset.signedUrl || null;
      const assetKey = `${asset.id || asset.assetRef || "asset"}:${uri || "fallback"}`;
      const footprint = asset.footprintM || asset.metadata?.footprintM || [1.5, .6];
      const height = Number(asset.defaultHeightM || asset.metadata?.defaultHeightM) || .8;
      const position = Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1], 0);
      if (ghostEntity && ghostAssetKey === assetKey) {
        ghostEntity.position = position;
        return ghostEntity;
      }
      clearGhost();
      const graphics = uri ? {
        position,
        model: {
          uri,
          scale: 1,
          minimumPixelSize: 16,
          heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND,
          color: color("WHITE", .62),
          colorBlendMode: Cesium.ColorBlendMode?.MIX,
          colorBlendAmount: .18,
          silhouetteColor: color("YELLOW"),
          silhouetteSize: 1
        }
      } : {
        position: Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1], height / 2),
        box: {
          dimensions: { x: footprint[0] || 1.5, y: footprint[1] || .6, z: height },
          material: color("YELLOW", .25), outline: true,
          heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND
        }
      };
      ghostEntity = viewer.entities.add({
        id: "scene-edit-placement-ghost",
        ...graphics,
        label: { text: asset.displayName || asset.name || asset.category || "待放置组件", showBackground: true, heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND },
        properties: { isSceneEditGhost: true }
      });
      ghostAssetKey = assetKey;
      return ghostEntity;
    }

    function dispose() {
      disposed = true;
      clearGhost();
      for (const record of records.values()) {
        viewer.entities.remove(record.entity);
        if (record.uri?.startsWith?.("blob:")) globalThis.URL?.revokeObjectURL?.(record.uri);
      }
      records.clear();
    }

    return { render, select, flyToBoundary, flyToObject, pickObjectId, setGhost, clearGhost, dispose };
  }

  return { mapLimit, createScenePreviewAdapter };
});
