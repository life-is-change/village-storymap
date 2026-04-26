(function () {
  function getState(deps) {
    return deps.getBuildingEditState();
  }

  function getSource(deps) {
    return deps.getPlanVectorSource();
  }

  function getMap(deps) {
    return deps.getPlanMap();
  }

  function getLayer(deps) {
    return deps.getPlanVectorLayer();
  }

  async function checkBaseSpaceEditLock(deps) {
    const spaceId = deps.getCurrent2DBuildingSpaceId();
    if (!deps.isBaseSpace(spaceId)) return true;
    const lockResult = await deps.acquireCurrentSpaceEditLock();
    if (!lockResult.success) {
      if (lockResult.reason === "locked") {
        deps.showToast(`当前${lockResult.editorName || "其他用户"}正在编辑，请稍后再试。`, "error");
      } else {
        deps.showToast("编辑锁检测失败，请稍后再试。", "error");
      }
      return false;
    }
    return true;
  }

  function clearDrawSketchPreview(state, deps, options = {}) {
    const { restoreEdgeLabels = true } = options;

    if (
      state.drawSketchGeometry &&
      state.drawSketchGeometryChangeHandler &&
      typeof state.drawSketchGeometry.un === "function"
    ) {
      state.drawSketchGeometry.un("change", state.drawSketchGeometryChangeHandler);
    }

    state.drawSketchGeometry = null;
    state.drawSketchGeometryChangeHandler = null;

    if (restoreEdgeLabels && typeof deps.refreshBuildingEdgeLabels === "function") {
      deps.refreshBuildingEdgeLabels();
    }
  }

  const api = {
    getBuildingFeaturesOnMap(deps) {
      const source = getSource(deps);
      if (!source) return [];
      return source.getFeatures().filter((f) => f.get("layerKey") === "building");
    },

    getRoadFeaturesOnMap(deps) {
      const source = getSource(deps);
      if (!source) return [];
      return source.getFeatures().filter((f) => f.get("layerKey") === "road");
    },

    getFeaturesOnMapByLayer(deps, layerKey) {
      const source = getSource(deps);
      if (!source) return [];
      return source.getFeatures().filter((f) => f.get("layerKey") === layerKey);
    },

    async generateNextBuildingCode(deps, spaceId) {
      const state = getState(deps);
      let maxNum = 0;
      const updateMaxFromCode = (code) => {
        const matched = String(code || "").trim().match(/^H(\d+)$/i);
        if (!matched) return;
        maxNum = Math.max(maxNum, Number(matched[1]));
      };

      if (!Number.isFinite(state.nextBuildingSerial)) {
        if (!state.nextBuildingSerialPromise) {
          state.nextBuildingSerialPromise = (async () => {
            const dbRows = await deps.listBuildingFeaturesFromDbCached(spaceId, { force: true });
            dbRows.forEach((row) => updateMaxFromCode(row.object_code));
            api.getBuildingFeaturesOnMap(deps).forEach((feature) => {
              updateMaxFromCode(feature.get("sourceCode"));
            });
            state.nextBuildingSerial = maxNum + 1;
          })();
        }

        try {
          await state.nextBuildingSerialPromise;
        } finally {
          state.nextBuildingSerialPromise = null;
        }
      }

      const nextNum = Number.isFinite(state.nextBuildingSerial)
        ? state.nextBuildingSerial
        : 1;
      state.nextBuildingSerial = nextNum + 1;
      return `H${String(nextNum).padStart(3, "0")}`;
    },

    async generateNextRoadCode(deps, spaceId) {
      let maxNum = 0;
      const updateMaxFromCode = (code) => {
        const matched = String(code || "").trim().match(/^R(\d+)$/i);
        if (!matched) return;
        maxNum = Math.max(maxNum, Number(matched[1]));
      };

      const dbRows = await deps.listRoadFeaturesFromDbCached(spaceId, { force: true });
      dbRows.forEach((row) => updateMaxFromCode(row.object_code));
      api.getRoadFeaturesOnMap(deps).forEach((feature) => {
        updateMaxFromCode(feature.get("sourceCode"));
      });

      const nextNum = maxNum + 1;
      return `R${String(nextNum).padStart(3, "0")}`;
    },

    async generateNextGenericLayerCode(deps, layerKey, spaceId) {
      const prefix = deps.getLayerPrefix(layerKey);
      let maxNum = 0;
      const pattern = new RegExp(`^${prefix}(\\d+)$`, "i");
      const updateMaxFromCode = (code) => {
        const matched = String(code || "").trim().match(pattern);
        if (!matched) return;
        maxNum = Math.max(maxNum, Number(matched[1]));
      };

      let dbRows = [];
      if (layerKey === "cropland") {
        dbRows = await deps.listCroplandFeaturesFromDbCached(spaceId, { force: true });
      } else if (layerKey === "openSpace") {
        dbRows = await deps.listOpenSpaceFeaturesFromDbCached(spaceId, { force: true });
      }

      dbRows.forEach((row) => updateMaxFromCode(row.object_code));
      api.getFeaturesOnMapByLayer(deps, layerKey).forEach((feature) => {
        updateMaxFromCode(feature.get("sourceCode"));
      });

      const nextNum = maxNum + 1;
      return `${prefix}${String(nextNum).padStart(3, "0")}`;
    },

    markBuildingDirty(deps, feature) {
      const state = getState(deps);
      const layerKey = feature?.get("layerKey") || "building";
      const key = deps.buildDirtyFeatureKey(layerKey, feature?.get("sourceCode"));
      if (!key) return;
      state.dirtyCodes.add(key);
    },

    clearBuildingInteractions(deps, options = {}) {
      const { skipRestore = false } = options;
      const map = getMap(deps);
      const source = getSource(deps);
      const layer = getLayer(deps);
      const state = getState(deps);
      clearDrawSketchPreview(state, deps, { restoreEdgeLabels: true });
      if (!map) return;

      if (state.draw) {
        map.removeInteraction(state.draw);
        state.draw = null;
      }
      if (state.modify) {
        map.removeInteraction(state.modify);
        state.modify = null;
      }
      if (state.translate) {
        map.removeInteraction(state.translate);
        state.translate = null;
      }
      if (state.snap) {
        map.removeInteraction(state.snap);
        state.snap = null;
      }

      if (!skipRestore) {
        if (state.pendingAddedFeatures?.length) {
          state.pendingAddedFeatures.forEach((f) => {
            source?.removeFeature(f);
            const key = deps.buildDirtyFeatureKey(f.get("layerKey"), f.get("sourceCode"));
            if (key) state.dirtyCodes.delete(key);
          });
          state.pendingAddedFeatures = [];
        }

        if (state.pendingDeletedFeatures?.length) {
          state.pendingDeletedFeatures.forEach((f) => {
            source?.addFeature(f);
          });
          state.pendingDeletedFeatures = [];
        }

        if (state.originalGeoms?.size) {
          state.originalGeoms.forEach((geom, featureKey) => {
            const [layerKey, code] = String(featureKey || "").split("::");
            const features = api.getFeaturesOnMapByLayer(deps, layerKey);
            const feature = features.find((f) => deps.normalizeCode(f.get("sourceCode")) === code);
            if (feature) {
              feature.setGeometry(geom.clone());
            }
            if (featureKey) {
              state.dirtyCodes.delete(featureKey);
            }
          });
          state.originalGeoms.clear();
        }
      }

      state.isDrawingActive = false;
      state.mode = "idle";
      api.updateBuildingEditorToolbarState(deps);
      layer?.changed();

      // 停止编辑时释放现状空间编辑锁
      deps.releaseCurrentSpaceEditLock?.();
    },

    updateBuildingEditorToolbarState(deps) {
      const doc = deps.getDocument();
      const state = getState(deps);
      const btnTargetBuilding = doc.getElementById("btnTargetBuilding");
      const btnTargetRoad = doc.getElementById("btnTargetRoad");
      const btnTargetCropland = doc.getElementById("btnTargetCropland");
      const btnTargetOpenSpace = doc.getElementById("btnTargetOpenSpace");
      const btnAdd = doc.getElementById("btnAddBuilding");
      const btnModify = doc.getElementById("btnModifyBuilding");
      const btnMove = doc.getElementById("btnMoveBuilding");
      const btnRotate = doc.getElementById("btnRotateBuilding");
      const btnDelete = doc.getElementById("btnDeleteBuilding");
      const btnSave = doc.getElementById("btnSaveBuildingGeom");
      const btnStop = doc.getElementById("btnStopBuildingEdit");
      const saveRow = btnSave?.closest(".toolbar-row-save");
      const saveDivider = saveRow?.previousElementSibling?.classList.contains("toolbar-save-divider")
        ? saveRow.previousElementSibling
        : null;
      const actionGroup = doc.querySelector('[data-toolbar-group="action"]');
      const actionDivider = actionGroup?.previousElementSibling?.classList.contains("toolbar-action-divider")
        ? actionGroup.previousElementSibling
        : null;

      const allButtons = [btnTargetBuilding, btnTargetRoad, btnTargetCropland, btnTargetOpenSpace, btnAdd, btnModify, btnMove, btnRotate, btnDelete, btnSave, btnStop];
      allButtons.forEach((btn) => btn?.classList.remove("active"));

      const editable = deps.canEditCurrentSpace();
      const selectedLayers = deps.getSelectedLayersForCurrentSpace();
      const layerKey = deps.resolveGeometryEditLayer(selectedLayers);
      deps.setCurrentGeometryEditLayer(layerKey);
      state.editLayerKey = layerKey;
      if (!layerKey && state.mode !== "idle") {
        state.mode = "idle";
      }
      const hasSelectedEditLayer = deps.isEditableGeometryLayer(layerKey);
      const isRoadMode = layerKey === "road";
      const previousAddText = btnAdd?.textContent || "";
      const previousDeleteText = btnDelete?.textContent || "";
      actionGroup?.classList.toggle("is-visible", hasSelectedEditLayer);
      actionGroup?.setAttribute("aria-hidden", hasSelectedEditLayer ? "false" : "true");
      actionDivider?.classList.toggle("is-visible", hasSelectedEditLayer);

      const targetButtons = [
        { key: "building", btn: btnTargetBuilding },
        { key: "road", btn: btnTargetRoad },
        { key: "cropland", btn: btnTargetCropland },
        { key: "openSpace", btn: btnTargetOpenSpace }
      ];

      targetButtons.forEach(({ key, btn }) => {
        if (!btn) return;
        const enabled = editable && selectedLayers.includes(key);
        btn.disabled = !enabled;
        if (enabled && key === layerKey) btn.classList.add("active");
      });

      if (btnSave) {
        const canSave = editable && !(state.mode === "draw" && state.isDrawingActive);
        btnSave.disabled = !canSave;
      }
      [btnAdd, btnModify, btnMove, btnDelete].forEach((btn) => {
        if (btn && hasSelectedEditLayer) btn.disabled = !editable;
      });
      if (btnRotate) {
        if (hasSelectedEditLayer) btnRotate.disabled = !editable || isRoadMode;
      }

      if (btnAdd) btnAdd.textContent = isRoadMode ? "新增中心线" : "新增";
      if (btnDelete) btnDelete.textContent = isRoadMode ? "删除中心线" : "删除";

      if (!hasSelectedEditLayer) {
        if (btnAdd) btnAdd.textContent = previousAddText;
        if (btnDelete) btnDelete.textContent = previousDeleteText;
      }

      const mode = state.mode;
      const isEditing = mode !== "idle";
      saveRow?.classList.toggle("is-visible", isEditing);
      saveRow?.setAttribute("aria-hidden", isEditing ? "false" : "true");
      saveDivider?.classList.toggle("is-visible", isEditing);
      if (!isEditing) {
        if (btnSave) btnSave.disabled = true;
        if (btnStop) btnStop.disabled = true;
      } else if (btnStop) {
        btnStop.disabled = false;
      }

      if (mode === "draw") {
        btnAdd?.classList.add("active");
      } else if (mode === "delete") {
        btnDelete?.classList.add("active");
      } else if (mode === "modify" || mode === "modify-pending") {
        btnModify?.classList.add("active");
      } else if (mode === "translate" || mode === "translate-pending") {
        btnMove?.classList.add("active");
      } else if (mode === "rotate" || mode === "rotate-pending") {
        btnRotate?.classList.add("active");
      }
    },

    setGeometryEditLayer(deps, layerKey) {
      const selectedLayers = deps.getSelectedLayersForCurrentSpace();
      if (!deps.isEditableGeometryLayer(layerKey)) return;
      if (!selectedLayers.includes(layerKey)) {
        deps.showToast(`请先在图层中开启“${deps.getLayerLabel(layerKey)}”`, "info");
        return;
      }
      if (deps.getCurrentGeometryEditLayer() === layerKey) {
        deps.setCurrentGeometryEditLayer("");
        getState(deps).editLayerKey = "";
        api.clearBuildingInteractions(deps);
        api.updateBuildingEditorToolbarState(deps);
        return;
      }
      deps.setCurrentGeometryEditLayer(layerKey);
      api.clearBuildingInteractions(deps);
      api.updateBuildingEditorToolbarState(deps);
    },

    ensureBuildingEditorToolbar(deps) {
      const doc = deps.getDocument();
      const mount = doc.getElementById("toolboxToolbarMount");
      if (!mount) return;

      let toolbar = doc.getElementById("buildingEditorToolbar");

      if (!toolbar) {
        toolbar = doc.createElement("div");
        toolbar.id = "buildingEditorToolbar";

        toolbar.innerHTML = `
      <div class="toolbar-group is-expanded" data-toolbar-group="type">
        <button type="button" class="toolbar-group-title" data-toolbar-group-toggle="type">
          <svg class="toolbar-group-arrow" viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span>对象类型</span>
        </button>
        <div class="toolbar-group-body" data-toolbar-group-body="type">
          <div class="toolbar-row toolbar-row-center">
            <button type="button" id="btnTargetBuilding">建筑</button>
            <button type="button" id="btnTargetRoad">道路</button>
            <button type="button" id="btnTargetCropland">农田</button>
            <button type="button" id="btnTargetOpenSpace">公共空间</button>
          </div>
        </div>
      </div>
      <div class="toolbar-divider toolbar-action-divider"></div>
      <div class="toolbar-group is-expanded toolbar-action-group" data-toolbar-group="action" aria-hidden="true">
          <span>操作</span>
          <div class="toolbar-row toolbar-row-center">
            <button type="button" id="btnAddBuilding">新增</button>
            <button type="button" id="btnDeleteBuilding">删除</button>
            <button type="button" id="btnModifyBuilding">编辑顶点</button>
            <button type="button" id="btnMoveBuilding">移动</button>
            <button type="button" id="btnRotateBuilding">旋转</button>
          </div>
      </div>
      <div class="toolbar-divider toolbar-save-divider"></div>
      <div class="toolbar-row toolbar-row-center toolbar-row-save" aria-hidden="true">
        <button type="button" id="btnSaveBuildingGeom">保存编辑</button>
        <button type="button" id="btnStopBuildingEdit">退出编辑</button>
      </div>
    `;

        mount.innerHTML = "";
        mount.appendChild(toolbar);

        toolbar.querySelectorAll("[data-toolbar-group-toggle]").forEach((toggleBtn) => {
          toggleBtn.addEventListener("click", () => {
            const groupKey = toggleBtn.dataset.toolbarGroupToggle;
            const group = toolbar.querySelector(`[data-toolbar-group="${groupKey}"]`);
            if (group) {
              group.classList.toggle("is-expanded");
            }
          });
        });

        doc.getElementById("btnTargetBuilding")?.addEventListener("click", () => {
          api.setGeometryEditLayer(deps, "building");
        });

        doc.getElementById("btnTargetRoad")?.addEventListener("click", () => {
          api.setGeometryEditLayer(deps, "road");
        });
        doc.getElementById("btnTargetCropland")?.addEventListener("click", () => {
          api.setGeometryEditLayer(deps, "cropland");
        });
        doc.getElementById("btnTargetOpenSpace")?.addEventListener("click", () => {
          api.setGeometryEditLayer(deps, "openSpace");
        });

        doc.getElementById("btnAddBuilding")?.addEventListener("click", () => {
          api.startAddBuildingMode(deps, deps.getCurrentGeometryEditLayer());
        });

        doc.getElementById("btnDeleteBuilding")?.addEventListener("click", async () => {
          await api.startDeleteBuildingMode(deps, deps.getCurrentGeometryEditLayer());
        });

        doc.getElementById("btnModifyBuilding")?.addEventListener("click", () => {
          api.startModifyBuildingMode(deps, deps.getCurrentGeometryEditLayer());
        });

        doc.getElementById("btnMoveBuilding")?.addEventListener("click", async () => {
          await api.startTranslateBuildingMode(deps, deps.getCurrentGeometryEditLayer());
        });

        doc.getElementById("btnRotateBuilding")?.addEventListener("click", async () => {
          await api.startRotateBuildingMode(deps, deps.getCurrentGeometryEditLayer());
        });

        doc.getElementById("btnSaveBuildingGeom")?.addEventListener("click", async () => {
          await api.saveDirtyBuildings(deps, deps.getCurrentGeometryEditLayer());
        });

        doc.getElementById("btnStopBuildingEdit")?.addEventListener("click", () => {
          api.clearBuildingInteractions(deps);
        });
      } else if (toolbar.parentElement !== mount) {
        mount.innerHTML = "";
        mount.appendChild(toolbar);
      }

      deps.refreshCommunityScoreBadge();
      api.updateBuildingEditorToolbarState(deps);
    },

    async startAddBuildingMode(deps, layerKey = "building") {
      const state = getState(deps);
      const map = getMap(deps);
      const source = getSource(deps);
      const vectorLayer = getLayer(deps);
      if (!deps.isEditableSpace()) {
        deps.showToast("当前空间不可编辑，请确认登录状态及空间权限。", "error");
        return;
      }
      if (!(await checkBaseSpaceEditLock(deps))) return;

      if (!deps.isEditableGeometryLayer(layerKey)) return;
      if (!deps.getSelectedLayersForCurrentSpace().includes(layerKey)) {
        deps.showToast(`请先在图层中开启“${deps.getLayerLabel(layerKey)}”`, "error");
        return;
      }

      await deps.ensurePlanMap();
      api.clearBuildingInteractions(deps);
      state.pendingAddedFeatures = [];
      state.editLayerKey = layerKey;
      if (layerKey === "building") {
        state.nextBuildingSerial = null;
        state.nextBuildingSerialPromise = null;
      }

      const OL = await deps.getOlReady();
      const { Draw, Snap } = OL;

      state.draw = new Draw({
        source,
        type: deps.getDrawTypeForLayer(layerKey)
      });

      state.snap = new Snap({
        source
      });

      state.draw.on("drawstart", (evt) => {
        state.isDrawingActive = true;
        clearDrawSketchPreview(state, deps, { restoreEdgeLabels: false });
        const sketchGeometry = evt.feature?.getGeometry?.();
        if (sketchGeometry && typeof sketchGeometry.on === "function") {
          const handleSketchChange = () => {
            deps.refreshDrawingEdgeLengthPreview?.(sketchGeometry);
          };
          state.drawSketchGeometry = sketchGeometry;
          state.drawSketchGeometryChangeHandler = handleSketchChange;
          sketchGeometry.on("change", handleSketchChange);
          handleSketchChange();
        }
        api.updateBuildingEditorToolbarState(deps);
      });

      state.draw.on("drawabort", () => {
        clearDrawSketchPreview(state, deps, { restoreEdgeLabels: true });
        state.isDrawingActive = false;
        api.updateBuildingEditorToolbarState(deps);
      });

      state.draw.on("drawend", async (evt) => {
        clearDrawSketchPreview(state, deps, { restoreEdgeLabels: false });
        const feature = evt.feature;
        let nextCode = "";
        if (layerKey === "road") {
          nextCode = await api.generateNextRoadCode(deps, deps.getCurrent2DBuildingSpaceId());
        } else if (layerKey === "building") {
          nextCode = await api.generateNextBuildingCode(deps, deps.getCurrent2DBuildingSpaceId());
        } else {
          nextCode = await api.generateNextGenericLayerCode(deps, layerKey, deps.getCurrent2DBuildingSpaceId());
        }

        feature.set("layerKey", layerKey);
        feature.set("sourceCode", nextCode);
        feature.set("displayName", nextCode);
        if (layerKey === "road") {
          feature.set("baseRow", {
            道路编码: nextCode,
            道路名称: nextCode,
            道路宽度: deps.ROAD_DEFAULT_WIDTH
          });
        } else {
          const codeField = deps.getLayerCodeField(layerKey);
          const nameField = deps.getLayerNameField(layerKey);
          feature.set("baseRow", {
            [codeField]: nextCode,
            [nameField]: nextCode
          });
        }
        feature.set("rawFeature", null);

        api.markBuildingDirty(deps, feature);
        deps.setActiveFeature(feature);
        state.pendingAddedFeatures.push(feature);
        state.isDrawingActive = false;
        vectorLayer?.changed();
        api.updateBuildingEditorToolbarState(deps);
      });

      map.addInteraction(state.draw);
      map.addInteraction(state.snap);
      state.mode = "draw";
      deps.showToast(layerKey === "road" ? "点击空白处绘制道路中心线" : `点击空白处即可新增${deps.getLayerLabel(layerKey)}`, "info");
      api.updateBuildingEditorToolbarState(deps);
    },

    async startModifyBuildingMode(deps, layerKey = "building") {
      const state = getState(deps);
      if (!deps.isEditableSpace()) {
        deps.showToast("当前空间不可编辑，请确认登录状态及空间权限。", "error");
        return;
      }
      if (!(await checkBaseSpaceEditLock(deps))) return;

      await deps.ensurePlanMap();
      api.clearBuildingInteractions(deps);
      state.originalGeoms.clear();
      state.editLayerKey = layerKey;

      state.mode = "modify-pending";
      deps.showToast(layerKey === "road" ? "点击道路中心线即可编辑顶点" : `点击${deps.getLayerLabel(layerKey)}即可编辑顶点`, "info");
      api.updateBuildingEditorToolbarState(deps);
    },

    async startTranslateBuildingMode(deps, layerKey = "building") {
      const state = getState(deps);
      if (!deps.isEditableSpace()) {
        deps.showToast("当前空间不可编辑，请确认登录状态及空间权限。", "error");
        return;
      }
      if (!(await checkBaseSpaceEditLock(deps))) return;

      await deps.ensurePlanMap();
      api.clearBuildingInteractions(deps);
      state.originalGeoms.clear();
      state.editLayerKey = layerKey;

      state.mode = "translate-pending";
      deps.showToast(layerKey === "road" ? "点击道路后拖动即可移动" : `点击${deps.getLayerLabel(layerKey)}后拖动即可移动`, "info");
      api.updateBuildingEditorToolbarState(deps);
    },

    async startRotateBuildingMode(deps, layerKey = "building") {
      const state = getState(deps);
      if (!deps.isEditableSpace()) {
        deps.showToast("当前空间不可编辑，请确认登录状态及空间权限。", "error");
        return;
      }
      if (!(await checkBaseSpaceEditLock(deps))) return;

      if (layerKey === "road") {
        deps.showToast("道路中心线不支持旋转，请使用移动/编辑顶点。", "info");
        return;
      }

      await deps.ensurePlanMap();
      api.clearBuildingInteractions(deps);
      state.originalGeoms.clear();
      state.editLayerKey = layerKey;

      state.mode = "rotate-pending";
      deps.showToast(`点击${deps.getLayerLabel(layerKey)}即可旋转角度`, "info");
      api.updateBuildingEditorToolbarState(deps);
    },

    async startDeleteBuildingMode(deps, layerKey = "building") {
      const state = getState(deps);
      if (!deps.isEditableSpace()) {
        deps.showToast("当前空间不可编辑，请确认登录状态及空间权限。", "error");
        return;
      }
      if (!(await checkBaseSpaceEditLock(deps))) return;

      await deps.ensurePlanMap();
      api.clearBuildingInteractions(deps);
      state.pendingDeletedFeatures = [];
      state.editLayerKey = layerKey;

      state.mode = "delete";
      deps.showToast(layerKey === "road" ? "点击道路中心线即可删除" : `点击${deps.getLayerLabel(layerKey)}即可删除`, "info");
      api.updateBuildingEditorToolbarState(deps);
    },

    async saveDirtyBuildings(deps, layerKey = "building") {
      const state = getState(deps);
      if (!deps.isEditableSpace()) {
        deps.showToast("当前空间不可编辑，请确认登录状态及空间权限。", "error");
        return;
      }
      if (!deps.isEditableGeometryLayer(layerKey)) return;
      const layerLabel = deps.getLayerLabel(layerKey);

      if (state.mode === "draw" && state.isDrawingActive) {
        deps.showToast(`请先完成当前${layerKey === "road" ? "道路" : layerLabel}的绘制`, "info");
        return;
      }

      api.clearBuildingInteractions(deps, { skipRestore: true });

      const spaceId = deps.getCurrent2DBuildingSpaceId();
      const features = api.getFeaturesOnMapByLayer(deps, layerKey);
      const targetFeatures = features.filter((feature) => {
        const key = deps.buildDirtyFeatureKey(layerKey, feature.get("sourceCode"));
        return state.dirtyCodes.has(key);
      });

      const hasPendingDelete = (state.pendingDeletedFeatures || [])
        .some((feature) => feature.get("layerKey") === layerKey);

      if (!targetFeatures.length && !hasPendingDelete) {
        deps.showToast(`当前没有待保存的${layerKey === "road" ? "道路" : layerLabel}修改。`, "info");
        return;
      }

      try {
        const codeField = deps.getLayerCodeField(layerKey);
        const nameField = deps.getLayerNameField(layerKey);
        for (const feature of targetFeatures) {
          const code = deps.normalizeCode(feature.get("sourceCode"));
          const baseRow = feature.get("baseRow") || {};
          const props = deps.cloneJson(baseRow || {});
          const geom = deps.olFeatureToDbGeometry(feature);

          if (layerKey === "road") {
            props.道路编码 = code;
            props.道路名称 = props.道路名称 || code;
            props.道路宽度 =
              props.width ||
              props.道路宽度 ||
              props.宽度 ||
              props.road_width ||
              props.WIDTH ||
              props["閬撹矾瀹斤拷"] ||
              deps.ROAD_DEFAULT_WIDTH;
          } else {
            props[codeField] = code;
            props[nameField] = props[nameField] || code;
          }
          await deps.upsertLayerFeatureToDb({
            spaceId,
            layerKey,
            objectCode: code,
            objectName: props[nameField] || props.道路名称 || props.房屋名称 || code,
            geom,
            props
          });
        }

        for (const feature of (state.pendingDeletedFeatures || [])) {
          if (feature.get("layerKey") !== layerKey) continue;
          const code = deps.normalizeCode(feature.get("sourceCode"));
          if (code) {
            await deps.softDeleteLayerFeatureInDb(spaceId, layerKey, code);
          }
        }

        state.dirtyCodes.clear();
        state.deletedCodes.clear();
        state.pendingDeletedFeatures = [];
        state.pendingAddedFeatures = [];
        state.originalGeoms.clear();

        await deps.refresh2DOverlay();

        deps.sync2DSpaceStateTo3D();

        const village3D = deps.getVillage3D();
        if (village3D && typeof village3D.reload === "function") {
          await village3D.reload();
        }

        deps.showToast(`${layerLabel}保存成功`, "success");

        // 保存成功后释放现状空间编辑锁
        deps.releaseCurrentSpaceEditLock?.();
      } catch (error) {
        console.error(error);
        deps.showToast(`${layerLabel}保存失败，请查看控制台`, "error");
      }
    }
  };

  window.GeometryEditorModule = api;
})();
