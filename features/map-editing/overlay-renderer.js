(function () {
  const api = {
    async refresh2DOverlay(deps) {
      const plan2dView = deps.getPlan2DView();
      if (!plan2dView?.classList.contains("active")) return;

      const currentSpaceId = deps.getCurrentSpaceId();
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
      deps.setActiveFeature(null);

      const selectedLayers = deps.getSelectedLayersForCurrentSpace();
      const effectiveLayerKeys = selectedLayers.includes("figureGround")
        ? ["elevationBands", "contours", "water", "road", "building"]
        : [...selectedLayers];

      const format = new GeoJSON();

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

      for (const layerKey of effectiveLayerKeys) {
        try {
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

      if (typeof deps.setPlanVectorSource === "function" && typeof planVectorLayer.setSource === "function") {
        deps.setPlanVectorSource(nextVectorSource);
        planVectorLayer.setSource(nextVectorSource);
      } else {
        currentVectorSource.clear();
        currentVectorSource.addFeatures(nextVectorSource.getFeatures());
      }

      try {
        await deps.refreshCommunityTasksOnMap(format);
      } catch (taskLayerError) {
        console.warn("问题标记图层刷新失败（不影响基础图层）：", taskLayerError);
      }

      planVectorLayer.changed();
      deps.syncBasemapUIBySpace(currentSpaceId);
    }
  };

  window.OverlayRendererModule = api;
})();
