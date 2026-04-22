(function () {
  const layerIcons = {
    figureGround: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21v-8l7-5 7 5v8"></path></svg>`,
    building: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21v-8l7-5 7 5v8"></path></svg>`,
    road: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg>`,
    cropland: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-4-4-6-8-6-12a6 6 0 0 1 6 6 6 6 0 0 1 6-6c0 4-2 8-6 12z"></path></svg>`,
    openSpace: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2" fill="currentColor"></circle></svg>`,
    water: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a5 5 0 0 1-5-5c0-4 5-9 5-9s5 5 5 9a5 5 0 0 1-5 5z"></path></svg>`,
    contours: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8c3-2 5 2 8 0s5-2 8 0 5 2 6 0M2 16c3-2 5 2 8 0s5-2 8 0 5 2 6 0"></path></svg>`
  };

  const api = {
    getLayerIconSvg(layerKey) {
      return layerIcons[layerKey] || "";
    },

    renderSpaceList(deps) {
      const spaceListEl = deps.getSpaceListEl();
      if (!spaceListEl) {
        console.error("spaceList element not found");
        return;
      }

      spaceListEl.classList.toggle("active", deps.getIsSpaceSidebarExpanded());

      const spaces = deps.getSpaces();
      if (!spaces || spaces.length === 0) {
        console.warn("spaces array is empty");
      }

      const currentSpace = deps.getCurrentSpace() || spaces[0];
      if (!currentSpace) {
        spaceListEl.innerHTML = "";
        return;
      }

      const currentSpaceId = deps.getCurrentSpaceId();
      const availableLayerKeys = deps.getAvailableLayerKeysForSpace(currentSpace);
      const layerConfigs = deps.getLayerConfigs();
      const currentSpaceCreator = deps.getSpaceCreatorName(currentSpace);
      const canManageCurrentSpace = deps.canManageSpace(currentSpace.id);

      const dropdownOptionsHtml = spaces
        .map(
          (space) => `
    <option value="${space.id}" ${space.id === currentSpaceId ? "selected" : ""}>
      ${deps.escapeHtml(space.title)}${
            space.id === deps.BASE_SPACE_ID
              ? "（系统）"
              : deps.getSpaceCreatorName(space)
                ? `（${deps.escapeHtml(deps.getSpaceCreatorName(space))}）`
                : ""
          }
    </option>
  `
        )
        .join("");

      const viewModeSwitchHtml = `
    <div class="view-mode-switch">
      <button class="view-mode-btn ${currentSpace.viewMode === "2d" ? "active" : ""}"
              type="button"
              data-space-view="${currentSpace.id}::2d"
              title="切换到 2D 平面视图">
        <span class="view-mode-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
          </svg>
        </span>
        <span class="view-mode-label">平面</span>
      </button>
      <button class="view-mode-btn ${currentSpace.viewMode === "3d" ? "active" : ""}"
              type="button"
              data-space-view="${currentSpace.id}::3d"
              title="切换到 3D 立体视图">
        <span class="view-mode-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l9 5v8l-9 5-9-5V8l9-5z"></path>
            <path d="M12 12l9-5M12 12V3M12 12l-9-5"></path>
          </svg>
        </span>
        <span class="view-mode-label">立体</span>
      </button>
    </div>
  `;

      const figureGroundKeys = availableLayerKeys.filter((k) => k === "figureGround");
      const otherLayerKeys = availableLayerKeys.filter((k) => k !== "figureGround");
      const shouldShowLayers = currentSpace.viewMode === "2d";
      const isFigureGroundActive = currentSpace.selectedLayers.includes("figureGround");
      const basemapVisible = !!currentSpace?.basemapVisible;
      const labelVisible = deps.loadBasemapLabelVisible();

      deps.setCurrentGeometryEditLayer(deps.resolveGeometryEditLayer(currentSpace.selectedLayers));

      const layersHtml = shouldShowLayers
        ? `
    <div class="substory-list active">
      ${figureGroundKeys
        .map(
          (layerKey) => `
        <button class="substory-item ${currentSpace.selectedLayers.includes(layerKey) ? "active" : ""} figure-ground-item"
                data-space-layer="${currentSpace.id}::${layerKey}"
                data-layer="${layerKey}"
                type="button">
          <span class="layer-icon">${api.getLayerIconSvg(layerKey)}</span>
          <span class="layer-label-flex">${deps.escapeHtml(layerConfigs[layerKey].label)}</span>
          <span class="layer-info-icon" title="图底关系无法与其他图层同时显示">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </span>
        </button>
      `
        )
        .join("")}
      ${figureGroundKeys.length > 0 && otherLayerKeys.length > 0 ? '<div class="layer-divider"></div>' : ""}
      <div class="other-layers-wrap ${isFigureGroundActive ? "collapsed" : ""}">
        ${otherLayerKeys
          .map(
            (layerKey) => `
          <button class="substory-item ${currentSpace.selectedLayers.includes(layerKey) ? "active" : ""}"
                  data-space-layer="${currentSpace.id}::${layerKey}"
                  data-layer="${layerKey}"
                  type="button"
                  ${isFigureGroundActive ? "disabled" : ""}>
            <span class="layer-icon">${api.getLayerIconSvg(layerKey)}</span>
            <span>${deps.escapeHtml(layerConfigs[layerKey].label)}</span>
          </button>
        `
          )
          .join("")}
      </div>
      <div class="layer-divider"></div>
      <div class="substory-item-row">
        <button class="substory-item layer-util-btn ${basemapVisible && !isFigureGroundActive ? "active" : ""}" type="button" data-basemap-toggle ${isFigureGroundActive ? "disabled" : ""}>
          <span>底图</span>
        </button>
        <button class="substory-item layer-util-btn ${(basemapVisible && labelVisible) && !isFigureGroundActive ? "active" : ""} ${!basemapVisible || isFigureGroundActive ? "is-disabled" : ""}" type="button" data-basemap-label-toggle ${!basemapVisible || isFigureGroundActive ? "disabled" : ""}>
          <span>地名</span>
        </button>
      </div>
    </div>
  `
        : "";

      const headerSelectHtml = `
    <select class="space-select-dropdown" data-space-dropdown>
      ${dropdownOptionsHtml}
    </select>
    <button class="space-icon-btn space-add-icon-btn" type="button" title="新建空间" data-add-space>+</button>
    <button class="space-icon-btn space-rename-icon-btn ${!canManageCurrentSpace ? "is-disabled" : ""}" type="button" data-space-rename-trigger="${currentSpace.id}" title="重命名空间" ${!canManageCurrentSpace ? "disabled" : ""}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    </button>
    <button class="space-icon-btn space-delete-icon-btn ${!canManageCurrentSpace ? "is-disabled" : ""}" type="button" data-space-delete="${currentSpace.id}" title="删除空间" ${!canManageCurrentSpace ? "disabled" : ""}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
    <div class="space-owner-meta">
      ${
        currentSpace.id === deps.BASE_SPACE_ID
          ? "当前空间创建者：系统"
          : `当前空间创建者：${deps.escapeHtml(currentSpaceCreator || "未标注")}${canManageCurrentSpace ? "（你）" : ""}`
      }
    </div>
  `;

      const html = `
    <div class="space-control-panel">
      ${
        currentSpace.viewMode === "2d"
          ? `
        <div class="space-options-section">
          <div class="space-options-title-row">
            <div class="space-options-title">图层</div>
            <button class="space-options-toggle" type="button" data-space-options-toggle>
              <svg class="toggle-triangle ${deps.getIsSpaceOptionsExpanded() ? "expanded" : ""}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
          </div>
          ${deps.getIsSpaceOptionsExpanded() ? layersHtml : ""}
        </div>

        ${
          currentSpace.id !== deps.BASE_SPACE_ID
            ? `
          <div class="space-toolbox-section">
            <div class="space-options-title-row">
              <div class="space-options-title">工具箱<span class="toolbox-info-icon" title="点击工具按钮后进入对应编辑模式，编辑完成后请点击“保存编辑”，否则编辑结果不会被保存。">i</span></div>
              <button class="space-options-toggle" type="button" data-toolbox-toggle>
                <svg class="toggle-triangle ${deps.getIsToolboxExpanded() ? "expanded" : ""}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </button>
            </div>
            ${
              deps.getIsToolboxExpanded()
                ? `
              <div class="toolbox-content">
                ${
                  canManageCurrentSpace
                    ? `<div id="toolboxToolbarMount"></div>`
                    : `<div class="space-permission-tip">该空间由 ${deps.escapeHtml(currentSpaceCreator || "其他账号")} 创建，你可点赞/评论，但不能修改几何与属性。</div>`
                }
              </div>
            `
                : ""
            }
          </div>
          <div class="space-community-section">
            <div class="space-options-title-row">
              <div class="space-options-title">社区共建<span class="toolbox-info-icon" title="可发起社区问题任务，其他村民核实后双方可获得贡献值。">i</span></div>
              <div class="space-options-toggle-group">
                <button class="space-options-toggle" type="button" data-community-toggle>
                  <svg class="toggle-triangle ${deps.getIsCommunityExpanded() ? "expanded" : ""}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </button>
              </div>
            </div>
            ${
              deps.getIsCommunityExpanded()
                ? `
              <div class="community-content is-compact">
                <div id="communityBuildMount"></div>
              </div>
            `
                : ""
            }
          </div>
        `
            : ""
        }
      `
          : `
        <div class="space-3d-hint">立体视图下，暂不支持图层与工具箱</div>
      `
      }
      <button id="exportToMcBtn" class="mc-export-btn toolbox-btn space-export-mc-btn" type="button">导出当前空间到MC</button>
    </div>
  `;

      spaceListEl.innerHTML = html;

      const headerSelectMount = document.getElementById("spaceHeaderSelect");
      if (headerSelectMount) headerSelectMount.innerHTML = headerSelectHtml;

      const mapSwitchMount = document.getElementById("mapViewModeSwitch");
      const modelSwitchMount = document.getElementById("modelViewModeSwitch");
      if (mapSwitchMount) mapSwitchMount.innerHTML = viewModeSwitchHtml;
      if (modelSwitchMount) modelSwitchMount.innerHTML = viewModeSwitchHtml;

      deps.bindSpaceListEvents();
      deps.ensureBuildingEditorToolbar();
      deps.ensureCommunityBuildPanel();
      deps.updateBuildingEditorToolbarState();
    }
  };

  window.SpacePanelModule = api;
})();
