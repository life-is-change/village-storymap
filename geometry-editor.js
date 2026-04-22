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

      const allButtons = [btnTargetBuilding, btnTargetRoad, btnTargetCropland, btnTargetOpenSpace, btnAdd, btnModify, btnMove, btnRotate, btnDelete, btnSave, btnStop];
      allButtons.forEach((btn) => btn?.classList.remove("active"));

      const editable = deps.canEditCurrentSpace();
      const selectedLayers = deps.getSelectedLayersForCurrentSpace();
      const layerKey = deps.resolveGeometryEditLayer(selectedLayers);
      deps.setCurrentGeometryEditLayer(layerKey);
      const isRoadMode = layerKey === "road";

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
        if (key === layerKey) btn.classList.add("active");
      });

      if (btnSave) {
        const canSave = editable && !(state.mode === "draw" && state.isDrawingActive);
        btnSave.disabled = !canSave;
      }
      [btnAdd, btnModify, btnMove, btnDelete].forEach((btn) => {
        if (btn) btn.disabled = !editable;
      });
      if (btnRotate) {
        btnRotate.disabled = !editable || isRoadMode;
      }

      if (btnAdd) btnAdd.textContent = isRoadMode ? "新增中心线" : "新增";
      if (btnDelete) btnDelete.textContent = isRoadMode ? "删除中心线" : "删除";

      if (btnStop) btnStop.disabled = false;

      const mode = state.mode;
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

      if (mode !== "idle") {
        btnSave?.classList.add("active");
        btnStop?.classList.add("active");
      }
    },

    setGeometryEditLayer(deps, layerKey) {
      const selectedLayers = deps.getSelectedLayersForCurrentSpace();
      if (!deps.isEditableGeometryLayer(layerKey)) return;
      if (!selectedLayers.includes(layerKey)) {
        deps.showToast(`请先在图层中勾选“${deps.getLayerLabel(layerKey)}”`, "info");
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
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnTargetBuilding">建筑</button>
        <button type="button" id="btnTargetRoad">道路</button>
      </div>
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnTargetCropland">农田</button>
        <button type="button" id="btnTargetOpenSpace">公共空间</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnAddBuilding">新增</button>
        <button type="button" id="btnDeleteBuilding">删除</button>
      </div>
      <div class="toolbar-row">
        <button type="button" id="btnModifyBuilding">编辑顶点</button>
        <button type="button" id="btnMoveBuilding">移动</button>
        <button type="button" id="btnRotateBuilding">旋转</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnSaveBuildingGeom">保存编辑</button>
        <button type="button" id="btnStopBuildingEdit">退出编辑</button>
      </div>

    `;

        mount.innerHTML = "";
        mount.appendChild(toolbar);

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
        deps.showToast("现状空间为只读，不能新增要素。", "error");
        return;
      }

      if (!deps.isEditableGeometryLayer(layerKey)) return;
      if (!deps.getSelectedLayersForCurrentSpace().includes(layerKey)) {
        deps.showToast(`请先在图层中勾选“${deps.getLayerLabel(layerKey)}”`, "error");
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

      state.draw.on("drawstart", () => {
        state.isDrawingActive = true;
        api.updateBuildingEditorToolbarState(deps);
      });

      state.draw.on("drawend", async (evt) => {
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
        deps.showToast("现状空间为只读，不能修改要素。", "error");
        return;
      }

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
        deps.showToast("现状空间为只读，不能移动要素。", "error");
        return;
      }

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
        deps.showToast("现状空间为只读，不能旋转要素。", "error");
        return;
      }

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
        deps.showToast("现状空间为只读，不能删除要素。", "error");
        return;
      }

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
        deps.showToast("现状空间为只读，不能保存要素。", "error");
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
      } catch (error) {
        console.error(error);
        deps.showToast(`${layerLabel}保存失败，请查看控制台`, "error");
      }
    }
  };

  window.GeometryEditorModule = api;
})();
