(function () {
  const layerIcons = {
    figureGround: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21v-8l7-5 7 5v8"></path></svg>`,
    building: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21v-8l7-5 7 5v8"></path></svg>`,
    road: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg>`,
    cropland: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-4-4-6-8-6-12a6 6 0 0 1 6 6 6 6 0 0 1 6-6c0 4-2 8-6 12z"></path></svg>`,
    openSpace: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2" fill="currentColor"></circle></svg>`,
    water: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a5 5 0 0 1-5-5c0-4 5-9 5-9s5 5 5 9a5 5 0 0 1-5 5z"></path></svg>`,
    contours: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8c3-2 5 2 8 0s5-2 8 0 5 2 6 0M2 16c3-2 5 2 8 0s5-2 8 0 5 2 6 0"></path></svg>`
  };

  function renderToggleTriangle(expanded) {
    return `<svg class="toggle-triangle ${expanded ? "expanded" : ""}" viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  }

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
      const currentUserName = String(deps.getCurrentUserName?.() || "").trim();
      const canManageCurrentSpace = deps.canManageSpace(currentSpace.id);

      // ===== 空间管理：下拉选择器 =====
      const spaceGroups = [
        { label: "我创建的空间", items: [] },
        { label: "他人创建的空间", items: [] },
        { label: "未标注创建者", items: [] },
        { label: "系统空间 🔒", items: [] }
      ];

      spaces.forEach((space) => {
        const creatorName = deps.getSpaceCreatorName(space);
        const isOwnSpace = space.id !== deps.BASE_SPACE_ID && !!currentUserName && creatorName === currentUserName;
        if (isOwnSpace) {
          spaceGroups[0].items.push(space);
        } else if (space.id === deps.BASE_SPACE_ID) {
          spaceGroups[3].items.push(space);
        } else if (creatorName) {
          spaceGroups[1].items.push(space);
        } else {
          spaceGroups[2].items.push(space);
        }
      });

      const visibleSpaceGroups = spaceGroups.filter((group) => group.items.length > 0);
      const getSpaceOptionDisplayText = (space) => {
        const creatorName = deps.getSpaceCreatorName(space);
        const isOwnSpace = space.id !== deps.BASE_SPACE_ID && !!currentUserName && creatorName === currentUserName;
        const isSystemSpace = space.id === deps.BASE_SPACE_ID;
        return isOwnSpace
          ? `我的 | ${space.title}`
          : isSystemSpace
            ? `系统 | ${space.title}`
            : creatorName
              ? `${creatorName} | ${space.title}`
              : `未标注 | ${space.title}`;
      };
      const dropdownOptionsHtml = visibleSpaceGroups
        .map((group) => `
          <optgroup label="${deps.escapeHtml(group.label)}">
            ${group.items
              .map((space) => {
                const displayText = getSpaceOptionDisplayText(space);
                return `
                  <option value="${deps.escapeHtml(space.id)}" ${space.id === currentSpaceId ? "selected" : ""}>
                    ${deps.escapeHtml(displayText)}
                  </option>
                `;
              })
              .join("")}
          </optgroup>
        `)
        .join("");

      // ===== 2D/3D 视图切换（保留在浮动控件中，同时也在菜单中显示当前状态） =====
      const viewModeSwitchHtml = `
        <div class="view-mode-switch">
          <button class="view-mode-btn ${currentSpace.viewMode === "2d" ? "active" : ""}"
                  type="button"
                  data-space-view="${currentSpace.id}::2d"
                  title="切换到 2D 平面视图">
            <span class="view-mode-icon">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l9 5v8l-9 5-9-5V8l9-5z"></path>
                <path d="M12 12l9-5M12 12V3M12 12l-9-5"></path>
              </svg>
            </span>
            <span class="view-mode-label">立体</span>
          </button>
        </div>
      `;

      // ===== 图层列表（仅在 2D 模式下） =====
      const figureGroundKeys = availableLayerKeys.filter((k) => k === "figureGround");
      const otherLayerKeys = availableLayerKeys.filter((k) => k !== "figureGround");
      const shouldShowLayers = currentSpace.viewMode === "2d";
      const isFigureGroundActive = currentSpace.selectedLayers.includes("figureGround");
      const basemapVisible = !!currentSpace?.basemapVisible;
      const labelVisible = deps.loadBasemapLabelVisible();

      deps.setCurrentGeometryEditLayer(deps.resolveGeometryEditLayer(currentSpace.selectedLayers));

      const layersHtml = shouldShowLayers
        ? `
          <!-- 图底关系 -->
          ${figureGroundKeys
            .map(
              (layerKey) => `
                <button class="menu-l2-item ${currentSpace.selectedLayers.includes(layerKey) ? "active" : ""} figure-ground-item"
                        data-space-layer="${currentSpace.id}::${layerKey}"
                        data-layer="${layerKey}"
                        type="button">
                  <span class="menu-item-icon">${api.getLayerIconSvg(layerKey)}</span>
                  <span class="menu-item-label">${deps.escapeHtml(layerConfigs[layerKey].label)}</span>
                  <span class="layer-info-icon" title="图底关系无法与其他图层同时显示">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                  </span>
                </button>
              `
            )
            .join("")}
          ${figureGroundKeys.length > 0 && otherLayerKeys.length > 0 ? '<div class="menu-divider"></div>' : ""}

          <!-- 要素图层 -->
          <div class="other-layers-wrap ${isFigureGroundActive ? "collapsed" : ""}">
            ${otherLayerKeys
              .map(
                (layerKey) => `
                  <button class="menu-l2-item ${currentSpace.selectedLayers.includes(layerKey) ? "active" : ""}"
                          data-space-layer="${currentSpace.id}::${layerKey}"
                          data-layer="${layerKey}"
                          type="button"
                          ${isFigureGroundActive ? "disabled" : ""}>
                    <span class="menu-item-icon">${api.getLayerIconSvg(layerKey)}</span>
                    <span class="menu-item-label">${deps.escapeHtml(layerConfigs[layerKey].label)}</span>
                  </button>
                `
              )
              .join("")}
          </div>

          ${otherLayerKeys.length > 0 ? '<div class="menu-divider"></div>' : ""}

          <!-- 辅助图层：底图 + 地名 -->
          <div class="menu-l2-row">
            <button class="menu-l2-item half ${basemapVisible && !isFigureGroundActive ? "active" : ""}"
                    type="button"
                    data-basemap-toggle
                    ${isFigureGroundActive ? "disabled" : ""}>
              <span class="menu-item-label">底图</span>
            </button>
            <button class="menu-l2-item half ${(basemapVisible && labelVisible) && !isFigureGroundActive ? "active" : ""} ${!basemapVisible || isFigureGroundActive ? "is-disabled" : ""}"
                    type="button"
                    data-basemap-label-toggle
                    ${!basemapVisible || isFigureGroundActive ? "disabled" : ""}>
              <span class="menu-item-label">地名</span>
            </button>
          </div>
        `
        : "";

      const isPlanningMode = deps.getIsPlanningMode();

      // ===== 图层控制（规划/共建模式下均显示） =====
      const layersControlHtml = currentSpace.viewMode === "2d" ? `
        <div class="menu-tree-section is-expandable">
          <button class="menu-l1-header" type="button" data-space-options-toggle>
            ${renderToggleTriangle(deps.getIsSpaceOptionsExpanded())}
            <span class="menu-l1-title">图层控制</span>
          </button>
          <div class="menu-l1-body ${deps.getIsSpaceOptionsExpanded() ? 'is-expanded' : ''}" data-collapsible-body>
            <div class="menu-indent">
              ${layersHtml}
            </div>
          </div>
        </div>
      ` : `
        <div class="menu-tree-section">
          <div class="menu-l1-body">
            <div class="menu-indent">
              <div class="space-3d-hint">立体视图下不支持图层控制与空间工具</div>
            </div>
          </div>
        </div>
      `;

      // ===== 共建模式内容 =====
      const collabModeHtml = `
        ${layersControlHtml}
        <div class="menu-tree-section is-expandable">
          <button class="menu-l1-header" type="button" data-community-toggle>
            ${renderToggleTriangle(deps.getIsCommunityExpanded())}
            <span class="menu-l1-title">社区共建<span class="toolbox-info-icon" title="可发布留言或选择任务类型并在地图上标记位置，参与村庄共建。">i</span></span>
          </button>
          <div class="menu-l1-body ${deps.getIsCommunityExpanded() ? 'is-expanded' : ''}" data-collapsible-body>
            <div class="menu-indent">
              <div class="community-content is-compact">
                <div id="communityBuildMount"></div>
              </div>
            </div>
          </div>
        </div>
      `;

      // ===== 构建完整层级菜单 =====
      const html = `
        <div class="menu-tree">
          ${isPlanningMode ? `
            <!-- 1. 空间管理 -->
            <div class="menu-tree-section">
              <div class="menu-l1-header">
                <span class="menu-l1-title">空间管理</span>
                <div class="menu-header-actions">
                  <button class="space-icon-btn space-add-icon-btn" type="button" title="新建空间" data-add-space>+</button>
                  <button class="space-icon-btn space-rename-icon-btn ${!canManageCurrentSpace ? "is-disabled" : ""}" type="button" data-space-rename-trigger="${currentSpace.id}" title="重命名空间" ${!canManageCurrentSpace ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  <button class="space-icon-btn space-delete-icon-btn ${!canManageCurrentSpace ? "is-disabled" : ""}" type="button" data-space-delete="${currentSpace.id}" title="删除空间" ${!canManageCurrentSpace ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="menu-l1-body">
                <div class="menu-indent">
                  <select class="space-select-dropdown" data-space-dropdown>
                    ${dropdownOptionsHtml}
                  </select>
                </div>
              </div>
            </div>

            <!-- 2. 视图模式 -->
            <div class="menu-tree-section">
              <div class="menu-l1-header">
                <span class="menu-l1-title">视图模式</span>
              </div>
              <div class="menu-l1-body">
                <div class="menu-indent">
                  ${viewModeSwitchHtml}
                </div>
              </div>
            </div>

            ${layersControlHtml}

            ${currentSpace.viewMode === "2d" ? `
              <!-- 4. 空间工具（可折叠） -->
              <div class="menu-tree-section is-expandable">
                <button class="menu-l1-header" type="button" data-toolbox-toggle>
                  ${renderToggleTriangle(deps.getIsToolboxExpanded())}
                  <span class="menu-l1-title">空间工具<span class="toolbox-info-icon" title="操作提示：请先选择对象类型后，再选择操作工具进入编辑模式，完成后请点击保存编辑，否则编辑内容不会被保存。">i</span></span>
                </button>
                <div class="menu-l1-body ${deps.getIsToolboxExpanded() ? 'is-expanded' : ''}" data-collapsible-body>
                  <div class="menu-indent">
                    ${
                      canManageCurrentSpace
                        ? `<div id="toolboxToolbarMount"></div>`
                        : `<div class="space-permission-tip">该空间由 ${deps.escapeHtml(currentSpaceCreator || "其他账号")} 创建，你可查看图层与参与社区共建留言，但不能修改几何与属性。</div>`
                    }
                  </div>
                </div>
              </div>
            ` : ""}

            <!-- 6. 导出 -->
            <div class="menu-tree-section">
              <div class="menu-l1-header">
                <span class="menu-l1-title">导出</span>
              </div>
              <div class="menu-l1-body">
                <div class="menu-indent">
                  <button id="exportToMcBtn" class="mc-export-btn toolbox-btn space-export-mc-btn" type="button">导出当前空间到MC</button>
                </div>
              </div>
            </div>
          ` : collabModeHtml}
        </div>
        ${!isPlanningMode ? `
          <div class="menu-tree-footer">
            <div id="communityScoreBadge" class="community-score-badge">贡献值：--</div>
          </div>
        ` : ""}
      `;

      spaceListEl.innerHTML = html;

      // 更新模式切换按钮状态
      const modeSwitch = document.querySelector("[data-mode-switch]");
      if (modeSwitch) {
        modeSwitch.querySelectorAll("[data-mode]").forEach((btn) => {
          btn.classList.toggle("active",
            (deps.getIsPlanningMode() && btn.dataset.mode === "planning") ||
            (!deps.getIsPlanningMode() && btn.dataset.mode === "collab")
          );
        });
      }

      // 清空 header 中的空间选择器（已移入菜单树）
      const headerSelectMount = document.getElementById("spaceHeaderSelect");
      if (headerSelectMount) headerSelectMount.innerHTML = "";

      // 2D/3D 切换仅保留在左侧菜单中，清空浮动控件
      const mapSwitchMount = document.getElementById("mapViewModeSwitch");
      const modelSwitchMount = document.getElementById("modelViewModeSwitch");
      if (mapSwitchMount) mapSwitchMount.innerHTML = "";
      if (modelSwitchMount) modelSwitchMount.innerHTML = "";

      deps.bindSpaceListEvents();
      deps.ensureBuildingEditorToolbar();
      deps.ensureCommunityBuildPanel();
      deps.updateBuildingEditorToolbarState();
      deps.refreshCommunityScoreBadge?.();
    }
  };

  window.SpacePanelModule = api;
})();
