(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.VillageRealityInsetModule = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const DEFAULT_ASSET_ID = 5133927;
  const DEFAULT_TITLE = "米埗村实景模型";
  const DEFAULT_STATUS = "等待加载实景模型";

  function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeConfig(candidate = {}) {
    const hasAssetId = candidate.ionAssetId !== undefined && candidate.ionAssetId !== null;
    const parsedAssetId = hasAssetId ? Number(candidate.ionAssetId) : DEFAULT_ASSET_ID;
    const ionAssetId = Number.isInteger(parsedAssetId) && parsedAssetId > 0 ? parsedAssetId : 0;

    return {
      enabled: candidate.enabled !== false && ionAssetId > 0,
      ionAssetId,
      title: String(candidate.title || DEFAULT_TITLE).trim() || DEFAULT_TITLE,
      terrainEnabled: candidate.terrainEnabled !== false,
      heightOffset: toFiniteNumber(candidate.heightOffset, 0)
    };
  }

  function clampPanelPosition(position = {}, panelSize = {}, boundsSize = {}) {
    const panelWidth = Math.max(0, toFiniteNumber(panelSize.width, 0));
    const panelHeight = Math.max(0, toFiniteNumber(panelSize.height, 0));
    const boundsWidth = Math.max(0, toFiniteNumber(boundsSize.width, 0));
    const boundsHeight = Math.max(0, toFiniteNumber(boundsSize.height, 0));

    return {
      x: Math.min(
        Math.max(toFiniteNumber(position.x, 0), 0),
        Math.max(0, boundsWidth - panelWidth)
      ),
      y: Math.min(
        Math.max(toFiniteNumber(position.y, 0), 0),
        Math.max(0, boundsHeight - panelHeight)
      )
    };
  }

  function clampPanelSize(size = {}, boundsSize = {}, minimumSize = {}) {
    const minWidth = Math.max(0, toFiniteNumber(minimumSize.width, 360));
    const minHeight = Math.max(0, toFiniteNumber(minimumSize.height, 260));
    const boundsWidth = Math.max(0, toFiniteNumber(boundsSize.width, minWidth));
    const boundsHeight = Math.max(0, toFiniteNumber(boundsSize.height, minHeight));

    return {
      width: Math.min(
        Math.max(toFiniteNumber(size.width, minWidth), minWidth),
        boundsWidth
      ),
      height: Math.min(
        Math.max(toFiniteNumber(size.height, minHeight), minHeight),
        boundsHeight
      )
    };
  }

  function calculatePanelResize(start = {}, pointer = {}) {
    const left = Math.max(0, toFiniteNumber(start.left, 0));
    const top = Math.max(0, toFiniteNumber(start.top, 0));
    const size = clampPanelSize(
      {
        width: toFiniteNumber(start.width, 360) +
          toFiniteNumber(pointer.x, start.pointerX) -
          toFiniteNumber(start.pointerX, 0),
        height: toFiniteNumber(start.height, 260) +
          toFiniteNumber(pointer.y, start.pointerY) -
          toFiniteNumber(start.pointerY, 0)
      },
      {
        width: Math.max(0, toFiniteNumber(start.hostWidth, 0) - left),
        height: Math.max(0, toFiniteNumber(start.hostHeight, 0) - top)
      }
    );
    return { left, top, width: size.width, height: size.height };
  }

  function getRealityRenderQuality(devicePixelRatio = 1) {
    return {
      resolutionScale: Math.min(
        Math.max(toFiniteNumber(devicePixelRatio, 1), 1),
        2
      ),
      tilesetOptions: {
        maximumScreenSpaceError: 4,
        dynamicScreenSpaceError: false,
        cacheBytes: 256 * 1024 * 1024
      }
    };
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const finite = toFiniteNumber(value, fallback);
    return Math.min(Math.max(finite, minimum), maximum);
  }

  function resolveRealityTargetHeight(sampledHeight, fallbackBaseHeight, buildingHeight) {
    const safeHeight = Math.max(1, toFiniteNumber(buildingHeight, 9));
    if (sampledHeight !== undefined && sampledHeight !== null &&
        Number.isFinite(Number(sampledHeight))) {
      return {
        height: Number(sampledHeight) - safeHeight * 0.35,
        sampled: true
      };
    }
    return {
      height: toFiniteNumber(fallbackBaseHeight, 0) + safeHeight * 0.65,
      sampled: false
    };
  }

  function getRealityCloseupCamera(record = {}, sampledHeight, currentHeading) {
    const longitude = Number(record.longitude);
    const latitude = Number(record.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    const buildingHeight = Math.max(1, toFiniteNumber(record.height, 9));
    const radius = Math.max(
      6,
      toFiniteNumber(record.horizontalRadius, 6),
      buildingHeight / 2
    );
    const target = resolveRealityTargetHeight(
      sampledHeight,
      record.baseHeight,
      buildingHeight
    );
    return {
      longitude,
      latitude,
      targetHeight: target.height,
      radius,
      heading: Number.isFinite(Number(currentHeading))
        ? Number(currentHeading)
        : Math.PI * 0.75,
      pitch: -Math.PI / 6,
      range: clampNumber(radius * 4.5, 35, 90, 35),
      sampled: target.sampled
    };
  }

  function normalizeBuildingCode(value) {
    return String(value || "")
      .trim()
      .replace(/\uFEFF/g, "")
      .replace(/[\s-]+/g, "")
      .toUpperCase();
  }

  function createFocusRequestGate() {
    let current = 0;
    return {
      next() {
        current += 1;
        return current;
      },
      isCurrent(token) {
        return token === current;
      }
    };
  }

  function findProxyCodeFromPicks(picks) {
    const list = Array.isArray(picks) ? picks : picks ? [picks] : [];
    for (const picked of list) {
      const code = normalizeBuildingCode(picked?.id?.__realityProxyCode || "");
      if (code) return code;
    }
    return "";
  }

  function createController(options = {}) {
    const CesiumRef = options.Cesium || root.Cesium || null;
    const config = normalizeConfig(options.config || root.VILLAGE_REALITY_MODEL || {});
    const documentRef = options.document || root.document || null;
    const proxyMap = new Map();
    const focusGate = createFocusRequestGate();
    const cleanupCallbacks = [];

    let panel = options.panel || null;
    let host = options.host || null;
    let container = options.container || null;
    let titleEl = options.titleEl || null;
    let statusEl = options.statusEl || null;
    let toggleButton = options.toggleButton || null;
    let expandButton = options.expandButton || null;
    let resizeHandle = options.resizeHandle || null;
    let fullscreenButton = options.fullscreenButton || null;
    let resetButton = options.resetButton || null;
    let terrainButton = options.terrainButton || null;
    let closeButton = options.closeButton || null;
    let retryButton = options.retryButton || null;
    let titlebar = options.titlebar || null;

    let viewer = null;
    let tileset = null;
    let clickHandler = null;
    let enterPromise = null;
    let tilesetPromise = null;
    let pendingProxyRecords = [];
    let visible = true;
    let destroyed = false;
    let controlsBound = false;
    let terrainEnabled = config.terrainEnabled;
    let fullscreenFallback = false;
    let expanded = false;
    let normalPanelRect = null;

    function byId(id) {
      return documentRef?.getElementById?.(id) || null;
    }

    function resolveElements() {
      panel ||= byId("reality3dPanel");
      host ||= panel?.parentElement || byId("model3dView");
      container ||= byId("reality3dContainer");
      titleEl ||= byId("reality3dTitle");
      statusEl ||= byId("reality3dStatus");
      toggleButton ||= byId("reality3dToggleBtn");
      expandButton ||= byId("reality3dExpandBtn");
      resizeHandle ||= byId("reality3dResizeHandle");
      fullscreenButton ||= byId("reality3dFullscreenBtn");
      resetButton ||= byId("reality3dResetBtn");
      terrainButton ||= byId("reality3dTerrainBtn");
      closeButton ||= byId("reality3dCloseBtn");
      retryButton ||= byId("reality3dRetryBtn");
      titlebar ||= byId("reality3dTitlebar");
    }

    function setStatus(message, state = "idle") {
      if (!statusEl) return;
      statusEl.textContent = String(message || DEFAULT_STATUS);
      statusEl.dataset.state = state;
      statusEl.hidden = false;
      if (retryButton) retryButton.hidden = state !== "error";
    }

    function setVisible(nextVisible) {
      visible = !!nextVisible;
      panel?.classList.toggle("is-hidden", !visible);
      toggleButton?.classList.toggle("is-active", visible);
      toggleButton?.setAttribute("aria-pressed", visible ? "true" : "false");
      if (viewer && visible) {
        viewer.resize();
        viewer.scene.requestRender();
      }
      return visible;
    }

    function show() {
      return setVisible(true);
    }

    function hide() {
      return setVisible(false);
    }

    function toggle() {
      return setVisible(!visible);
    }

    function addDomListener(target, eventName, handler, listenerOptions) {
      if (!target?.addEventListener) return;
      target.addEventListener(eventName, handler, listenerOptions);
      cleanupCallbacks.push(() => target.removeEventListener(eventName, handler, listenerOptions));
    }

    function constrainPanelToHost() {
      if (
        !panel ||
        !host ||
        panel.classList.contains("is-fullscreen") ||
        panel.classList.contains("is-expanded")
      ) return;
      const hostRect = host.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const current = {
        x: panelRect.left - hostRect.left,
        y: panelRect.top - hostRect.top
      };
      const next = clampPanelPosition(
        current,
        { width: panelRect.width, height: panelRect.height },
        { width: hostRect.width, height: hostRect.height }
      );
      panel.style.left = `${next.x}px`;
      panel.style.top = `${next.y}px`;
      panel.style.right = "auto";
    }

    function bindDragging() {
      if (!titlebar || !panel || !host || !documentRef) return;
      let dragState = null;

      const onPointerMove = (event) => {
        if (!dragState) return;
        const next = clampPanelPosition(
          {
            x: dragState.panelX + event.clientX - dragState.pointerX,
            y: dragState.panelY + event.clientY - dragState.pointerY
          },
          dragState.panelSize,
          dragState.hostSize
        );
        panel.style.left = `${next.x}px`;
        panel.style.top = `${next.y}px`;
        panel.style.right = "auto";
      };

      const finishDrag = () => {
        if (!dragState) return;
        dragState = null;
        panel.classList.remove("is-dragging");
      };

      const onPointerDown = (event) => {
        if (event.button !== 0 || event.target?.closest?.("button")) return;
        if (
          panel.classList.contains("is-fullscreen") ||
          panel.classList.contains("is-expanded")
        ) return;
        const hostRect = host.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        dragState = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          panelX: panelRect.left - hostRect.left,
          panelY: panelRect.top - hostRect.top,
          panelSize: { width: panelRect.width, height: panelRect.height },
          hostSize: { width: hostRect.width, height: hostRect.height }
        };
        panel.classList.add("is-dragging");
        event.preventDefault();
      };

      addDomListener(titlebar, "pointerdown", onPointerDown);
      addDomListener(documentRef, "pointermove", onPointerMove);
      addDomListener(documentRef, "pointerup", finishDrag);
      addDomListener(documentRef, "pointercancel", finishDrag);
      addDomListener(root, "resize", constrainPanelToHost);
    }

    function updateExpandedUi() {
      panel?.classList.toggle("is-expanded", expanded);
      expandButton?.classList.toggle("is-active", expanded);
      expandButton?.setAttribute("aria-pressed", expanded ? "true" : "false");
      expandButton?.setAttribute("aria-label", expanded ? "还原实景窗口" : "放大实景窗口");
      expandButton?.setAttribute("title", expanded ? "还原实景窗口" : "放大实景窗口");
      setTimeout(() => resize(), 0);
    }

    function toggleExpanded(force) {
      if (!panel || documentRef?.fullscreenElement === panel || fullscreenFallback) return false;
      const next = typeof force === "boolean" ? force : !expanded;
      if (next === expanded) return expanded;

      if (next) {
        const hostRect = host?.getBoundingClientRect?.();
        const panelRect = panel.getBoundingClientRect();
        normalPanelRect = {
          left: panelRect.left - (hostRect?.left || 0),
          top: panelRect.top - (hostRect?.top || 0),
          width: panelRect.width,
          height: panelRect.height
        };
        panel.style.removeProperty("width");
        panel.style.removeProperty("height");
      } else if (normalPanelRect) {
        panel.style.left = `${normalPanelRect.left}px`;
        panel.style.top = `${normalPanelRect.top}px`;
        panel.style.right = "auto";
        panel.style.width = `${normalPanelRect.width}px`;
        panel.style.height = `${normalPanelRect.height}px`;
      }

      expanded = next;
      updateExpandedUi();
      return expanded;
    }

    function bindResizing() {
      if (!resizeHandle || !panel || !host || !documentRef) return;
      let resizeState = null;

      const onPointerMove = (event) => {
        if (!resizeState) return;
        const next = calculatePanelResize(
          resizeState,
          { x: event.clientX, y: event.clientY }
        );
        panel.style.width = `${next.width}px`;
        panel.style.height = `${next.height}px`;
        resize();
      };

      const finishResize = () => {
        if (!resizeState) return;
        resizeState = null;
        panel.classList.remove("is-resizing");
        constrainPanelToHost();
        resize();
      };

      const onPointerDown = (event) => {
        if (event.button !== 0 || panel.classList.contains("is-fullscreen")) return;
        toggleExpanded(false);
        const hostRect = host.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        resizeState = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          width: panelRect.width,
          height: panelRect.height,
          left: panelRect.left - hostRect.left,
          top: panelRect.top - hostRect.top,
          hostWidth: hostRect.width,
          hostHeight: hostRect.height
        };
        panel.style.left = `${resizeState.left}px`;
        panel.style.top = `${resizeState.top}px`;
        panel.style.right = "auto";
        try {
          resizeHandle.setPointerCapture?.(event.pointerId);
        } catch (_) {}
        panel.classList.add("is-resizing");
        event.preventDefault();
        event.stopPropagation();
      };

      addDomListener(resizeHandle, "pointerdown", onPointerDown);
      addDomListener(documentRef, "pointermove", onPointerMove);
      addDomListener(documentRef, "pointerup", finishResize);
      addDomListener(documentRef, "pointercancel", finishResize);
    }

    function bindResizeObservation() {
      if (!panel || typeof root.ResizeObserver !== "function") return;
      const observer = new root.ResizeObserver(() => resize());
      observer.observe(panel);
      cleanupCallbacks.push(() => observer.disconnect());
    }

    async function toggleFullscreen() {
      if (!panel || !documentRef) return false;
      try {
        if (documentRef.fullscreenElement === panel) {
          await documentRef.exitFullscreen();
        } else if (typeof panel.requestFullscreen === "function") {
          toggleExpanded(false);
          await panel.requestFullscreen();
        } else {
          toggleExpanded(false);
          fullscreenFallback = !fullscreenFallback;
          panel.classList.toggle("is-fullscreen", fullscreenFallback);
        }
      } catch (error) {
        fullscreenFallback = !fullscreenFallback;
        panel.classList.toggle("is-fullscreen", fullscreenFallback);
      }
      setTimeout(() => resize(), 0);
      return documentRef.fullscreenElement === panel || fullscreenFallback;
    }

    function updateFullscreenUi() {
      const active = documentRef?.fullscreenElement === panel || fullscreenFallback;
      panel?.classList.toggle("is-fullscreen", active);
      fullscreenButton?.classList.toggle("is-active", active);
      fullscreenButton?.setAttribute("aria-label", active ? "退出实景全屏" : "实景模型全屏");
      if (expandButton) expandButton.disabled = active;
      setTimeout(() => resize(), 0);
    }

    function bindControls() {
      if (controlsBound) return;
      resolveElements();
      if (titleEl) titleEl.textContent = config.title;
      addDomListener(toggleButton, "click", () => {
        show();
        enter().catch(() => {});
      });
      addDomListener(closeButton, "click", hide);
      addDomListener(resetButton, "click", resetView);
      addDomListener(terrainButton, "click", () => setTerrainEnabled(!terrainEnabled));
      addDomListener(expandButton, "click", () => toggleExpanded());
      addDomListener(titlebar, "dblclick", (event) => {
        if (event.target?.closest?.("button")) return;
        toggleExpanded();
      });
      addDomListener(fullscreenButton, "click", toggleFullscreen);
      addDomListener(retryButton, "click", retry);
      addDomListener(documentRef, "fullscreenchange", updateFullscreenUi);
      bindDragging();
      bindResizing();
      bindResizeObservation();
      controlsBound = true;
      updateTerrainUi();
      updateExpandedUi();
      setVisible(visible);
    }

    function createViewer() {
      if (!CesiumRef) throw new Error("Cesium 尚未加载");
      if (!container) throw new Error("未找到实景模型容器");

      const instance = new CesiumRef.Viewer(container, {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        selectionIndicator: false,
        infoBox: false,
        shouldAnimate: false,
        terrainProvider: new CesiumRef.EllipsoidTerrainProvider()
      });
      instance.scene.requestRenderMode = true;
      instance.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
      instance.scene.globe.depthTestAgainstTerrain = true;
      instance.scene.fxaa = false;
      const quality = getRealityRenderQuality(root.devicePixelRatio);
      instance.resolutionScale = quality.resolutionScale;
      instance.camera.percentageChanged = 0.02;
      return instance;
    }

    function applyHeightOffset(nextTileset) {
      if (!nextTileset || !config.heightOffset || !CesiumRef) return;
      const center = nextTileset.boundingSphere?.center;
      if (!center) return;
      const cartographic = CesiumRef.Cartographic.fromCartesian(center);
      const surface = CesiumRef.Cartesian3.fromRadians(
        cartographic.longitude,
        cartographic.latitude,
        0
      );
      const offset = CesiumRef.Cartesian3.fromRadians(
        cartographic.longitude,
        cartographic.latitude,
        config.heightOffset
      );
      const translation = CesiumRef.Cartesian3.subtract(
        offset,
        surface,
        new CesiumRef.Cartesian3()
      );
      nextTileset.modelMatrix = CesiumRef.Matrix4.fromTranslation(translation);
    }

    async function loadTileset() {
      if (tileset) return tileset;
      if (tilesetPromise) return tilesetPromise;
      setStatus("正在加载米埗村实景模型…", "loading");

      tilesetPromise = (async () => {
        const quality = getRealityRenderQuality(root.devicePixelRatio);
        const nextTileset = await CesiumRef.Cesium3DTileset.fromIonAssetId(
          config.ionAssetId,
          quality.tilesetOptions
        );
        if (destroyed) {
          nextTileset.destroy?.();
          return null;
        }
        tileset = viewer.scene.primitives.add(nextTileset);
        applyHeightOffset(tileset);
        setStatus("实景模型已就绪", "ready");
        await resetView();
        viewer.scene.requestRender();
        return tileset;
      })().catch((error) => {
        tilesetPromise = null;
        setStatus(`实景模型加载失败：${error?.message || error}`, "error");
        throw error;
      });

      return tilesetPromise;
    }

    function updateTerrainUi() {
      terrainButton?.classList.toggle("is-active", terrainEnabled);
      terrainButton?.setAttribute("aria-pressed", terrainEnabled ? "true" : "false");
      terrainButton?.setAttribute("title", terrainEnabled ? "关闭实景地形" : "开启实景地形");
    }

    async function setTerrainEnabled(nextEnabled) {
      terrainEnabled = !!nextEnabled;
      updateTerrainUi();
      if (!viewer || !CesiumRef) return terrainEnabled;

      if (!terrainEnabled) {
        viewer.terrainProvider = new CesiumRef.EllipsoidTerrainProvider();
        viewer.scene.requestRender();
        return false;
      }

      try {
        let provider = null;
        if (typeof CesiumRef.createWorldTerrainAsync === "function") {
          provider = await CesiumRef.createWorldTerrainAsync();
        } else if (typeof CesiumRef.createWorldTerrain === "function") {
          provider = CesiumRef.createWorldTerrain();
        }
        if (!provider) throw new Error("当前 Cesium 版本不支持在线地形");
        viewer.terrainProvider = provider;
        viewer.scene.requestRender();
        return true;
      } catch (error) {
        terrainEnabled = false;
        viewer.terrainProvider = new CesiumRef.EllipsoidTerrainProvider();
        updateTerrainUi();
        setStatus("在线地形不可用，已回退到椭球体", "warning");
        viewer.scene.requestRender();
        return false;
      }
    }

    function bindProxyClicks() {
      if (clickHandler || !viewer || !CesiumRef) return;
      clickHandler = new CesiumRef.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((movement) => {
        const picks = typeof viewer.scene.drillPick === "function"
          ? viewer.scene.drillPick(movement.position)
          : [viewer.scene.pick(movement.position)];
        const code = findProxyCodeFromPicks(picks);
        if (!code) return;
        options.onBuildingSelected?.(code);
      }, CesiumRef.ScreenSpaceEventType.LEFT_CLICK);
    }

    function removeProxyEntities() {
      if (!viewer) return;
      proxyMap.forEach((entity) => viewer.entities.remove(entity));
      proxyMap.clear();
    }

    function applyProxyRecords(records) {
      if (!viewer || !CesiumRef) return false;
      removeProxyEntities();

      records.forEach((record) => {
        const code = normalizeBuildingCode(record?.code);
        const positions = Array.isArray(record?.positions) ? record.positions : [];
        if (!code || positions.length < 3) return;
        const baseHeight = toFiniteNumber(record.baseHeight, 0);
        const height = Math.max(0.5, toFiniteNumber(record.height, 9));
        const entity = viewer.entities.add({
          id: `reality-proxy-${code}`,
          name: String(record.name || code),
          polygon: {
            hierarchy: new CesiumRef.PolygonHierarchy(positions),
            height: baseHeight,
            extrudedHeight: baseHeight + height,
            material: CesiumRef.Color.WHITE.withAlpha(0.01),
            outline: false,
            closeTop: true,
            closeBottom: true
          }
        });
        entity.__realityProxyCode = code;
        entity.__realityFocusRecord = {
          code,
          longitude: toFiniteNumber(record.longitude, Number.NaN),
          latitude: toFiniteNumber(record.latitude, Number.NaN),
          horizontalRadius: Math.max(1, toFiniteNumber(record.horizontalRadius, 6)),
          baseHeight,
          height
        };
        proxyMap.set(code, entity);
      });
      bindProxyClicks();
      viewer.scene.requestRender();
      return true;
    }

    function syncBuildingProxies(records = []) {
      pendingProxyRecords = Array.isArray(records) ? records.slice() : [];
      return applyProxyRecords(pendingProxyRecords);
    }

    async function sampleRealitySurfaceHeight(record) {
      if (!viewer?.scene || !CesiumRef ||
          typeof viewer.scene.sampleHeightMostDetailed !== "function") {
        return undefined;
      }
      const position = new CesiumRef.Cartographic(record.longitude, record.latitude, 0);
      const sampled = await viewer.scene.sampleHeightMostDetailed(
        [position],
        Array.from(proxyMap.values())
      );
      const height = sampled?.[0]?.height;
      return Number.isFinite(Number(height)) ? Number(height) : undefined;
    }

    function flyToRealityCloseup(camera) {
      const target = CesiumRef.Cartesian3.fromRadians(
        camera.longitude,
        camera.latitude,
        camera.targetHeight
      );
      const sphere = new CesiumRef.BoundingSphere(target, camera.radius);
      const offset = new CesiumRef.HeadingPitchRange(
        camera.heading,
        camera.pitch,
        camera.range
      );
      return new Promise((resolve, reject) => {
        viewer.camera.flyToBoundingSphere(sphere, {
          duration: 1.1,
          offset,
          complete: resolve,
          cancel: () => reject(new Error("camera flight cancelled"))
        });
      });
    }

    async function focusBuilding(sourceCode) {
      const code = normalizeBuildingCode(sourceCode);
      if (!code || destroyed) return false;
      const token = focusGate.next();
      show();
      try {
        await enter();
        if (!focusGate.isCurrent(token)) return false;
        const entity = proxyMap.get(code);
        if (!entity) {
          setStatus("该建筑暂无实景对应位置", "warning");
          return false;
        }
        const record = entity.__realityFocusRecord;
        const initialCamera = getRealityCloseupCamera(record, undefined, viewer.camera.heading);
        if (!initialCamera) {
          setStatus("该建筑缺少实景定位坐标", "warning");
          return false;
        }
        setStatus(`正在采样建筑 ${code} 的实景表面`, "loading");
        const sampledHeight = await sampleRealitySurfaceHeight(record);
        if (!focusGate.isCurrent(token)) return false;
        const closeup = getRealityCloseupCamera(record, sampledHeight, viewer.camera.heading);
        await flyToRealityCloseup(closeup);
        if (!focusGate.isCurrent(token)) return false;
        setStatus(
          closeup.sampled
            ? `已定位建筑 ${code}`
            : `已按近似高度定位建筑 ${code}`,
          closeup.sampled ? "ready" : "warning"
        );
        viewer.scene.requestRender();
        return true;
      } catch (error) {
        if (focusGate.isCurrent(token)) {
          setStatus(`建筑定位失败：${error?.message || error}`, "error");
        }
        return false;
      }
    }

    async function resetView() {
      if (!viewer || !tileset) return false;
      try {
        await viewer.flyTo(tileset, {
          duration: 0.8,
          offset: new CesiumRef.HeadingPitchRange(0, -0.55, 0)
        });
        viewer.scene.requestRender();
        return true;
      } catch (error) {
        return false;
      }
    }

    function resize() {
      if (!viewer || !visible) return false;
      viewer.resize();
      viewer.scene.requestRender();
      return true;
    }

    async function retry() {
      if (tileset && viewer) {
        viewer.scene.primitives.remove(tileset);
        tileset = null;
      }
      tilesetPromise = null;
      return loadTileset();
    }

    async function enter() {
      if (destroyed || !config.enabled) return false;
      bindControls();
      show();
      if (enterPromise) return enterPromise;
      enterPromise = (async () => {
        if (!viewer) viewer = createViewer();
        if (pendingProxyRecords.length) applyProxyRecords(pendingProxyRecords);
        const terrainTask = terrainEnabled ? setTerrainEnabled(true) : Promise.resolve(false);
        await Promise.allSettled([terrainTask, loadTileset()]);
        resize();
        return !!tileset;
      })().finally(() => {
        enterPromise = null;
      });
      return enterPromise;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cleanupCallbacks.splice(0).forEach((cleanup) => {
        try {
          cleanup();
        } catch (_) {}
      });
      if (clickHandler) {
        clickHandler.destroy();
        clickHandler = null;
      }
      proxyMap.clear();
      if (viewer && !viewer.isDestroyed?.()) viewer.destroy();
      viewer = null;
      tileset = null;
      tilesetPromise = null;
      enterPromise = null;
      pendingProxyRecords = [];
    }

    resolveElements();

    return {
      enter,
      show,
      hide,
      toggle,
      toggleExpanded,
      resetView,
      setTerrainEnabled,
      syncBuildingProxies,
      focusBuilding,
      resize,
      destroy
    };
  }

  return {
    normalizeConfig,
    clampPanelPosition,
    clampPanelSize,
    calculatePanelResize,
    getRealityRenderQuality,
    resolveRealityTargetHeight,
    getRealityCloseupCamera,
    normalizeBuildingCode,
    createFocusRequestGate,
    findProxyCodeFromPicks,
    createController
  };
});
