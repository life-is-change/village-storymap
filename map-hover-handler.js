(function () {
  let hoverCheckRaf = 0;
  let pendingHoverPixel = null;

  function pickHoveredFeature(planMap, pixel, isNonInteractiveLayerKey) {
    let hovered = null;
    planMap.forEachFeatureAtPixel(pixel, (feature) => {
      const layerKey = feature?.get?.("layerKey");
      if (isNonInteractiveLayerKey(layerKey)) return false;
      hovered = feature;
      return true;
    });
    return hovered;
  }

  const api = {
    bindPlanMapHover(deps) {
      const planMap = deps.getPlanMap();
      if (!planMap) return;

      planMap.on("pointermove", (evt) => {
        if (evt.dragging) return;

        const isPlanningMode = deps.getIsPlanningMode ? deps.getIsPlanningMode() : true;

        pendingHoverPixel = Array.isArray(evt.pixel) ? [...evt.pixel] : evt.pixel;
        if (hoverCheckRaf) return;

        hoverCheckRaf = requestAnimationFrame(() => {
          hoverCheckRaf = 0;
          const currentMap = deps.getPlanMap();
          if (!currentMap || !pendingHoverPixel) return;

          const hovered = pickHoveredFeature(currentMap, pendingHoverPixel, deps.isNonInteractiveLayerKey);
          pendingHoverPixel = null;

          // 共建模式下只允许社区任务标记的 hover 指针变化，其余禁用
          if (!isPlanningMode) {
            const targetEl = currentMap.getTargetElement();
            const isCommunityTask = hovered && hovered.get("layerKey") === "communityTask";
            if (targetEl) targetEl.style.cursor = isCommunityTask ? "pointer" : "";
            return;
          }

          const prevHover = deps.getHoverFeature();
          if (hovered !== prevHover) {
            deps.setHoverFeature(hovered);
            const mode = deps.getBuildingEditState()?.mode;
            if (mode !== "modify" && mode !== "translate") {
              deps.getPlanVectorLayer()?.changed();
            }
          }

          const targetEl = currentMap.getTargetElement();
          if (targetEl) {
            targetEl.style.cursor = hovered ? "pointer" : "";
          }
        });
      });
    }
  };

  window.MapHoverHandlerModule = api;
})();
