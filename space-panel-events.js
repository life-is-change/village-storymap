(function () {
  const api = {
    bindSpaceListEvents(deps) {
      const dropdown = document.querySelector("[data-space-dropdown]");
      if (dropdown) {
        dropdown.addEventListener("change", async (event) => {
          const spaceId = event.target.value;
          if (!spaceId) return;
          await deps.handleSpaceSelect(spaceId);
        });
      }

      const toggleBtn = document.querySelector("[data-space-options-toggle]");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          deps.setIsSpaceOptionsExpanded(!deps.getIsSpaceOptionsExpanded());
          deps.renderSpaceList();
        });
      }

      const toolboxToggle = document.querySelector("[data-toolbox-toggle]");
      if (toolboxToggle) {
        toolboxToggle.addEventListener("click", (event) => {
          event.stopPropagation();
          deps.setIsToolboxExpanded(!deps.getIsToolboxExpanded());
          deps.renderSpaceList();
        });
      }

      const communityToggle = document.querySelector("[data-community-toggle]");
      if (communityToggle) {
        communityToggle.addEventListener("click", (event) => {
          event.stopPropagation();
          deps.setIsCommunityExpanded(!deps.getIsCommunityExpanded());
          deps.renderSpaceList();
        });
      }

      const viewModeButtons = document.querySelectorAll("[data-space-view]");
      viewModeButtons.forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          const payload = button.dataset.spaceView || "";
          const [spaceId, viewMode] = payload.split("::");
          const target = deps.getSpaceById(spaceId);
          if (!target || !viewMode) return;

          if (target.viewMode === viewMode && deps.getCurrentSpaceId() === spaceId) return;

          target.viewMode = viewMode;
          deps.saveSpacesToStorage();

          deps.setCurrentSpaceId(spaceId);
          deps.setCurrentSelectedObject(null);
          deps.setCurrentInfoMode("readonly");
          deps.saveSpacesToStorage();
          deps.sync2DSpaceStateTo3D();

          deps.clearBuildingInteractions();
          if (viewMode === "2d") {
            await deps.switchTo2DView();
          } else {
            await deps.switchTo3DView();
          }

          deps.renderSpaceList();
        });
      });

      const layerButtons = document.querySelectorAll("[data-space-layer]");
      layerButtons.forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          if (button.disabled || button.classList.contains("layer-muted")) return;
          const payload = button.dataset.spaceLayer || "";
          const [spaceId, layerKey] = payload.split("::");
          const target = deps.getSpaceById(spaceId);
          if (!target || !layerKey) return;
          if (target.viewMode !== "2d") return;

          const availableLayerKeys = deps.getAvailableLayerKeysForSpace(target);
          if (!availableLayerKeys.includes(layerKey)) return;

          const selected = new Set(target.selectedLayers || []);
          if (target.id === deps.BASE_SPACE_ID && layerKey === "figureGround") {
            if (selected.has(layerKey)) {
              selected.delete(layerKey);
            } else {
              selected.clear();
              selected.add("figureGround");
            }
          } else {
            if (selected.has(layerKey)) {
              selected.delete(layerKey);
            } else {
              selected.add(layerKey);
            }
            if (target.id === deps.BASE_SPACE_ID) {
              selected.delete("figureGround");
            }
          }

          if (target.id !== deps.BASE_SPACE_ID) {
            selected.delete("figureGround");
          }

          deps.setSpaceSelectedLayers(spaceId, [...selected]);
          if (!selected.has(deps.getCurrentGeometryEditLayer())) {
            deps.setCurrentGeometryEditLayer(deps.resolveGeometryEditLayer([...selected]));
            deps.getBuildingEditState().editLayerKey = deps.getCurrentGeometryEditLayer();
            deps.clearBuildingInteractions();
          }
          deps.setCurrentSpaceId(spaceId);
          deps.setCurrentSelectedObject(null);
          deps.setCurrentInfoMode("readonly");
          deps.sync2DSpaceStateTo3D();

          await deps.ensureSelectedLayersLoaded();
          deps.renderSpaceList();
          deps.syncBasemapUIBySpace(spaceId);

          if (!deps.getPlan2dViewEl().classList.contains("active")) {
            await deps.switchTo2DView();
          } else {
            deps.refresh2DOverlay();
            deps.showPlan2DOverview();
          }
        });
      });

      const devInfoIcons = document.querySelectorAll(".dev-info-icon");
      devInfoIcons.forEach((icon) => {
        const tooltip = icon.querySelector(".dev-tooltip");
        if (!tooltip) return;

        function showTooltip() {
          const rect = icon.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();
          const gap = 8;
          let left = rect.right + gap;
          let top = rect.top + rect.height / 2 - tooltipRect.height / 2;

          if (left + tooltipRect.width > window.innerWidth - gap) {
            left = rect.left - tooltipRect.width - gap;
          }
          if (top + tooltipRect.height > window.innerHeight - gap) {
            top = window.innerHeight - tooltipRect.height - gap;
          }
          if (top < gap) {
            top = gap;
          }

          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;
          tooltip.style.opacity = "1";
          tooltip.style.visibility = "visible";
        }

        function hideTooltip() {
          tooltip.style.opacity = "0";
          tooltip.style.visibility = "hidden";
        }

        icon.addEventListener("mouseenter", showTooltip);
        icon.addEventListener("mouseleave", hideTooltip);
        icon.addEventListener("focus", showTooltip);
        icon.addEventListener("blur", hideTooltip);
      });

      const renameTriggerButtons = document.querySelectorAll("[data-space-rename-trigger]");
      renameTriggerButtons.forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          const spaceId = button.dataset.spaceRenameTrigger;
          const target = deps.getSpaceById(spaceId);
          if (!target || target.readonly) return;
          if (!deps.canManageSpace(spaceId)) {
            deps.showToast("仅空间创建者可执行该操作。", "error");
            return;
          }

          const newTitle = await deps.customPrompt("请输入新的空间名称", target.title, "重命名空间", { maxLength: 10 });
          if (newTitle === null) return;
          const trimmed = newTitle.trim();
          if (!trimmed) {
            deps.renderSpaceList();
            return;
          }
          target.title = trimmed;
          deps.saveSpacesToStorage();
          deps.sync2DSpaceStateTo3D();

          if (window.Village3D && typeof window.Village3D.reload === "function") {
            await window.Village3D.reload();
          }

          deps.renderSpaceList();
        });
      });

      const deleteButtons = document.querySelectorAll("[data-space-delete]");
      deleteButtons.forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          const spaceId = button.dataset.spaceDelete;
          if (!spaceId || deps.isBaseSpace(spaceId)) return;
          if (!deps.canManageSpace(spaceId)) {
            deps.showToast("仅空间创建者可执行该操作。", "error");
            return;
          }

          const confirmed = await deps.customConfirm("确认要删除吗？删除后不可恢复。", {
            title: "删除空间",
            isDanger: true
          });
          if (!confirmed) return;

          deps.setSpaces(deps.getSpaces().filter((s) => s.id !== spaceId));
          if (!deps.getSpaces().some((s) => s.id === deps.BASE_SPACE_ID)) {
            deps.setSpaces([...deps.getDefaultSpaces(), ...deps.getSpaces()]);
          }

          if (deps.getCurrentSpaceId() === spaceId) {
            deps.setCurrentSpaceId(deps.BASE_SPACE_ID);
            const baseSpace = deps.getCurrentSpace();
            if (baseSpace.viewMode === "2d") {
              await deps.switchTo2DView();
            } else {
              await deps.switchTo3DView();
            }
          }

          deps.setCurrentSelectedObject(null);
          deps.setCurrentInfoMode("readonly");
          deps.saveSpacesToStorage();
          deps.renderSpaceList();
          deps.syncBasemapUIBySpace(deps.getCurrentSpaceId());

          if (deps.getCurrentSpace().viewMode === "2d") {
            await deps.ensureSelectedLayersLoaded();
            deps.refresh2DOverlay();
            deps.showPlan2DOverview();
          }
        });
      });
    }
  };

  window.SpacePanelEventsModule = api;
})();

