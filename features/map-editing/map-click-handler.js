(function () {
  async function acquireSelectedFeatureLock(deps, feature, layerKey) {
    const objectCode = deps.normalizeCode(feature?.get?.("sourceCode"));
    const result = await deps.acquireFeatureEditLock(layerKey, objectCode);
    if (result?.success) return true;
    if (result?.reason === "locked") {
      deps.showToast(`${result.editorName || "其他同学"}正在编辑该要素，请选择其他要素或稍后再试。`, "error");
    } else {
      deps.showToast("暂时无法取得该要素的编辑权，请检查数据库连接后重试。", "error");
    }
    return false;
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
    deps.clearBuildingInteractions({ skipRestore: true, skipReleaseLock: true });

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
      deps.refreshBuildingEdgeLabels();
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
    deps.clearBuildingInteractions({ skipRestore: true, skipReleaseLock: true });

    buildingEditState.translate = new Translate({
      features: new Collection([clicked])
    });
    buildingEditState.translate.on("translatestart", () => {
      deps.setCurrentInfoMode("readonly");
    });
    buildingEditState.translate.on("translateend", (evt) => {
      evt.features.forEach((feature) => deps.markBuildingDirty(feature));
      deps.getPlanVectorLayer()?.changed();
      deps.refreshBuildingEdgeLabels();
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
      "默认为顺时针，输入负数可逆时针旋转",
      "",
      "旋转角度（°）",
      {
        emptyError: "请输入旋转角度"
      }
    );
    if (angleText == null) {
      await deps.releaseFeatureEditLock(editLayerKey, code);
      return;
    }
    const angleDeg = Number(angleText);
    if (!Number.isFinite(angleDeg)) {
      deps.showToast("请输入有效数字", "error");
      await deps.releaseFeatureEditLock(editLayerKey, code);
      return;
    }
    const geometry = clicked.getGeometry();
    if (geometry) {
      const extent = geometry.getExtent();
      const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
      geometry.rotate((-angleDeg * Math.PI) / 180, center);
      deps.markBuildingDirty(clicked);
      deps.getPlanVectorLayer()?.changed();
      deps.refreshBuildingEdgeLabels();
    }
    buildingEditState.mode = "rotate";
    deps.updateBuildingEditorToolbarState();
  }

  async function handleCommunityTaskReport(deps, evt) {
    const communityTaskEditState = deps.getCommunityTaskEditState();

    if (!deps.getCurrentUserName()) {
      deps.showToast("请先登录后再发布留言", "error");
      communityTaskEditState.mode = "idle";
      deps.syncCommunityTaskUiState?.();
      return true;
    }

    const pending = communityTaskEditState.pendingPayload;
    if (!pending) {
      deps.showToast("发布参数丢失，请重新发布", "error");
      communityTaskEditState.mode = "idle";
      deps.syncCommunityTaskUiState?.();
      return true;
    }

    const coord = evt.coordinate;
    const lng = Number(coord?.[0]);
    const lat = Number(coord?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      deps.showToast("坐标无效，请重新选择位置", "error");
      return true;
    }

    await deps.submitCommunityMessage({
      category: pending.category,
      description: pending.description,
      photoFile: pending.photoFile,
      lng,
      lat
    });

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
      const editLayerKey = buildingEditState.editLayerKey || deps.getCurrentGeometryEditLayer() || "building";
      const deleteLayerKey = buildingEditState.mode === "delete" ? editLayerKey : "";
      const clicked = window.MapHitPolicyModule.pickFeatureAtPixel(
        planMap,
        evt.pixel,
        deps.isNonInteractiveLayerKey,
        deleteLayerKey
      );

      if (communityTaskEditState.mode === "report") {
        const handled = await handleCommunityTaskReport(deps, evt);
        if (handled) return;
      }

      // 问题点与普通要素在统一工作区中同时可交互。
      if (clicked && clicked.get("layerKey") === "communityTask") {
        deps.setActiveFeature(clicked);
        planVectorLayer?.changed();
        const taskRow = clicked.get("taskRow");
        if (taskRow?.id) {
          deps.scrollToAndHighlightMessage?.(taskRow.id);
        }
        return;
      }

      if (buildingEditState.mode === "delete") {
        if (!clicked || clicked.get("layerKey") !== editLayerKey) return;
        if (!(await acquireSelectedFeatureLock(deps, clicked, editLayerKey))) return;
        planVectorSource.removeFeature(clicked);
        buildingEditState.pendingDeletedFeatures.push(clicked);
        if (deps.getActiveFeature() === clicked) {
          deps.setActiveFeature(null);
          deps.setCurrentSelectedObject(null);
          deps.setActive2DSelectedCode(null);
        }
        planVectorLayer.changed();
        deps.updateBuildingEditorToolbarState();
        return;
      }

      if (buildingEditState.mode === "modify-pending" || buildingEditState.mode === "modify") {
        if (!clicked || clicked.get("layerKey") !== editLayerKey) {
          deps.showToast(`请选择一个${deps.getLayerLabel(editLayerKey)}要素`, "info");
          return;
        }
        if (!(await acquireSelectedFeatureLock(deps, clicked, editLayerKey))) return;
        await bindModifyInteraction(deps, clicked, editLayerKey);
        return;
      }

      if (buildingEditState.mode === "translate-pending" || buildingEditState.mode === "translate") {
        if (!clicked || clicked.get("layerKey") !== editLayerKey) {
          deps.showToast(`请选择一个${deps.getLayerLabel(editLayerKey)}要素`, "info");
          return;
        }
        if (!(await acquireSelectedFeatureLock(deps, clicked, editLayerKey))) return;
        await bindTranslateInteraction(deps, clicked, editLayerKey);
        return;
      }

      if (buildingEditState.mode === "rotate-pending" || buildingEditState.mode === "rotate") {
        if (!clicked || clicked.get("layerKey") !== editLayerKey) {
          deps.showToast(`请选择一个${deps.getLayerLabel(editLayerKey)}要素`, "info");
          return;
        }
        if (!(await acquireSelectedFeatureLock(deps, clicked, editLayerKey))) return;
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
