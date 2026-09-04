(function () {
  const api = {
    bindSpaceListEvents(deps) {
      const dropdown = document.querySelector("[data-space-dropdown]");
      if (dropdown) {
        dropdown.addEventListener("change", async (event) => {
          const spaceId = event.target.value;
          if (!spaceId) return;
          deps.onManualContextChange?.();
          await deps.handleSpaceSelect(spaceId);
        });
      }

      const toggleBtn = document.querySelector("[data-space-options-toggle]");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          const next = !deps.getIsSpaceOptionsExpanded();
          deps.setIsSpaceOptionsExpanded(next);
          const section = toggleBtn.closest(".menu-tree-section");
          const body = section?.querySelector("[data-collapsible-body]");
          const triangle = toggleBtn.querySelector(".toggle-triangle");
          if (body) body.classList.toggle("is-expanded", next);
          if (triangle) triangle.classList.toggle("expanded", next);
        });
      }

      const toolboxToggle = document.querySelector("[data-toolbox-toggle]");
      if (toolboxToggle) {
        toolboxToggle.addEventListener("click", (event) => {
          event.stopPropagation();
          const next = !deps.getIsToolboxExpanded();
          deps.setIsToolboxExpanded(next);
          const section = toolboxToggle.closest(".menu-tree-section");
          const body = section?.querySelector("[data-collapsible-body]");
          const triangle = toolboxToggle.querySelector(".toggle-triangle");
          if (body) body.classList.toggle("is-expanded", next);
          if (triangle) triangle.classList.toggle("expanded", next);
        });
      }

      const communityToggle = document.querySelector("[data-community-toggle]");
      if (communityToggle) {
        communityToggle.addEventListener("click", (event) => {
          event.stopPropagation();
          const next = !deps.getIsCommunityExpanded();
          deps.setIsCommunityExpanded(next);
          const section = communityToggle.closest(".menu-tree-section");
          const body = section?.querySelector("[data-collapsible-body]");
          const triangle = communityToggle.querySelector(".toggle-triangle");
          if (body) body.classList.toggle("is-expanded", next);
          if (triangle) triangle.classList.toggle("expanded", next);
        });
      }

      const versionToggle = document.querySelector("[data-version-manager-toggle]");
      if (versionToggle) {
        versionToggle.addEventListener("click", async (event) => {
          event.stopPropagation();
          const section = versionToggle.closest(".menu-tree-section");
          const body = section?.querySelector("[data-collapsible-body]");
          const triangle = versionToggle.querySelector(".toggle-triangle");
          const next = !body?.classList.contains("is-expanded");
          body?.classList.toggle("is-expanded", next);
          triangle?.classList.toggle("expanded", next);
          if (next) await deps.refreshVersionManagerPanel?.();
        });
      }

      document.querySelectorAll("[data-version-action]").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          const action = button.dataset.versionAction;
          if (action === "initial") await deps.toggleInitialBaseline?.("view");
          if (action === "compare") await deps.toggleInitialBaseline?.("compare");
          if (action === "freeze") await deps.freezeCurrentSnapshot?.();
        });
      });

      const viewModeButtons = document.querySelectorAll("[data-space-view]");
      viewModeButtons.forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          const payload = button.dataset.spaceView || "";
          const [spaceId, viewMode] = payload.split("::");
          const target = deps.getSpaceById(spaceId);
          if (!target || !viewMode) return;

          if (target.viewMode === viewMode && deps.getCurrentSpaceId() === spaceId) return;

          deps.onManualContextChange?.();

          target.viewMode = viewMode;
          deps.saveSpacesToStorage({ syncRemote: !["course_personal", "practice_personal", "formal_personal"].includes(target.spaceType) });

          deps.setCurrentSpaceId(spaceId);
          deps.saveSpacesToStorage({ syncRemote: !["course_personal", "practice_personal", "formal_personal"].includes(target.spaceType) });
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

      const contourLabelButtons = document.querySelectorAll("[data-contour-label-toggle]");
      contourLabelButtons.forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (button.disabled) return;
          const target = deps.getSpaceById(button.dataset.contourLabelToggle || "");
          if (!target || !(target.selectedLayers || []).includes("contours")) return;
          target.contourLabelsVisible = target.contourLabelsVisible !== true;
          deps.saveSpacesToStorage({ syncRemote: !["course_personal", "practice_personal", "formal_personal"].includes(target.spaceType) });
          deps.getPlanVectorLayer?.()?.changed?.();
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
          if (layerKey === "figureGround") {
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

          deps.renderSpaceList();
          deps.syncBasemapUIBySpace(spaceId);

          if (!deps.getPlan2dViewEl().classList.contains("active")) {
            await deps.switchTo2DView();
          } else {
            await deps.refresh2DOverlay();
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
        if (button.dataset.spaceActionBound === "rename") return;
        button.dataset.spaceActionBound = "rename";
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          const spaceId = button.dataset.spaceRenameTrigger;
          const target = deps.getSpaceById(spaceId);
          if (!target || deps.isBaseSpace(target.id)) return;
          if (!deps.canManageSpace(spaceId)) {
            deps.showToast("仅空间创建者可执行该操作。", "error");
            return;
          }

          const newTitle = await deps.customPrompt("", target.title, "重命名空间", {
            maxLength: 10,
            emptyError: "请输入空间名称",
            validate(value) {
              const trimmed = String(value || "").trim();
              if (!trimmed) return "";
              return deps.isSpaceTitleDuplicate(trimmed, target.id)
                ? "空间名称已存在，请换一个名称。"
                : "";
            }
          });
          if (newTitle === null) return;
          const trimmed = newTitle.trim();
          if (!trimmed) {
            deps.renderSpaceList();
            return;
          }
          if (deps.isSpaceTitleDuplicate(trimmed, target.id)) {
            deps.showToast("空间名称已存在，请换一个名称。", "error");
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
        if (button.dataset.spaceActionBound === "delete") return;
        button.dataset.spaceActionBound = "delete";
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
          deps.deleteSpaceFromSupabase?.(spaceId);
          deps.renderSpaceList();
          deps.syncBasemapUIBySpace(deps.getCurrentSpaceId());

          if (deps.getCurrentSpace().viewMode === "2d") {
            await deps.ensureSelectedLayersLoaded();
            await deps.refresh2DOverlay();
            deps.showPlan2DOverview();
          }
        });
      });
    }
  };

  window.SpacePanelEventsModule = api;
})();
