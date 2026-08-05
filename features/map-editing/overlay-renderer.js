(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OverlayRendererModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function planIncrementalLayerUpdate(
    currentFeatures,
    effectiveLayerKeys,
    { forceFullRebuild = false } = {}
  ) {
    const selected = new Set(effectiveLayerKeys || []);
    const reusedFeatures = [];
    const reusedLayerKeys = new Set();
    if (!forceFullRebuild) {
      (currentFeatures || []).forEach((feature) => {
        const layerKey = feature?.get?.("layerKey");
        if (layerKey === "communityTask") {
          reusedFeatures.push(feature);
          return;
        }
        if (selected.has(layerKey)) {
          reusedFeatures.push(feature);
          reusedLayerKeys.add(layerKey);
        }
      });
    }
    return {
      reusedFeatures,
      layerKeysToBuild: (effectiveLayerKeys || []).filter((key) => !reusedLayerKeys.has(key))
    };
  }

  function createLatestOverlayRefreshController({ render } = {}) {
    if (typeof render !== "function") throw new Error("OVERLAY_RENDER_REQUIRED");

    let latestRequestId = 0;
    let completedRequestId = 0;
    let running = false;
    let scheduled = false;
    let idlePromise = null;
    let resolveIdle = null;
    let latestPayload = {};

    function ensureIdlePromise() {
      if (!idlePromise) {
        idlePromise = new Promise((resolve) => {
          resolveIdle = resolve;
        });
      }
      return idlePromise;
    }

    function completeIfIdle() {
      if (running || scheduled || completedRequestId < latestRequestId || !resolveIdle) return;
      const resolve = resolveIdle;
      resolveIdle = null;
      idlePromise = null;
      resolve();
    }

    async function drain() {
      scheduled = false;
      if (running) return;
      running = true;
      try {
        while (completedRequestId < latestRequestId) {
          const id = latestRequestId;
          const payload = latestPayload;
          await render({ id, payload, isCurrent: () => id === latestRequestId });
          completedRequestId = id;
        }
      } finally {
        running = false;
        if (completedRequestId < latestRequestId) schedule();
        else completeIfIdle();
      }
    }

    function schedule() {
      if (scheduled || running) return;
      scheduled = true;
      queueMicrotask(drain);
    }

    return {
      request(payload = {}) {
        latestRequestId += 1;
        latestPayload = payload;
        const pending = ensureIdlePromise();
        schedule();
        return pending;
      },
      invalidate() {
        latestRequestId += 1;
      }
    };
  }

  let lastRenderedSpaceId = null;

  const api = {
    createLatestOverlayRefreshController,
    planIncrementalLayerUpdate,
    async refresh2DOverlay(deps, refreshRequest = null, options = {}) {
      const plan2dView = deps.getPlan2DView();
      if (!plan2dView?.classList.contains("active")) return;

      const currentSpaceId = deps.getCurrentSpaceId();
      const refreshOptions = {
        ...options,
        forceFullRebuild: options.forceFullRebuild === true || lastRenderedSpaceId !== currentSpaceId
      };
      deps.setActive2DSpaceId(currentSpaceId);

      await deps.ensurePlanMap();
      const OL = await deps.getOlReady();
      const { GeoJSON, VectorSource } = OL;

      const currentVectorSource = deps.getPlanVectorSource();
      const planVectorLayer = deps.getPlanVectorLayer();
      if (!currentVectorSource || !planVectorLayer) return;

      // 双缓冲渲染：先在新的 VectorSource 中构建完整图层，再一次性替换。
      // 这样切换图层/刷新云端数据时不会先清空旧画面，避免“建筑层卡一会才出现”的闪烁感。
      const nextVectorSource = new VectorSource();
      // 问题点由独立的按需刷新流程维护。普通图层开关不访问远端，但也不能在
      // 双缓冲替换 source 时把已经加载的问题点丢掉。
      deps.setActiveFeature(null);

      const selectedLayers = deps.getSelectedLayersForCurrentSpace();
      const effectiveLayerKeys = selectedLayers.includes("figureGround")
        ? (deps.isCurrentSpacePersonal()
          ? deps.getPersonalFigureGroundLayerKeys()
          : ["elevationBands", "contours", "water", "road", "building"])
        : [...selectedLayers];

      const incrementalPlan = planIncrementalLayerUpdate(
        currentVectorSource.getFeatures(),
        effectiveLayerKeys,
        refreshOptions
      );
      incrementalPlan.reusedFeatures.forEach((feature) => nextVectorSource.addFeature(feature));
      const layerKeysToBuild = incrementalPlan.layerKeysToBuild;

      const format = new GeoJSON();
      let personalRowsByLayer = null;
      if (deps.isCurrentSpacePersonal()) {
        const entries = await Promise.all(layerKeysToBuild.map(async (layerKey) => [
          layerKey,
          await deps.listCurrentPersonalLayerFeatures(currentSpaceId, layerKey)
        ]));
        personalRowsByLayer = new Map(entries);
      }

      if (deps.shouldShowVillageFillForCurrentSpace()) {
        const fillRawFeature = deps.buildVillageFillRawFeature();
        if (fillRawFeature) {
          const fillFeature = format.readFeature(fillRawFeature, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:4326"
          });
          fillFeature.set("layerKey", deps.VILLAGE_FILL_LAYER_KEY);
          fillFeature.set("sourceCode", "village-fill");
          fillFeature.set("displayName", "村庄底色");
          fillFeature.set("rawFeature", fillRawFeature);
          fillFeature.set("baseRow", {});
          nextVectorSource.addFeature(fillFeature);
        }
      }

      const layerDataCache = deps.getLayerDataCache();
      const layerConfigs = deps.getLayerConfigs();

      const addDeletedCodesToSet = async (layerKey, codeSet) => {
        if (!codeSet || typeof deps.listDeletedLayerFeatureCodesFromDb !== "function") return;
        const deletedCodes = await deps.listDeletedLayerFeatureCodesFromDb(currentSpaceId, layerKey);
        (Array.isArray(deletedCodes) ? deletedCodes : []).forEach((code) => {
          const normCode = deps.normalizeCode(code);
          if (normCode) codeSet.add(normCode);
        });
      };

      const addCachedFeaturesForLayer = (layerKey, blockedCodeSet = new Set()) => {
        const cached = layerDataCache[layerKey];
        if (!cached?.features?.length) return;

        cached.features.forEach((rawFeature) => {
          if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;
          const sourceCode = deps.getFeatureCode(rawFeature, layerKey);
          const normCode = deps.normalizeCode(sourceCode);
          if (!normCode || blockedCodeSet.has(normCode)) return;

          const props = deps.getFeatureProperties(rawFeature);
          const row = cached.rowIndex.get(normCode) || null;
          const displayName =
            (row && deps.getFirstMatchingField(row, layerConfigs[layerKey]?.nameFields || [])) ||
            deps.getFirstMatchingField(props, layerConfigs[layerKey]?.nameFields || []) ||
            sourceCode ||
            layerConfigs[layerKey]?.label ||
            "未命名对象";

          const olFeature = format.readFeature(rawFeature, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:4326"
          });

          olFeature.set("layerKey", layerKey);
          olFeature.set("sourceCode", sourceCode);
          olFeature.set("displayName", displayName);
          olFeature.set("rawFeature", rawFeature);
          const mergedBaseRow =
            layerKey === "road"
              ? deps.buildRoadBaseRow(row, props)
              : (row || props || {});
          olFeature.set("baseRow", mergedBaseRow);
          nextVectorSource.addFeature(olFeature);
        });
      };

      for (const layerKey of layerKeysToBuild) {
        try {
          if (deps.isCurrentSpacePersonal()) {
            const rows = personalRowsByLayer?.get(layerKey) || [];
            (Array.isArray(rows) ? rows : []).forEach((row) => {
              const rawFeature = deps.buildRawFeatureFromPersonalRow(row);
              if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;
              const olFeature = format.readFeature(rawFeature, {
                dataProjection: "EPSG:4326",
                featureProjection: "EPSG:4326"
              });
              olFeature.set("layerKey", layerKey);
              olFeature.set("sourceCode", row.object_code);
              olFeature.set("displayName", row.object_name || row.object_code || deps.getLayerLabel(layerKey));
              olFeature.set("rawFeature", rawFeature);
              olFeature.set("baseRow", {
                ...(row.props || {}),
                object_code: row.object_code,
                object_name: row.object_name,
                layer_key: row.layer_key
              });
              olFeature.set("personalLayerVersionId", row.layer_version_id);
              nextVectorSource.addFeature(olFeature);
            });
            continue;
          }

          if (layerKey === "building") {
            const dbRows = await deps.listBuildingFeaturesFromDbCached(currentSpaceId);
            const deletedCodeSet = new Set();
            await addDeletedCodesToSet("building", deletedCodeSet);

            if (dbRows.length > 0) {
              const dbCodeSet = new Set(deletedCodeSet);
              dbRows.forEach((row) => {
                dbCodeSet.add(deps.normalizeCode(row.object_code));
                const rawFeature = deps.makeBuildingDbRowToRawFeature(row);
                if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;

                const olFeature = format.readFeature(rawFeature, {
                  dataProjection: "EPSG:4326",
                  featureProjection: "EPSG:4326"
                });

                olFeature.set("layerKey", "building");
                olFeature.set("sourceCode", row.object_code);
                olFeature.set("displayName", row.object_name || row.object_code || "未命名建筑");
                olFeature.set("rawFeature", rawFeature);
                olFeature.set("baseRow", row.props || {});

                nextVectorSource.addFeature(olFeature);
              });

              // 本地教学模式常常只保存新增/修改过的要素；这里把未修改的原始建筑继续叠加显示，避免保存一个新建筑后原有建筑“消失”。
              if (window.FeatureDbModule && typeof window.FeatureDbModule.__listLocalRows === "function") {
                const allLocalRows = window.FeatureDbModule.__listLocalRows(currentSpaceId, "building", true) || [];
                allLocalRows.forEach((row) => {
                  if (row?.is_deleted === true) dbCodeSet.add(deps.normalizeCode(row.object_code));
                });
              }
              await addDeletedCodesToSet("building", dbCodeSet);

              const buildingCached = layerDataCache["building"];
              if (buildingCached?.features?.length) {
                buildingCached.features.forEach((rawFeature) => {
                  if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;
                  const sourceCode = deps.getFeatureCode(rawFeature, "building");
                  const normCode = deps.normalizeCode(sourceCode);
                  if (!normCode || dbCodeSet.has(normCode)) return;

                  const props = deps.getFeatureProperties(rawFeature);
                  const row = buildingCached.rowIndex.get(normCode) || null;
                  const displayName =
                    (row && deps.getFirstMatchingField(row, layerConfigs.building?.nameFields || [])) ||
                    deps.getFirstMatchingField(props, layerConfigs.building?.nameFields || []) ||
                    sourceCode ||
                    "未命名建筑";

                  const olFeature = format.readFeature(rawFeature, {
                    dataProjection: "EPSG:4326",
                    featureProjection: "EPSG:4326"
                  });

                  olFeature.set("layerKey", "building");
                  olFeature.set("sourceCode", sourceCode);
                  olFeature.set("displayName", displayName);
                  olFeature.set("rawFeature", rawFeature);
                  olFeature.set("baseRow", row || props || {});
                  nextVectorSource.addFeature(olFeature);
                });
              }

              continue;
            }

            const hasAnyDbRecords = await deps.hasAnyBuildingFeaturesInDbCached(currentSpaceId);
            if (hasAnyDbRecords) {
              continue;
            }
            if (deletedCodeSet.size > 0) {
              addCachedFeaturesForLayer("building", deletedCodeSet);
              continue;
            }
          }

          if (layerKey === "road") {
            const dbRows = await deps.listRoadFeaturesFromDbCached(currentSpaceId);
            const deletedCodeSet = new Set();
            await addDeletedCodesToSet("road", deletedCodeSet);

            if (dbRows.length > 0) {
              const dbCodeSet = new Set(deletedCodeSet);
              dbRows.forEach((row) => {
                dbCodeSet.add(deps.normalizeCode(row.object_code));
                const rawFeature = {
                  type: "Feature",
                  properties: {
                    道路编码: row.object_code,
                    道路名称: row.object_name || row.object_code,
                    ...(row.props || {})
                  },
                  geometry: row.geom
                };
                if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;

                const olFeature = format.readFeature(rawFeature, {
                  dataProjection: "EPSG:4326",
                  featureProjection: "EPSG:4326"
                });

                olFeature.set("layerKey", "road");
                olFeature.set("sourceCode", row.object_code);
                olFeature.set("displayName", row.object_name || row.object_code || "未命名道路");
                olFeature.set("rawFeature", rawFeature);
                olFeature.set("baseRow", row.props || {});

                nextVectorSource.addFeature(olFeature);
              });

              const roadCached = layerDataCache["road"];
              await addDeletedCodesToSet("road", dbCodeSet);
              if (roadCached?.features?.length) {
                roadCached.features.forEach((rawFeature) => {
                  if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;
                  const sourceCode = deps.getFeatureCode(rawFeature, "road");
                  const normCode = deps.normalizeCode(sourceCode);
                  if (!normCode || dbCodeSet.has(normCode)) return;

                  const props = deps.getFeatureProperties(rawFeature);
                  const row = roadCached.rowIndex.get(normCode) || null;
                  const displayName =
                    (row && deps.getFirstMatchingField(row, layerConfigs.road?.nameFields || [])) ||
                    deps.getFirstMatchingField(props, layerConfigs.road?.nameFields || []) ||
                    sourceCode ||
                    "未命名道路";

                  const olFeature = format.readFeature(rawFeature, {
                    dataProjection: "EPSG:4326",
                    featureProjection: "EPSG:4326"
                  });

                  olFeature.set("layerKey", "road");
                  olFeature.set("sourceCode", sourceCode);
                  olFeature.set("displayName", displayName);
                  olFeature.set("rawFeature", rawFeature);
                  olFeature.set("baseRow", deps.buildRoadBaseRow(row, props));
                  nextVectorSource.addFeature(olFeature);
                });
              }

              continue;
            }

            const hasAnyDbRecords = await deps.hasAnyRoadFeaturesInDbCached(currentSpaceId);
            if (hasAnyDbRecords) {
              continue;
            }
            if (deletedCodeSet.size > 0) {
              addCachedFeaturesForLayer("road", deletedCodeSet);
              continue;
            }
          }

          if (layerKey === "cropland" || layerKey === "openSpace" || layerKey === "water") {
            const deletedCodeSet = new Set();
            await addDeletedCodesToSet(layerKey, deletedCodeSet);
            const dbRows =
              layerKey === "cropland"
                ? await deps.listCroplandFeaturesFromDbCached(currentSpaceId)
                : layerKey === "openSpace"
                  ? await deps.listOpenSpaceFeaturesFromDbCached(currentSpaceId)
                  : await deps.listWaterFeaturesFromDbCached(currentSpaceId);

            if (dbRows.length > 0) {
              const codeField = deps.getLayerCodeField(layerKey);
              const nameField = deps.getLayerNameField(layerKey);
              const dbCodeSet = new Set(deletedCodeSet);

              dbRows.forEach((row) => {
                dbCodeSet.add(deps.normalizeCode(row.object_code));
                const rawFeature = {
                  type: "Feature",
                  properties: {
                    [codeField]: row.object_code,
                    [nameField]: row.object_name || row.object_code,
                    ...(row.props || {})
                  },
                  geometry: row.geom
                };
                if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;

                const olFeature = format.readFeature(rawFeature, {
                  dataProjection: "EPSG:4326",
                  featureProjection: "EPSG:4326"
                });

                olFeature.set("layerKey", layerKey);
                olFeature.set("sourceCode", row.object_code);
                olFeature.set("displayName", row.object_name || row.object_code || `未命名${deps.getLayerLabel(layerKey)}`);
                olFeature.set("rawFeature", rawFeature);
                olFeature.set("baseRow", row.props || {});
                nextVectorSource.addFeature(olFeature);
              });
              await addDeletedCodesToSet(layerKey, dbCodeSet);

              const cached = layerDataCache[layerKey];
              if (cached?.features?.length) {
                cached.features.forEach((rawFeature) => {
                  if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;
                  const sourceCode = deps.getFeatureCode(rawFeature, layerKey);
                  const normCode = deps.normalizeCode(sourceCode);
                  if (!normCode || dbCodeSet.has(normCode)) return;

                  const props = deps.getFeatureProperties(rawFeature);
                  const row = cached.rowIndex.get(normCode) || null;
                  const displayName =
                    (row && deps.getFirstMatchingField(row, layerConfigs[layerKey]?.nameFields || [])) ||
                    deps.getFirstMatchingField(props, layerConfigs[layerKey]?.nameFields || []) ||
                    sourceCode ||
                    `未命名${deps.getLayerLabel(layerKey)}`;

                  const olFeature = format.readFeature(rawFeature, {
                    dataProjection: "EPSG:4326",
                    featureProjection: "EPSG:4326"
                  });

                  olFeature.set("layerKey", layerKey);
                  olFeature.set("sourceCode", sourceCode);
                  olFeature.set("displayName", displayName);
                  olFeature.set("rawFeature", rawFeature);
                  olFeature.set("baseRow", row);
                  nextVectorSource.addFeature(olFeature);
                });
              }

              continue;
            }

            const hasAnyDbRecords =
              layerKey === "cropland"
                ? await deps.hasAnyCroplandFeaturesInDbCached(currentSpaceId)
                : layerKey === "openSpace"
                  ? await deps.hasAnyOpenSpaceFeaturesInDbCached(currentSpaceId)
                  : await deps.hasAnyWaterFeaturesInDbCached(currentSpaceId);
            if (hasAnyDbRecords) {
              continue;
            }
            if (deletedCodeSet.size > 0) {
              addCachedFeaturesForLayer(layerKey, deletedCodeSet);
              continue;
            }
          }

          const cached = layerDataCache[layerKey];
          if (!cached?.features) continue;

          cached.features.forEach((rawFeature) => {
            if (!deps.isRenderableGeometry(rawFeature?.geometry)) return;
            const sourceCode = deps.getFeatureCode(rawFeature, layerKey);
            const props = deps.getFeatureProperties(rawFeature);
            const row = cached.rowIndex.get(deps.normalizeCode(sourceCode)) || null;

            const displayName =
              (row && deps.getFirstMatchingField(row, layerConfigs[layerKey]?.nameFields || [])) ||
              deps.getFirstMatchingField(props, layerConfigs[layerKey]?.nameFields || []) ||
              sourceCode ||
              layerConfigs[layerKey]?.label ||
              "未命名对象";

            const olFeature = format.readFeature(rawFeature, {
              dataProjection: "EPSG:4326",
              featureProjection: "EPSG:4326"
            });

            olFeature.set("layerKey", layerKey);
            olFeature.set("sourceCode", sourceCode);
            olFeature.set("displayName", displayName);
            olFeature.set("rawFeature", rawFeature);
            const mergedBaseRow =
              layerKey === "road"
                ? deps.buildRoadBaseRow(row, props)
                : (row || props || {});
            olFeature.set("baseRow", mergedBaseRow);

            nextVectorSource.addFeature(olFeature);
          });
        } catch (layerError) {
          console.warn(`渲染图层失败（${layerKey}）：`, layerError);
          continue;
        }
      }

      if (refreshRequest && !refreshRequest.isCurrent()) {
        return { stale: true };
      }

      if (typeof deps.setPlanVectorSource === "function" && typeof planVectorLayer.setSource === "function") {
        deps.setPlanVectorSource(nextVectorSource);
        planVectorLayer.setSource(nextVectorSource);
      } else {
        currentVectorSource.clear();
        currentVectorSource.addFeatures(nextVectorSource.getFeatures());
      }

      planVectorLayer.changed();
      lastRenderedSpaceId = currentSpaceId;
      deps.syncBasemapUIBySpace(currentSpaceId);
      return { stale: false };
    }
  };

  return api;
});
