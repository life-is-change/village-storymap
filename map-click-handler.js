(function () {
  function pickInteractiveFeatureAtPixel(planMap, pixel, isNonInteractiveLayerKey) {
    let clicked = null;
    planMap.forEachFeatureAtPixel(pixel, (feature) => {
      const layerKey = feature?.get?.("layerKey");
      if (isNonInteractiveLayerKey(layerKey)) return false;
      clicked = feature;
      return true;
    });
    return clicked;
  }

  async function bindModifyInteraction(deps, clicked, editLayerKey) {
    const buildingEditState = deps.getBuildingEditState();
    deps.setActiveFeature(clicked);
    const code = deps.normalizeCode(clicked.get("sourceCode"));
    const featureKey = deps.buildDirtyFeatureKey(editLayerKey, code);
    if (featureKey && !buildingEditState.originalGeoms.has(featureKey)) {
      buildingEditState.originalGeoms.set(featureKey, clicked.getGeometry().clone());
    }

    const OL = await deps.getOlReady();
    const { Modify, Snap, Collection } = OL;
    deps.clearBuildingInteractions({ skipRestore: true });

    buildingEditState.modify = new Modify({
      features: new Collection([clicked])
    });
    buildingEditState.snap = new Snap({ source: deps.getPlanVectorSource() });
    buildingEditState.modify.on("modifystart", () => {
      deps.setCurrentInfoMode("readonly");
    });
    buildingEditState.modify.on("modifyend", (evt) => {
      evt.features.forEach((feature) => deps.markBuildingDirty(feature));
      deps.getPlanVectorLayer()?.changed();
    });

    deps.getPlanMap().addInteraction(buildingEditState.modify);
    deps.getPlanMap().addInteraction(buildingEditState.snap);
    buildingEditState.mode = "modify";
    deps.updateBuildingEditorToolbarState();
  }

  async function bindTranslateInteraction(deps, clicked, editLayerKey) {
    const buildingEditState = deps.getBuildingEditState();
    deps.setActiveFeature(clicked);
    const code = deps.normalizeCode(clicked.get("sourceCode"));
    const featureKey = deps.buildDirtyFeatureKey(editLayerKey, code);
    if (featureKey && !buildingEditState.originalGeoms.has(featureKey)) {
      buildingEditState.originalGeoms.set(featureKey, clicked.getGeometry().clone());
    }

    const OL = await deps.getOlReady();
    const { Translate, Collection } = OL;
    deps.clearBuildingInteractions({ skipRestore: true });

    buildingEditState.translate = new Translate({
      features: new Collection([clicked])
    });
    buildingEditState.translate.on("translatestart", () => {
      deps.setCurrentInfoMode("readonly");
    });
    buildingEditState.translate.on("translateend", (evt) => {
      evt.features.forEach((feature) => deps.markBuildingDirty(feature));
      deps.getPlanVectorLayer()?.changed();
    });

    deps.getPlanMap().addInteraction(buildingEditState.translate);
    buildingEditState.mode = "translate";
    deps.updateBuildingEditorToolbarState();
  }

  async function runRotateAction(deps, clicked, editLayerKey) {
    const buildingEditState = deps.getBuildingEditState();
    deps.setActiveFeature(clicked);
    const code = deps.normalizeCode(clicked.get("sourceCode"));
    const featureKey = deps.buildDirtyFeatureKey(editLayerKey, code);
    if (featureKey && !buildingEditState.originalGeoms.has(featureKey)) {
      buildingEditState.originalGeoms.set(featureKey, clicked.getGeometry().clone());
    }

    const angleText = await deps.customPrompt(
      "请输入旋转角度（单位：度，顺时针可输入负数）",
      "15",
      `旋转${deps.getLayerLabel(editLayerKey)}`
    );
    if (angleText == null) {
      return;
    }
    const angleDeg = Number(angleText);
    if (!Number.isFinite(angleDeg)) {
      deps.showToast("请输入有效数字", "error");
      return;
    }
    const geometry = clicked.getGeometry();
    if (geometry) {
      const extent = geometry.getExtent();
      const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
      geometry.rotate((angleDeg * Math.PI) / 180, center);
      deps.markBuildingDirty(clicked);
      deps.getPlanVectorLayer()?.changed();
    }
    buildingEditState.mode = "rotate";
    deps.updateBuildingEditorToolbarState();
  }

  async function handleCommunityTaskReport(deps, evt) {
    const communityTaskEditState = deps.getCommunityTaskEditState();

    if (!deps.getCurrentUserName()) {
      deps.showToast("请先确认账号后再上报任务。", "error");
      communityTaskEditState.mode = "idle";
      deps.syncCommunityTaskUiState?.();
      return true;
    }

    const coord = evt.coordinate;
    const lng = Number(coord?.[0]);
    const lat = Number(coord?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      deps.showToast("坐标无效，请重试。", "error");
      communityTaskEditState.mode = "idle";
      deps.syncCommunityTaskUiState?.();
      return true;
    }

    const taskMeta = deps.getCommunityTaskTypeMeta(communityTaskEditState.category);
    const desc = await deps.customPrompt(`请输入${taskMeta.label}描述（至少填写一些文字）`, "", taskMeta.promptTitle, {
      requireNonEmpty: true,
      maxLength: 120
    });
    if (desc === null) {
      communityTaskEditState.mode = "idle";
      deps.syncCommunityTaskUiState?.();
      deps.showToast("已取消上报。", "info");
      return true;
    }

    const safeDesc = String(desc || "").trim();
    if (!safeDesc) {
      communityTaskEditState.mode = "idle";
      deps.syncCommunityTaskUiState?.();
      deps.showToast("描述不能为空，请至少填写一些文字。", "error");
      return true;
    }

    let reportPhotoFile = null;
    if (deps.isCommunityTaskPhotoRequired(communityTaskEditState.category)) {
      deps.showToast("该任务类型必须上传现场照片。", "info");
      reportPhotoFile = await deps.pickImageFile();
      if (!reportPhotoFile) {
        communityTaskEditState.mode = "idle";
        deps.syncCommunityTaskUiState?.();
        deps.showToast("已取消上报：未选择照片。", "error");
        return true;
      }
    }

    try {
      const createdTask = await deps.createCommunityTask({
        spaceId: deps.getCurrentSpaceId(),
        reporterName: deps.getCurrentUserName(),
        lng,
        lat,
        category: communityTaskEditState.category || "garbage",
        description: safeDesc
      });

      if (reportPhotoFile) {
        try {
          await deps.uploadObjectPhoto(
            reportPhotoFile,
            deps.getCommunityTaskPhotoObjectCode(createdTask.id),
            deps.COMMUNITY_TASK_PHOTO_OBJECT_TYPE,
            deps.getCurrentUserName()
          );
        } catch (photoError) {
          const supabaseClient = deps.getSupabaseClient();
          await supabaseClient
            .from(deps.COMMUNITY_TASKS_TABLE)
            .delete()
            .eq("id", createdTask.id);
          throw new Error("现场照片上传失败，本次上报已取消。请重试。");
        }
      }

      communityTaskEditState.mode = "idle";
      deps.syncCommunityTaskUiState?.();

      try {
        const OL = await deps.getOlReady();
        const format = new OL.GeoJSON();
        deps.addCommunityTaskFeatureToMap(createdTask, format);
        deps.getPlanVectorLayer()?.changed();
      } catch (_) {
      }

      deps.invalidateCommunityTaskCache(deps.getCurrentSpaceId());
      await deps.refreshCommunityScoreBadge();
      deps.showToast(`${taskMeta.label}提交成功，等待他人核实。`, "success");
    } catch (error) {
      communityTaskEditState.mode = "idle";
      deps.syncCommunityTaskUiState?.();
      deps.showToast(error?.message || "上报失败，请查看控制台。", "error");
      console.error(error);
    }

    return true;
  }

  const api = {
    async handlePlanMapSingleClick(deps, evt) {
      if (typeof deps.is2DMeasureActive === "function" && deps.is2DMeasureActive()) {
        return;
      }

      const planMap = deps.getPlanMap();
      const planVectorLayer = deps.getPlanVectorLayer();
      const planVectorSource = deps.getPlanVectorSource();
      const buildingEditState = deps.getBuildingEditState();
      const communityTaskEditState = deps.getCommunityTaskEditState();

      const clicked = pickInteractiveFeatureAtPixel(planMap, evt.pixel, deps.isNonInteractiveLayerKey);

      if (communityTaskEditState.mode === "report") {
        const handled = await handleCommunityTaskReport(deps, evt);
        if (handled) return;
      }

      const editLayerKey = buildingEditState.editLayerKey || deps.getCurrentGeometryEditLayer() || "building";

      if (
        buildingEditState.mode === "idle" &&
        clicked &&
        clicked.get("layerKey") === "communityTask"
      ) {
        deps.setActiveFeature(clicked);
        planVectorLayer?.changed();
        await deps.showCommunityTaskInfo(clicked.get("taskRow"));
        return;
      }

      if (buildingEditState.mode === "delete") {
        if (!clicked || clicked.get("layerKey") !== editLayerKey) return;
        planVectorSource.removeFeature(clicked);
        buildingEditState.pendingDeletedFeatures.push(clicked);
        if (deps.getActiveFeature() === clicked) {
          deps.setActiveFeature(null);
          deps.setCurrentSelectedObject(null);
          deps.setActive2DSelectedCode(null);
        }
        planVectorLayer.changed();
        return;
      }

      if (buildingEditState.mode === "modify-pending" || buildingEditState.mode === "modify") {
        if (!clicked || clicked.get("layerKey") !== editLayerKey) {
          deps.showToast(`请选择一个${deps.getLayerLabel(editLayerKey)}要素`, "info");
          return;
        }
        await bindModifyInteraction(deps, clicked, editLayerKey);
        return;
      }

      if (buildingEditState.mode === "translate-pending" || buildingEditState.mode === "translate") {
        if (!clicked || clicked.get("layerKey") !== editLayerKey) {
          deps.showToast(`请选择一个${deps.getLayerLabel(editLayerKey)}要素`, "info");
          return;
        }
        await bindTranslateInteraction(deps, clicked, editLayerKey);
        return;
      }

      if (buildingEditState.mode === "rotate-pending" || buildingEditState.mode === "rotate") {
        if (!clicked || clicked.get("layerKey") !== editLayerKey) {
          deps.showToast(`请选择一个${deps.getLayerLabel(editLayerKey)}要素`, "info");
          return;
        }
        await runRotateAction(deps, clicked, editLayerKey);
        return;
      }

      if (!clicked) {
        deps.setActiveFeature(null);
        deps.setCurrentSelectedObject(null);
        deps.setActive2DSelectedCode(null);
        deps.setCurrentInfoMode("readonly");
        planVectorLayer.changed();
        deps.update2DStatusText();
        deps.showPlan2DOverview();
        return;
      }

      deps.setActiveFeature(clicked);
      planVectorLayer.changed();

      const layerKey = clicked.get("layerKey");
      const sourceCode = clicked.get("sourceCode");
      const featureData = clicked.get("rawFeature");
      const baseRow = clicked.get("baseRow") || null;

      deps.setCurrentSelectedObject({
        layerKey,
        sourceCode,
        displayName: clicked.get("displayName") || sourceCode || "未命名对象",
        rawFeature: clicked || featureData || null
      });
      deps.setActive2DSelectedCode(sourceCode);

      deps.setCurrentInfoMode("readonly");
      deps.update2DStatusText();

      if (layerKey === "figureGround") {
        deps.showFigureGroundInfo();
        return;
      }

      const effectiveRow = baseRow || deps.buildFallbackObjectRow(sourceCode, layerKey, featureData);
      await deps.showObjectInfo(effectiveRow, layerKey, sourceCode);
    }
  };

  window.MapClickHandlerModule = api;
})();
