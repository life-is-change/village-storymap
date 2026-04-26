(function () {
  const api = {
    async handleSpaceSelect(deps, spaceId) {
      const isSpaceChanged = deps.getCurrentSpaceId() !== spaceId;
      deps.clearBuildingInteractions?.();
      deps.setCurrentSpaceId(spaceId);
      deps.setCurrentSelectedObject(null);
      deps.setCurrentInfoMode("readonly");
      deps.setCurrentGeometryEditLayer(
        deps.resolveGeometryEditLayer(deps.getSelectedLayersForCurrentSpace())
      );
      deps.saveSpacesToStorage();
      deps.sync2DSpaceStateTo3D();
      deps.renderSpaceList();
      deps.ensureBuildingEditorToolbar();
      deps.ensureCommunityBuildPanel();
      deps.updateBuildingEditorToolbarState();
      deps.syncBasemapUIBySpace(spaceId);

      const space = deps.getCurrentSpace();
      if (space.viewMode === "2d") {
        if (isSpaceChanged) {
          window.__hasInitialZoomed = false;
        }
        await api.switchTo2DView(deps);
      } else {
        await api.switchTo3DView(deps);
      }
    },

    async switchTo2DView(deps) {
      deps.setActiveStoryItem("planningSpace");
      deps.switchMainView("plan2d");
      deps.syncBasemapUIBySpace(deps.getCurrentSpaceId());
      deps.update2DStatusText();

      const map = await deps.ensurePlanMap();
      if (map && !window.__hasInitialZoomed) {
        const view = map.getView();
        const georef = deps.getActiveBasemapGeoref() || deps.BASEMAP_GEOREF;
        const center = [
          (georef.minX + georef.maxX) / 2,
          (georef.minY + georef.maxY) / 2
        ];
        view.setCenter(center);
        view.setZoom(deps.DEFAULT_VILLAGE_VIEW_ZOOM ?? 17.5);
        window.__hasInitialZoomed = true;
      }

      const isPlanningMode = deps.getIsPlanningMode ? deps.getIsPlanningMode() : true;
      // 控制右侧栏标题显示
      const detailPanel = document.querySelector(".detail-panel");
      if (detailPanel) {
        const header = detailPanel.querySelector(".panel-header");
        if (header) header.style.display = isPlanningMode ? "" : "none";
      }

      if (!deps.getCurrentSelectedObject()) {
        if (!isPlanningMode) {
          await deps.refreshCommunityMessageBoard?.();
        } else {
          const selectedLayers = deps.getSelectedLayersForCurrentSpace();
          const infoPanel = deps.getInfoPanel();
          infoPanel.classList.remove("empty");
          if (!selectedLayers.length) {
            infoPanel.innerHTML = `
          <div class="placeholder-block">
            <h3>当前未显示任何图层</h3>
            <p>你已将当前空间中的所有图层关闭。</p>
            <p>可在左侧重新点击任意图层按钮，恢复显示。</p>
          </div>
        `;
          } else {
            infoPanel.innerHTML = `
          <div class="placeholder-block">
            <h3>村庄 2D 图层</h3>
            <p>可在左侧空间中切换不同图层组合，并点击地图中的对象查看详细信息。</p>
          </div>
        `;
          }
        }
      }

      await deps.ensureSelectedLayersLoaded();
      await deps.refresh2DOverlay();
      deps.ensureBuildingEditorToolbar();
      await deps.refreshCommunityScoreBadge();
      deps.updateBuildingEditorToolbarState();

      try {
        const selectedCode3D = window.__active3DEntityCode;
        if (selectedCode3D) {
          const feature = deps.findFeatureBySourceCode(selectedCode3D);
          if (feature) {
            deps.setActiveFeature(feature);
            const sourceCode = feature.get("sourceCode");
            deps.setCurrentSelectedObject({
              layerKey: feature.get("layerKey"),
              sourceCode,
              displayName: feature.get("displayName") || sourceCode || "未命名建筑",
              rawFeature: feature
            });
            window.__active2DSelectedCode = sourceCode;
            deps.getPlanVectorLayer()?.changed?.();
            deps.update2DStatusText();
            const baseRow =
              feature.get("baseRow") ||
              deps.buildFallbackObjectRow(sourceCode, "building", feature.get("rawFeature"));
            await deps.showObjectInfo(baseRow, "building", sourceCode);
          }
        }
      } catch (error) {
        console.error("Error syncing selection from 3D:", error);
      }
    },

    async switchTo3DView(deps) {
      deps.setActiveStoryItem("planningSpace");
      deps.switchMainView("model3d");

      const statusBadge = deps.getStatusBadge();
      if (statusBadge) {
        statusBadge.textContent = "";
        statusBadge.style.display = "none";
      }
      const detailSubtitle = deps.getDetailSubtitle();
      if (detailSubtitle) {
        detailSubtitle.textContent = "当前显示三维白模与地形";
      }

      const infoPanel = deps.getInfoPanel();
      infoPanel.classList.remove("empty");
      infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>村庄 3D 模型</h3>
      <p>正在进入三维模式。点击白模建筑后，可在右侧查看对应对象信息。</p>
    </div>
  `;

      if (!window.Village3D || typeof window.Village3D.enter !== "function") {
        console.error("进入 3D 模式失败：Village3D 模块未加载。");
        infoPanel.innerHTML = `
        <div class="placeholder-block">
          <h3>3D 模型加载失败</h3>
          <p>3D 模块未加载，请检查 Cesium 脚本和 app-3d.js 是否正常加载。</p>
        </div>
      `;
        return;
      }

      try {
        await window.Village3D.enter();
      } catch (error) {
        console.error("进入 3D 模式失败：", error);
        infoPanel.innerHTML = `
        <div class="placeholder-block">
          <h3>3D 模型加载失败</h3>
          <p>${deps.escapeHtml(error.message || "请检查 app-3d.js、Cesium token 与 3D 数据路径。")}</p>
        </div>
      `;
      }
    }
  };

  window.ViewSwitcherModule = api;
})();
