(function (root, factory) {
  const common = typeof module === "object" && module.exports;
  const api = factory(common ? require("./scene-to-cesium") : root.SceneToCesiumModule,
    common ? require("../../features/models/model-residency") : root.ModelResidencyModule,
    common ? require("../../features/3d/render-quality") : root.RenderQualityModule,
    common ? require("../../features/models/model-view-metrics") : root.ModelViewMetricsModule);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ScenePreviewAdapterModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SceneToCesium, Residency, Quality, Metrics) {
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
    let terrainRevision = 0;
    const pendingLoads = new Set();
    const hasNativeModels = !!(Cesium.Model?.fromGltfAsync && Cesium.Transforms?.headingPitchRollToFixedFrame && viewer.scene?.primitives);
    const profile = () => options.getQualityProfile?.() || Quality?.getProfile?.() || { modelBudget: 24, detailPixels: 100 };
    function lowModelUrl(asset) {
      const explicit = asset?.lowUrl || asset?.metadata?.lowUrl;
      if (explicit) return explicit;
      // Bundled seeds are already small procedural GLBs; reuse them at overview distance.
      return String(asset?.id || '').startsWith('seed:') &&
        String(asset?.url || '').startsWith('3D_scenes_edit/assets/models/') ? asset.url : undefined;
    }
    const residency = Residency?.createModelResidencyManager?.({
      getBudget: () => options.getModelBudget?.() ?? profile().modelBudget,
      getDetailPixels: () => options.getDetailPixels?.() ?? profile().detailPixels,
      load(entry) {
        const task = (async () => {
          const record = entry.record;
          const asset = record.asset;
          const low = entry.variant === 'low';
          const chosen = low ? { ...asset, url: lowModelUrl(asset),
            storagePath: asset.metadata?.lowStoragePath || asset.lowStoragePath } : asset;
          const resolved = chosen?.url || await assetResolver(chosen, { ...record.descriptor, variant: entry.variant });
          const uri = typeof resolved === 'string' ? resolved : resolved?.url;
          if (!uri) throw new Error('Empty model URL');
          if (disposed || records.get(entry.key) !== record || recordRevision(record) !== entry.revision) {
            if (uri.startsWith('blob:')) globalThis.URL?.revokeObjectURL?.(uri);
            throw new Error('Scene model request superseded');
          }
          if (hasNativeModels) {
            try {
              const primitive = await Cesium.Model.fromGltfAsync({ url: uri, id: record.entity,
                modelMatrix: primitiveMatrix(record), scene: viewer.scene,
                heightReference: Cesium.HeightReference?.NONE,
                scale: 1, minimumPixelSize: 0, incrementallyLoadTextures: false, runAnimations: false });
              return { uri, record, primitive, added: false };
            } catch (error) {
              if (uri.startsWith('blob:')) globalThis.URL?.revokeObjectURL?.(uri);
              throw error;
            }
          }
          return { uri, record };
        })();
        pendingLoads.add(task);
        task.then(() => pendingLoads.delete(task), () => pendingLoads.delete(task));
        return task;
      },
      unload(resource) {
        const record = resource.record;
        resource.removeErrorListener?.();
        resource.removeErrorListener = null;
        if (resource.primitive) {
          if (resource.added) viewer.scene.primitives.remove(resource.primitive);
          if (!resource.primitive.isDestroyed?.()) resource.primitive.destroy?.();
        }
        if (record.modelResource === resource) {
          record.modelResource = null;
          record.entity.model = undefined;
          if (!disposed && records.get(record.descriptor.sourceObjectId) === record) applyProxy(record);
        }
        if (resource.uri?.startsWith?.('blob:')) globalThis.URL?.revokeObjectURL?.(resource.uri);
        viewer.scene?.requestRender?.();
      },
      setVisible(resource, show, entry) {
        const record = entry.record;
        if (disposed || records.get(entry.key) !== record) return;
        if (resource) {
          record.modelResource = resource;
          if (resource.primitive) {
            if (!resource.added) {
              // Terrain may have completed while this GLB was loading.
              resource.primitive.modelMatrix = primitiveMatrix(record);
              record.appliedGroundSample = record.groundSample;
              resource.removeErrorListener = resource.primitive.errorEvent?.addEventListener?.(error => {
                if (disposed || records.get(entry.key) !== record || record.modelResource !== resource) return;
                residency.fail(entry.key, error);
              });
              resource.added = true;
              viewer.scene.primitives.add(resource.primitive);
              if (disposed || record.modelResource !== resource) return;
            }
            resource.primitive.show = show;
            resource.primitive.silhouetteColor = color('YELLOW');
            resource.primitive.silhouetteSize = selectedIds.has(entry.key) ? 2 : 0;
            record.entity.model = undefined;
            record.entity.show = false;
          } else {
            Object.assign(record.entity, modelGraphics(record, resource.uri));
            record.entity.show = show;
          }
        } else if (!record.modelResource) {
          applyProxy(record);
        }
        viewer.scene?.requestRender?.();
      },
      onError(error, entry) {
        const record = entry.record;
        if (!disposed && records.get(entry.key) === record) {
          record.unavailable = true;
          applyProxy(record);
          options.onError?.(error, entry);
        }
      }
    });

    async function whenReady() {
      while (pendingLoads.size) {
        await Promise.allSettled([...pendingLoads]);
        await Promise.resolve();
      }
    }
    function recordRevision(record) {
      const descriptor = record.descriptor;
      return descriptor ? JSON.stringify([descriptor.assetRef, descriptor.positionDegrees, descriptor.orientationRadians,
        descriptor.scale, record.asset?.metadata?.calibrationScale, record.asset?.metadata?.groundOffsetM,
        record.asset?.metadata?.headingCorrectionDeg]) : null;
    }
    function primitiveMatrix(record) {
      const descriptor = record.descriptor;
      const metadata = record.asset?.metadata || {};
      const angles = descriptor.orientationRadians;
      const [longitude, latitude, height = 0] = descriptor.positionDegrees;
      const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, terrainHeight(record) + height + (Number(metadata.groundOffsetM) || 0));
      let matrix = Cesium.Transforms.headingPitchRollToFixedFrame(position,
        new Cesium.HeadingPitchRoll(angles.heading + (Number(metadata.headingCorrectionDeg) || 0) * Math.PI / 180, angles.pitch, angles.roll));
      if (Cesium.Matrix4?.multiplyByScale) {
        const calibration = metadata.calibrationScale || [1, 1, 1];
        const scale = descriptor.scale.map((value, axis) => (Number(value) || 1) * (Number(calibration[axis]) || 1));
        matrix = Cesium.Matrix4.multiplyByScale(matrix, new Cesium.Cartesian3(...scale), matrix);
      }
      return matrix;
    }
    function modelGraphics(record, uri) {
      const descriptor = record.descriptor;
      const position = Cesium.Cartesian3.fromDegrees(...descriptor.positionDegrees);
      const angles = descriptor.orientationRadians;
      return { position, box: undefined, label: undefined,
        orientation: Cesium.Transforms?.headingPitchRollQuaternion?.(position,
          new Cesium.HeadingPitchRoll(angles.heading, angles.pitch, angles.roll)),
        model: { uri, scale: descriptor.scale[0], minimumPixelSize: 0,
          silhouetteSize: selectedIds.has(descriptor.sourceObjectId) ? 2 : 0,
          heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND } };
    }
    function proxyDescriptor(record) {
      return { ...record.descriptor, label: record.asset?.label || record.asset?.displayName || record.descriptor.category,
        footprintM: record.asset?.footprintM, heightM: record.asset?.defaultHeightM };
    }
    function applyProxy(record) {
      Object.assign(record.entity, fallbackGraphics(proxyDescriptor(record), record.unavailable), { model: undefined, show: true });
    }
    function terrainHeight(record) {
      const [longitude, latitude] = record.descriptor.positionDegrees;
      const provider = viewer.terrainProvider;
      const sample = record.groundSample;
      if (sample && sample.longitude === longitude && sample.latitude === latitude &&
          sample.provider === provider && sample.revision === terrainRevision) return sample.height;
      const point = Cesium.Cartographic?.fromDegrees?.(longitude, latitude);
      const value = point ? viewer.scene?.globe?.getHeight?.(point) : undefined;
      record.groundSample = { longitude, latitude, provider, revision: terrainRevision,
        height: Number.isFinite(value) ? value : 0 };
      return record.groundSample.height;
    }
    function viewportCandidates() {
      const camera = viewer.camera;
      const cameraPosition = camera?.positionWC || camera?.position;
      const candidates = [];
      for (const [key, record] of records) {
        if (!record.descriptor) continue;
        const descriptor = record.descriptor;
        const size = record.asset?.metadata?.realSizeM || [record.asset?.footprintM?.[0] || 1,
          record.asset?.footprintM?.[1] || 1, record.asset?.defaultHeightM || 1];
        const radius = Math.max(.1, Math.hypot(size[0] * descriptor.scale[0], size[1] * descriptor.scale[1], size[2] * descriptor.scale[2]) / 2);
        const [longitude, latitude, offset = 0] = descriptor.positionDegrees;
        const groundHeight = terrainHeight(record);
        if (record.modelResource?.primitive && record.appliedGroundSample !== record.groundSample) {
          record.modelResource.primitive.modelMatrix = primitiveMatrix(record);
          record.appliedGroundSample = record.groundSample;
        }
        const position = Cesium.Cartesian3.fromDegrees(longitude, latitude,
          groundHeight + offset + (Number(record.asset?.metadata?.groundOffsetM) || 0));
        const measured = cameraPosition && Cesium.Cartesian3.distance && Metrics?.measureModelView
          ? Metrics.measureModelView(Cesium, viewer, position, radius)
          : { distance: Infinity, pixels: 1000000, inView: true };
        candidates.push({ key, ...measured, selected: selectedIds.has(key) });
      }
      return candidates;
    }
    function updateResidency() {
      if (!disposed && residency) residency.update(viewportCandidates());
    }
    function refreshTerrain(remaining) {
      if (disposed || (typeof remaining === 'number' && remaining > 0)) return;
      terrainRevision++;
      updateResidency();
      viewer.scene?.requestRender?.();
    }
    const removeCameraListener = viewer.camera?.changed?.addEventListener?.(updateResidency);
    const removeTerrainListener = viewer.scene?.globe?.tileLoadProgressEvent?.addEventListener?.(refreshTerrain);
    const providerEvent = viewer.scene?.terrainProviderChanged || viewer.scene?.globe?.terrainProviderChanged;
    const removeProviderListener = providerEvent?.addEventListener?.(refreshTerrain);
    const unsubscribeQuality = Quality?.subscribe?.(updateResidency);

    function color(name, alpha) {
      const value = Cesium.Color?.[name] || Cesium.Color?.GRAY;
      return alpha !== undefined && value?.withAlpha ? value.withAlpha(alpha) : value;
    }

    function lineMaterial(descriptor) {
      const colors = {
        path: "#b98b55",
        drainage: "#4c94b8",
        curb: "#8c9298",
        "low-wall": "#a26f4a",
        fence: "#8a6848",
        hedge: "#447f4f"
      };
      return Cesium.Color?.fromCssColorString?.(colors[descriptor.category] || "#f4f1e8") || color("WHITE");
    }

    function lineGraphics(descriptor) {
      const positions = Cesium.Cartesian3.fromDegreesArray(flattenPositions(descriptor.coordinatesDegrees));
      const material = lineMaterial(descriptor);
      if (descriptor.renderer === "wide-line" || descriptor.renderer === "extruded-line") {
        return {
          polyline: undefined,
          corridor: {
            positions,
            width: Math.max(.2, descriptor.widthM),
            material,
            heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType?.BOTH
          }
        };
      }
      return {
        corridor: undefined,
        polyline: {
          positions,
          width: Math.max(3, descriptor.widthM * 2),
          clampToGround: true,
          material
        }
      };
    }

    function lineFocus(coordinates) {
      const points = coordinates || [];
      if (!points.length) return null;
      const longitudes = points.map((point) => point[0]);
      const latitudes = points.map((point) => point[1]);
      const longitude = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
      const latitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
      const longitudeSpanM = (Math.max(...longitudes) - Math.min(...longitudes)) * 111320 * Math.cos(latitude * Math.PI / 180);
      const latitudeSpanM = (Math.max(...latitudes) - Math.min(...latitudes)) * 110540;
      const height = Math.max(45, Math.min(500, Math.max(longitudeSpanM, latitudeSpanM) * 1.8));
      return { positionDegrees: [longitude, latitude, height] };
    }

    function upsert(sourceObjectId, graphics, uri, focus) {
      const id = `scene-edit:${sourceObjectId}`;
      const current = records.get(sourceObjectId);
      if (current) {
        if (current.uri?.startsWith?.("blob:") && current.uri !== uri) globalThis.URL?.revokeObjectURL?.(current.uri);
        Object.assign(current.entity, { model: undefined, box: undefined, label: undefined,
          polygon: undefined, polyline: undefined, corridor: undefined, cylinder: undefined, ellipsoid: undefined }, graphics, { show: true });
        current.uri = uri || null;
        current.focus = focus || null;
        return current.entity;
      }
      const entity = viewer.entities.add({ id, ...graphics, show: true, properties: { sourceObjectId } });
      records.set(sourceObjectId, { entity, uri: uri || null, focus: focus || null });
      return entity;
    }

    function removeStale(nextIds) {
      for (const [id, record] of records) {
        if (nextIds.has(id)) continue;
        residency?.unregister(id);
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
      const modelIds = new Set(descriptors.models.map(descriptor => descriptor.sourceObjectId));
      for (const [id, record] of records) {
        if (record.descriptor && !modelIds.has(id)) {
          residency?.unregister(id);
          record.descriptor = null;
          record.asset = null;
          record.entity.model = undefined;
        }
      }
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
        upsert(descriptor.sourceObjectId, lineGraphics(descriptor), null, lineFocus(descriptor.coordinatesDegrees));
      }
      for (const descriptor of descriptors.fallbacks) {
        nextIds.add(descriptor.sourceObjectId);
        upsert(descriptor.sourceObjectId, fallbackGraphics(descriptor, false));
      }
      for (const descriptor of descriptors.procedurals) {
        nextIds.add(descriptor.sourceObjectId);
        upsert(descriptor.sourceObjectId, proceduralGraphics(descriptor));
      }
      if (residency) {
        for (const descriptor of descriptors.models) {
          const id = descriptor.sourceObjectId;
          nextIds.add(id);
          const asset = assetMap?.get ? assetMap.get(descriptor.assetRef) : assetMap?.[descriptor.assetRef];
          let record = records.get(id);
          if (!record) {
            upsert(id, fallbackGraphics({ ...descriptor, label: asset?.label || descriptor.category,
              footprintM: asset?.footprintM, heightM: asset?.defaultHeightM }, false));
            record = records.get(id);
          }
          record.descriptor = descriptor;
          record.asset = asset;
          record.unavailable = false;
          if (record.modelResource?.primitive) record.modelResource.primitive.modelMatrix = primitiveMatrix(record);
          else if (record.modelResource) Object.assign(record.entity, modelGraphics(record, record.modelResource.uri));
          else applyProxy(record);
          residency.register(id, { url: asset?.url || asset?.storagePath,
            lowUrl: lowModelUrl(asset) || asset?.metadata?.lowStoragePath || asset?.lowStoragePath,
            revision: recordRevision(record), record });
        }
      } else await mapLimit(descriptors.models, 4, async (descriptor) => {
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
            model: { uri, scale: descriptor.scale[0], minimumPixelSize: 0, heightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND }
          }, uri);
        } catch (_error) {
          upsert(descriptor.sourceObjectId, fallbackGraphics({ ...descriptor, label: descriptor.category, footprintM: asset?.footprintM, heightM: asset?.defaultHeightM }, true));
        }
      });
      removeStale(nextIds);
      select([...selectedIds]);
      return { ok: true, counts: Object.fromEntries(Object.entries(descriptors).map(([key, value]) => [key, value.length])), ready: whenReady() };
    }

    function select(ids) {
      selectedIds = new Set(ids || []);
      for (const [id, record] of records) {
        if (!record.descriptor) record.entity.show = true;
        record.entity.isSceneEditSelected = selectedIds.has(id);
        if (record.entity.model) record.entity.model.silhouetteSize = selectedIds.has(id) ? 2 : 0;
        if (record.modelResource?.primitive) record.modelResource.primitive.silhouetteSize = selectedIds.has(id) ? 2 : 0;
      }
      updateResidency();
    }

    function flyToBoundary(boundary) {
      const points = boundary?.coordinates?.[0] || [];
      if (!points.length) return false;
      const center = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / points.length);
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(center[0], center[1], 250) });
      return true;
    }

    function flyToObject(id) {
      const record = records.get(String(id || ""));
      const entity = record?.entity;
      const primitive = record?.modelResource?.primitive;
      if (primitive?.ready && viewer.camera?.flyToBoundingSphere) {
        viewer.camera.flyToBoundingSphere(primitive.boundingSphere, { duration: .45 });
        return true;
      }
      if (record?.focus?.positionDegrees && typeof viewer.camera?.flyTo === "function") {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(...record.focus.positionDegrees),
          duration: 0.45,
          orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 }
        });
        return true;
      }
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
          minimumPixelSize: 0,
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

    function clear() {
      residency?.clear();
      clearGhost();
      for (const record of records.values()) {
        viewer.entities.remove(record.entity);
        if (record.uri?.startsWith?.("blob:")) globalThis.URL?.revokeObjectURL?.(record.uri);
      }
      records.clear();
      selectedIds.clear();
      viewer.scene?.requestRender?.();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof removeCameraListener === 'function') removeCameraListener();
      else viewer.camera?.changed?.removeEventListener?.(updateResidency);
      if (typeof removeTerrainListener === 'function') removeTerrainListener();
      else viewer.scene?.globe?.tileLoadProgressEvent?.removeEventListener?.(refreshTerrain);
      if (typeof removeProviderListener === 'function') removeProviderListener();
      else providerEvent?.removeEventListener?.(refreshTerrain);
      unsubscribeQuality?.();
      residency?.destroy();
      clear();
    }

    return { render, select, flyToBoundary, flyToObject, pickObjectId, setGhost, clearGhost, clear, dispose,
      whenReady, updateResidency, getModelStats: () => residency?.getStats?.() || null };
  }

  return { mapLimit, createScenePreviewAdapter };
});
