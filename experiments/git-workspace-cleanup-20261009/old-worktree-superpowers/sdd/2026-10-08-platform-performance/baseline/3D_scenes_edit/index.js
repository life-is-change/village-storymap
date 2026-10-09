(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./domain/scene-document") : root.SceneDocumentModule,
    typeof module === "object" && module.exports ? require("./domain/scene-commands") : root.SceneCommandsModule,
    typeof module === "object" && module.exports ? require("./domain/geometry-rules") : root.SceneGeometryRulesModule,
    typeof module === "object" && module.exports ? require("./persistence/scene-edit-client") : root.SceneEditClientModule,
    typeof module === "object" && module.exports ? require("./persistence/local-draft-store") : root.SceneLocalDraftStoreModule,
    typeof module === "object" && module.exports ? require("./persistence/autosave-controller") : root.SceneAutosaveControllerModule,
    typeof module === "object" && module.exports ? require("./map_2d/scene-layer-adapter") : root.SceneLayerAdapterModule,
    typeof module === "object" && module.exports ? require("./map_2d/scene-editor-controller") : root.SceneEditorControllerModule,
    typeof module === "object" && module.exports ? require("./map_2d/openlayers-interactions") : root.SceneOpenLayersInteractionsModule,
    typeof module === "object" && module.exports ? require("./preview_3d/scene-preview-adapter") : root.ScenePreviewAdapterModule,
    typeof module === "object" && module.exports ? require("./interaction_3d/cesium-scene-interactions") : root.CesiumSceneInteractionsModule,
    typeof module === "object" && module.exports ? require("./assets/scene-asset-library") : root.SceneAssetLibraryModule,
    typeof module === "object" && module.exports ? require("./ui/scene-studio-panel") : root.SceneStudioPanelModule
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEditStudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SceneDocument, Commands, Geometry, Client, DraftStore, Autosave, Layers, Editor, Interactions, Preview, CesiumInteractions, Assets, Panel) {
  const REQUIRED_CONTEXT = ["userId", "teachingProjectId", "courseId", "villageId", "spaceId"];

  function validateContext(context) {
    const errors = [];
    for (const key of REQUIRED_CONTEXT) if (typeof context?.[key] !== "string" || !context[key].trim()) errors.push(`${key} is required`);
    const scopeKind = context?.scopeKind || "group";
    if (!['group', 'admin_sandbox'].includes(scopeKind)) errors.push("scopeKind is invalid");
    if (scopeKind === "group" && (typeof context?.groupId !== "string" || !context.groupId.trim())) errors.push("groupId is required");
    if (scopeKind === "admin_sandbox" && (typeof context?.ownerId !== "string" || !context.ownerId.trim())) errors.push("ownerId is required");
    if (!Number.isInteger(context?.baselineRevision) || context.baselineRevision < 0) errors.push("baselineRevision must be a non-negative integer");
    if (!Array.isArray(context?.baselineFeatures)) errors.push("baselineFeatures must be an array");
    return { ok: errors.length === 0, errors };
  }

  function buildDraftIdentity(context, projectId) {
    return {
      userId: context.userId,
      scopeKind: context.scopeKind || "group",
      ownerId: context.ownerId || context.userId,
      groupId: context.groupId || null,
      spaceId: context.spaceId,
      projectId
    };
  }

  function chooseInitialDocument(serverDocument, localRecord) {
    const localRevision = Number(localRecord?.revision ?? -1);
    const serverRevision = Number(serverDocument?.revision ?? -1);
    const sameRevisionButNewer = localRevision === serverRevision && Date.parse(localRecord?.savedAt || 0) > Date.parse(serverDocument?.updatedAt || 0);
    if (localRecord?.document && (localRevision > serverRevision || sameRevisionButNewer)) return localRecord.document;
    return serverDocument;
  }

  function needsBaselineBranch(document, context) {
    return Number(document?.baselineRef?.revision ?? 0) < Number(context?.baselineRevision ?? 0);
  }

  function patchForProperty(path, value, object) {
    if (path === "transform.scaleXY") {
      const z = Number(object?.transform?.scale?.[2]) || 1;
      return { transform: { scale: [Number(value), Number(value), z] } };
    }
    if (path === "transform.scaleZ") {
      const xy = Number(object?.transform?.scale?.[0]) || 1;
      const y = Number(object?.transform?.scale?.[1]) || xy;
      return { transform: { scale: [xy, y, Number(value)] } };
    }
    const [section, key] = String(path || "").split(".");
    if (!['transform', 'properties'].includes(section) || !key) throw new Error(`Unsupported property path: ${path}`);
    return { [section]: { [key]: value } };
  }

  function createObjectInputForTool(tool, geometry, asset) {
    if (tool === "draw-line") {
      const selected = asset?.kind === "line" ? asset : null;
      return {
        kind: "line",
        category: selected?.category || "path",
        geometry,
        properties: selected
          ? { assetRef: selected.id, displayName: selected.label || selected.displayName, widthM: selected.footprintM?.[0] || 1.5, heightM: selected.defaultHeightM || 0 }
          : { widthM: 1.5, heightM: 0 }
      };
    }
    if (tool === "draw-surface" || tool === "draw-rectangle") {
      const selected = asset?.kind === "surface" ? asset : null;
      return {
        kind: "surface",
        category: selected?.category || "paving",
        geometry,
        properties: selected
          ? { assetRef: selected.id, displayName: selected.label || selected.displayName, materialRef: selected.id, elevationM: 0, extrusionHeightM: selected.defaultHeightM || 0 }
          : { elevationM: 0, extrusionHeightM: 0.08 }
      };
    }
    if (tool === "place-asset" && asset) {
      return {
        kind: asset.kind === "structure" ? "structure" : "asset",
        category: asset.category,
        geometry,
        properties: { assetRef: asset.id, displayName: asset.label || asset.displayName, footprintM: asset.footprintM || [1, 1], heightM: asset.defaultHeightM || 0 }
      };
    }
    return null;
  }

  function toolForAsset(asset) {
    return asset?.kind === "surface" ? "draw-surface" : asset?.kind === "line" ? "draw-line" : "place-asset";
  }

  function toolRequires2D(tool) {
    return ["draw-rectangle", "box-select", "measure", "edit-nodes"].includes(tool);
  }

  function createFrameScheduler(task, requestFrame) {
    let scheduled = false;
    let latestValue;
    return function schedule(value) {
      latestValue = value;
      if (scheduled) return;
      scheduled = true;
      requestFrame(() => {
        scheduled = false;
        task(latestValue);
      });
    };
  }

  function createActionDispatcher(options) {
    const controller = options.controller;
    const lifecycle = options.lifecycle;
    return async function dispatch(action) {
      if (action.type === "tool") {
        controller.setTool(action.value);
        return lifecycle.activateTool?.(action.value);
      }
      if (action.type === "undo") return controller.undo();
      if (action.type === "redo") return controller.redo();
      if (action.type === "copy" || action.type === "duplicate") return controller.duplicateSelection();
      if (action.type === "delete") return controller.deleteSelection();
      if (action.type === "group") return controller.groupSelection();
      if (action.type === "align") return controller.alignSelection(action.value);
      if (action.type === "distribute") return controller.distributeSelection(action.value);
      if (action.type === "mode") return lifecycle.switchMode(action.value);
      if (action.type === "select-object") return lifecycle.selectObject ? lifecycle.selectObject(action.value) : controller.select([action.value]);
      if (action.type === "finish-boundary-edit") return lifecycle.finishBoundaryEdit?.();
      if (action.type === "cancel-boundary-edit") return lifecycle.cancelBoundaryEdit?.();
      if (action.type === "delete-boundary-vertex") return lifecycle.deleteBoundaryVertex?.();
      if (action.type === "layer-visible") return controller.toggleLayerVisible(action.value);
      if (action.type === "layer-lock") return controller.toggleLayerLocked(action.value);
      if (action.type === "add-layer") return controller.addLayer();
      if (action.type === "layer-rename") return controller.renameLayer(action.value, action.name);
      if (action.type === "layer-delete") return controller.deleteLayer(action.value);
      if (action.type === "inspect-properties") return lifecycle.inspectProperties?.();
      if (action.type === "layer-move") {
        const [layerId, direction] = String(action.value).split("|");
        const layers = controller.getState().document.layers.slice().sort((a, b) => a.order - b.order);
        const index = layers.findIndex((layer) => layer.id === layerId);
        if (index < 0) return undefined;
        return controller.reorderLayer(layerId, Math.max(0, Math.min(layers.length - 1, index + (direction === "up" ? -1 : 1))));
      }
      if (action.type === "property") {
        const state = controller.getState();
        const object = state.document.objects.find((item) => state.selectedIds.includes(item.id));
        return object ? controller.updateSelection(patchForProperty(action.path, action.value, object)) : undefined;
      }
      if (action.type === "choose-asset") return lifecycle.chooseAsset(action.value);
      if (action.type === "upload-asset") return lifecycle.uploadAsset();
      if (action.type === "cancel") return lifecycle.cancel();
      if (action.type === "milestone") return lifecycle.createMilestone();
      if (action.type === "compare-version") return lifecycle.compareVersion(action.value);
      if (action.type === "restore-version") return lifecycle.restoreVersion(action.value);
      if (action.type === "submit-version") return lifecycle.submitVersion(action.value);
      if (action.type === "conflict-local") return lifecycle.resolveConflict("local");
      if (action.type === "conflict-remote") return lifecycle.resolveConflict("remote");
      if (action.type === "conflict-copy") return lifecycle.resolveConflict("copy");
      if (action.type === "close") return lifecycle.close();
      return undefined;
    };
  }

  async function loadSeedAssets(fetchImpl) {
    if (!fetchImpl) return [];
    try {
      const response = await fetchImpl("3D_scenes_edit/assets/seed/catalog.json?v=20260920-library");
      if (!response.ok) return [];
      return (await response.json()).assets || [];
    } catch (_error) {
      return [];
    }
  }

  async function create(options) {
    const contextCheck = validateContext(options?.context);
    const panel = Panel.createSceneStudioPanel({ root: options.root, onAction: (action) => dispatch?.(action), onRendered: options.onPanelRender });
    if (!contextCheck.ok) {
      panel.render(Panel.buildViewModel({ phase: "no-project", title: "公共空间设计" }));
      return { ok: false, code: "INVALID_CONTEXT", errors: contextCheck.errors, dispose: () => panel.dispose() };
    }
    const context = { ...options.context, baselineFeatures: SceneDocument.clone(options.context.baselineFeatures) };
    const client = (options.services?.client) || Client.createSceneEditClient({ supabaseClient: options.supabaseClient });
    let document;
    if (!context.projectId && client.findActiveProject) {
      const existing = await client.findActiveProject(context);
      if (!existing.ok) return { ...existing, dispose: () => panel.dispose() };
      context.projectId = existing.data?.id || null;
    }
    if (context.projectId) {
      const loaded = await client.loadProject(context.projectId);
      if (!loaded.ok) return { ...loaded, dispose: () => panel.dispose() };
      document = loaded.data;
      if (needsBaselineBranch(document, context) && client.branchFromBaseline && await options.confirmBaselineUpgrade?.(document, context)) {
        const branch = await client.branchFromBaseline({ projectId: document.projectId, baselineRevision: context.baselineRevision, title: `${context.title || "公共空间方案"} · 新现状分支` });
        if (!branch.ok) return { ...branch, dispose: () => panel.dispose() };
        context.projectId = branch.data.id;
        const branched = await client.loadProject(context.projectId);
        if (!branched.ok) return { ...branched, dispose: () => panel.dispose() };
        document = branched.data;
      }
    } else {
      const created = await client.createProject({
        teachingProjectId: context.teachingProjectId,
        villageId: context.villageId,
        spaceId: context.spaceId,
        groupId: context.groupId,
        scopeKind: context.scopeKind || "group",
        ownerId: context.ownerId || context.userId,
        title: context.title || "公共空间方案",
        baselineRevision: context.baselineRevision,
        selectionBoundary: context.selectionBoundary || null
      });
      if (!created.ok) return { ...created, dispose: () => panel.dispose() };
      document = SceneDocument.create({
        projectId: created.data.id,
        villageId: context.villageId,
        groupId: context.groupId,
        spaceId: context.spaceId,
        scopeKind: context.scopeKind || "group",
        ownerId: context.ownerId || context.userId,
        baselineRevision: context.baselineRevision,
        revision: created.data.revision || 0,
        selectionBoundary: context.selectionBoundary || null
      });
    }
    let identity = buildDraftIdentity(context, document.projectId);
    const localStore = options.services?.localStore || DraftStore.createLocalDraftStore(options.storage || globalThis.localStorage);
    document = chooseInitialDocument(document, localStore.read(identity));
    const adapter = options.services?.adapter || Layers.createSceneLayerAdapter({ ol: options.ol || globalThis.ol, map: options.map });
    adapter.mount?.();
    let controller;
    let mapInteractionBridge = null;
    let interactionBridge = options.services?.cesiumInteractions || options.services?.interactions || null;
    let previewAdapter = options.services?.preview || null;
    let cesiumEnvironment = null;
    let mode = "3d";
    let assets = context.seedAssets || await loadSeedAssets(options.fetch || globalThis.fetch?.bind(globalThis));
    if (client.listAssets) {
      const listedAssets = await client.listAssets({ courseId: context.courseId, groupId: context.groupId });
      if (listedAssets.ok) assets = [...assets, ...(listedAssets.data || []).map(Assets.toCatalogAsset).filter(Boolean)];
    }
    adapter.setAssets?.(assets);
    let activeAsset = assets.find((asset) => asset.category === "bench") || null;
    let versions = [];
    let comparisonIds = [];
    let comparisonAdapters = [];
    let interactionStatus = "";
    const requestFrame = options.requestAnimationFrame || globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
    const schedulePreviewRender = createFrameScheduler(({ nextDocument, catalog }) => {
      if (previewAdapter && mode === "3d") void previewAdapter.render(nextDocument, catalog);
    }, requestFrame);
    if (client.listVersions) {
      const listedVersions = await client.listVersions(document.projectId);
      if (listedVersions.ok) versions = listedVersions.data || [];
    }
    const autosave = Autosave.createAutosaveController({
      save: (nextDocument) => client.saveDraft(nextDocument),
      localDraftStore: localStore,
      onStateChange(nextSave) {
        if (nextSave.status === "offline" || nextSave.status === "conflict") render();
        else panel.updateSaveState?.({ ...nextSave, revision: document.revision });
      },
      onSaved(result) { controller?.acknowledgeSavedRevision?.(result.data?.revision, result.data?.updatedAt); render(); }
    });
    function phase() {
      const saveStatus = autosave.getState().status;
      if (saveStatus === "offline" || saveStatus === "conflict") return saveStatus;
      return document.selectionBoundary ? "editing" : "drawing-boundary";
    }
    function currentViewModel() {
      const state = controller?.getState() || { document, selectedIds: [], tool: "select" };
      document = state.document;
      const selectedObject = document.objects.find((object) => state.selectedIds.includes(object.id)) || null;
      return Panel.buildViewModel({
        phase: phase(), title: context.title || "公共空间方案", mode, activeTool: state.tool,
        selectedIds: state.selectedIds, selectedObject, layers: document.layers, objects: document.objects,
        selectionBoundary: document.selectionBoundary,
        assets, canUndo: state.canUndo, canRedo: state.canRedo, saveStatus: autosave.getState().status,
        revision: document.revision, updatedAt: document.updatedAt,
        versions, comparisonIds,
        interactionStatus,
        conflict: autosave.getState().status === "conflict" ? { remoteRevision: autosave.getState().remoteRevision } : null
      });
    }
    function render() {
      const model = currentViewModel();
      panel.render(model);
      const state = controller?.getState() || { selectedIds: [] };
      if (previewAdapter && mode === "3d") previewAdapter.select?.(state.selectedIds);
    }
    function schedule2DBoundaryFit() {
      requestFrame(() => {
        if (mode !== "2d") return;
        options.map?.updateSize?.();
        adapter.fitBoundary?.(document.selectionBoundary);
      });
    }
    let hydratingTopViews = false;
    async function hydratePlacedAssetTopViews() {
      if (hydratingTopViews) return;
      hydratingTopViews = true;
      try {
        const refs = new Set((document.objects || []).map((object) => object.properties?.assetRef).filter(Boolean));
        for (const asset of assets) {
          if (!refs.has(asset.id) || asset.topViewUrl || asset.fileType !== "glb") continue;
          try {
            let url = null;
            if (asset.topViewPath && options.assetResolver) url = await options.assetResolver({ storagePath: asset.topViewPath });
            else if (options.topViewGenerator) url = await options.topViewGenerator(asset);
            if (url) {
              asset.topViewUrl = url;
              adapter.setAssets?.(assets);
            }
          } catch (error) {
            console.warn("生成二维素材俯视图失败，已使用分类符号：", asset.id, error);
          }
        }
      } finally {
        hydratingTopViews = false;
      }
    }
    function updateSelectionUI(focusId) {
      const model = currentViewModel();
      panel.updateSelection?.(model);
      previewAdapter?.select?.(model.selectedIds);
      if (focusId && mode === "3d") previewAdapter?.flyToObject?.(focusId);
      return model.selectedIds;
    }
    controller = Editor.createSceneEditorController({
      adapter,
      history: Commands.createHistory(document),
      geometryRules: Geometry,
      baselineBuildings: context.baselineFeatures.filter((feature) => feature.layerKey === "building").map((feature) => feature.geometry).filter(Boolean),
      villageBoundary: context.villageBoundary || null,
      idFactory: options.idFactory || (() => globalThis.crypto?.randomUUID?.() || `scene-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      onDocumentChange(nextDocument, command) {
        document = nextDocument;
        autosave.markDirty(document, identity);
        interactionBridge?.setDocument?.(document);
        if (previewAdapter && mode === "3d") {
          const previewRequest = { nextDocument: document, catalog: new Map(assets.map((asset) => [asset.id, asset])) };
          if (command?.type === "updateObject" || command?.type === "updateObjects") schedulePreviewRender(previewRequest);
          else void previewAdapter.render(previewRequest.nextDocument, previewRequest.catalog);
        }
        render();
      },
      onStatus(status) { options.onStatus?.(status); }
    });
    if ((options.ol || globalThis.ol)?.interaction && adapter.getSource?.()) {
      mapInteractionBridge = Interactions.createOpenLayersInteractions({
        ol: options.ol || globalThis.ol,
        map: options.map,
        source: adapter.getSource(),
        layer: adapter.getLayer(),
        projection: options.projection,
        onSelect(ids) { controller.select(ids); updateSelectionUI(); },
        onCreate(drawTool, geometry) {
          if (!controller.getState().document.selectionBoundary && (drawTool === "draw-surface" || drawTool === "draw-rectangle")) {
            controller.setSelectionBoundary(geometry);
            controller.setTool("select");
            mapInteractionBridge.activate("select");
          } else {
            const input = createObjectInputForTool(drawTool, geometry, activeAsset);
            if (input) controller.createObject(input);
          }
          render();
        },
        onGeometryChange(id, geometry) { controller.select([id]); controller.updateSelection({ geometry }); },
        onMeasure(geometry) { options.onStatus?.({ level: "info", code: "MEASUREMENT", measurements: Editor.measureGeometry(geometry, Geometry) }); }
      });
    }

    async function ensureCesiumEditing() {
      if ((!previewAdapter || !interactionBridge) && options.ensure3D) cesiumEnvironment = await options.ensure3D();
      if (!previewAdapter && cesiumEnvironment?.viewer && cesiumEnvironment?.Cesium) {
        previewAdapter = Preview.createScenePreviewAdapter({
          Cesium: cesiumEnvironment.Cesium,
          viewer: cesiumEnvironment.viewer,
          assetResolver: options.assetResolver
        });
      }
      if (!interactionBridge && cesiumEnvironment?.viewer && cesiumEnvironment?.Cesium && CesiumInteractions?.createCesiumSceneInteractions) {
        interactionBridge = CesiumInteractions.createCesiumSceneInteractions({
          Cesium: cesiumEnvironment.Cesium,
          viewer: cesiumEnvironment.viewer,
          previewAdapter,
          onBoundaryComplete(geometry) {
            const result = controller.setSelectionBoundary(geometry);
            if (result.ok) {
              controller.setTool("select");
              interactionBridge.activate("select");
            }
            render();
          },
          onPlace({ asset, coordinate }) {
            const input = createObjectInputForTool("place-asset", { type: "Point", coordinates: coordinate }, asset);
            const result = input ? controller.createObject(input) : null;
            previewAdapter?.clearGhost?.();
            if (result?.ok) updateSelectionUI(result.object.id);
          },
          onCreate({ tool, asset, geometry }) {
            const input = createObjectInputForTool(tool, geometry, asset);
            const result = input ? controller.createObject(input) : null;
            if (result?.ok) updateSelectionUI(result.object.id);
          },
          onSelect(ids) { controller.select(ids); updateSelectionUI(); },
          onMove({ id, coordinate }) { controller.moveObject(id, coordinate); updateSelectionUI(); },
          onStatus(status) {
            interactionStatus = status?.message || "";
            options.onStatus?.({ level: status.tone === "warning" ? "warning" : "info", ...status });
            panel.updateStatus?.(interactionStatus);
          }
        });
      }
      interactionBridge?.setAsset?.(activeAsset);
      interactionBridge?.setDocument?.(document);
      return { previewAdapter, interactionBridge };
    }
    function enterPropertyInspection() {
      controller.setTool("select");
      if (mode === "3d") interactionBridge?.activate?.("select");
      else mapInteractionBridge?.activate?.("select");
      panel.updateActiveTool?.("select");
      return { ok: true, tool: "select" };
    }
    const lifecycle = {
      selectObject(id) {
        enterPropertyInspection();
        controller.select(id ? [id] : []);
        return updateSelectionUI(id);
      },
      inspectProperties() { return enterPropertyInspection(); },
      finishBoundaryEdit() {
        const result = interactionBridge?.finishBoundaryEdit?.();
        if (result) {
          controller.setTool("select");
          interactionBridge?.activate?.("select");
          render();
        }
        return result;
      },
      cancelBoundaryEdit() {
        const result = interactionBridge?.cancelBoundaryEdit?.();
        controller.setTool("select");
        interactionBridge?.activate?.("select");
        render();
        return result;
      },
      deleteBoundaryVertex() { return interactionBridge?.deleteSelectedBoundaryVertex?.(); },
      async switchMode(nextMode) {
        mode = nextMode === "3d" ? "3d" : "2d";
        await options.onModeChange?.(mode);
        if (mode === "3d") {
          await ensureCesiumEditing();
          if (previewAdapter) {
            await previewAdapter.render(document, new Map(assets.map((asset) => [asset.id, asset])));
            previewAdapter.flyToBoundary?.(document.selectionBoundary);
          }
          interactionBridge?.activate?.(document.selectionBoundary ? controller.getState().tool : "draw-boundary");
        } else {
          interactionBridge?.cancel?.();
          mapInteractionBridge?.activate?.(document.selectionBoundary ? controller.getState().tool : "draw-surface");
          void hydratePlacedAssetTopViews();
        }
        render();
        if (mode === "2d") schedule2DBoundaryFit();
        return { ok: true, mode };
      },
      async createMilestone() {
        await autosave.flush();
        const result = await options.onMilestone?.({ document, client, context }) || { ok: false, code: "MILESTONE_DIALOG_UNAVAILABLE" };
        if (result.ok && client.listVersions) {
          const listed = await client.listVersions(document.projectId);
          if (listed.ok) versions = listed.data || [];
        }
        render();
        return result;
      },
      async compareVersion(versionId) {
        comparisonIds = comparisonIds.includes(versionId) ? comparisonIds.filter((id) => id !== versionId) : [...comparisonIds, versionId].slice(-2);
        comparisonAdapters.forEach((item) => item.dispose());
        comparisonAdapters = [];
        const switchedTo2D = comparisonIds.length && mode !== "2d";
        if (switchedTo2D) await lifecycle.switchMode("2d");
        for (const [index, id] of comparisonIds.entries()) {
          const version = versions.find((item) => item.id === id);
          if (!version?.document || !options.map || !(options.ol || globalThis.ol)) continue;
          const compare = Layers.createSceneLayerAdapter({ ol: options.ol || globalThis.ol, map: options.map, zIndex: 1180 + index, forcedStyleToken: index ? "compareB" : "compareA" });
          compare.setAssets?.(assets);
          compare.mount();
          compare.render(version.document, { forcedStyleToken: index ? "compareB" : "compareA" });
          comparisonAdapters.push(compare);
        }
        interactionStatus = comparisonIds.length
          ? "版本对比：蓝色为里程碑，绿色或橙色为当前草稿"
          : "已退出版本对比";
        render();
        if (comparisonIds.length && !switchedTo2D) schedule2DBoundaryFit();
        return { ok: true, comparisonIds: comparisonIds.slice() };
      },
      async restoreVersion(versionId) {
        if (options.confirmAction && !await options.confirmAction("恢复该版本为一份新的草稿？当前方案不会被覆盖。")) return { ok: false, code: "CANCELLED" };
        const result = await client.restoreVersionAsDraft({ versionId, title: `${context.title || "公共空间方案"} · 恢复` });
        if (result.ok) options.onProjectRestored?.(result.data);
        return result;
      },
      async submitVersion(versionId) {
        if (options.confirmAction && !await options.confirmAction("提交该里程碑版本？提交后该快照不可修改。")) return { ok: false, code: "CANCELLED" };
        const result = await client.submitVersion(versionId);
        if (result.ok) {
          versions = versions.map((version) => version.id === versionId ? { ...version, submission_status: "submitted" } : version);
          render();
        }
        return result;
      },
      async resolveConflict(choice) {
        if (choice === "local") {
          options.onKeepLocalCopy?.(document);
          autosave.resolve("offline");
          render();
          return { ok: true, keptLocal: true };
        }
        if (choice === "remote") {
          const loaded = await client.loadProject(document.projectId);
          if (loaded.ok) { document = loaded.data; controller.replaceDocument(document); autosave.resolve("saved"); render(); }
          return loaded;
        }
        if (choice === "copy") {
          const created = await client.createProject({ teachingProjectId: context.teachingProjectId, villageId: context.villageId, spaceId: context.spaceId, groupId: context.groupId, scopeKind: context.scopeKind || "group", ownerId: context.ownerId || context.userId, title: `${context.title || "公共空间方案"} · 本地副本`, baselineRevision: document.baselineRef.revision, selectionBoundary: document.selectionBoundary });
          if (!created.ok) return created;
          const copy = SceneDocument.clone(document);
          copy.projectId = created.data.id;
          copy.revision = 0;
          const saved = await client.saveDraft(copy);
          if (saved.ok) {
            copy.revision = saved.data?.revision ?? 1;
            document = copy;
            identity = buildDraftIdentity(context, copy.projectId);
            controller.replaceDocument(copy);
            autosave.resolve("saved");
            render();
          }
          return saved;
        }
        return { ok: false, code: "UNKNOWN_CONFLICT_CHOICE" };
      },
      activateTool(nextTool) {
        const requires2D = toolRequires2D(nextTool);
        if (mode === "3d" && requires2D) return lifecycle.switchMode("2d").then(() => mapInteractionBridge?.activate?.(nextTool));
        const result = mode === "3d" ? interactionBridge?.activate?.(nextTool) : mapInteractionBridge?.activate?.(nextTool);
        render();
        return result;
      },
      chooseAsset(assetId) {
        activeAsset = assets.find((asset) => asset.id === assetId) || null;
        if (!activeAsset) return;
        const nextTool = toolForAsset(activeAsset);
        controller.setTool(nextTool);
        interactionBridge?.setAsset?.(activeAsset);
        if (mode === "3d") interactionBridge?.activate?.(nextTool);
        else mapInteractionBridge?.activate?.(nextTool);
        render();
      },
      async uploadAsset() {
        const result = await options.onUploadAsset?.({ assetLibrary: Assets, client, context });
        if (result?.asset) {
          assets = [result.asset, ...assets.filter((asset) => asset.id !== result.asset.id)];
          adapter.setAssets?.(assets);
        }
        render();
        return result;
      },
      cancel() { controller.setTool("select"); if (mode === "3d") interactionBridge?.activate?.("select"); else mapInteractionBridge?.activate?.("select"); render(); },
      close() { options.onClose?.(); }
    };
    const dispatch = createActionDispatcher({ controller, lifecycle });
    if (!document.selectionBoundary) controller.setTool("draw-boundary");
    await lifecycle.switchMode("3d");
    panel.focus();
    return {
      ok: true,
      getDocument: () => document,
      getState: () => ({ ...controller.getState(), mode, save: autosave.getState(), versions: versions.slice(), comparisonIds: comparisonIds.slice() }),
      setSelectionBoundary: (geometry) => controller.setSelectionBoundary(geometry),
      createObject: (input) => controller.createObject(input),
      select: (ids, selectOptions) => controller.select(ids, selectOptions),
      updateSelection: (patch) => controller.updateSelection(patch),
      switchMode: (nextMode) => lifecycle.switchMode(nextMode),
      dispatch,
      async flush() { return autosave.flush(); },
      dispose() { autosave.dispose(); comparisonAdapters.forEach((item) => item.dispose()); previewAdapter?.dispose?.(); interactionBridge?.dispose?.(); mapInteractionBridge?.dispose?.(); controller.dispose(); panel.dispose(); },
      setAssets(nextAssets) { assets = nextAssets || []; adapter.setAssets?.(assets); activeAsset = assets.find((asset) => asset.id === activeAsset?.id) || assets.find((asset) => asset.category === "bench") || null; interactionBridge?.setAsset?.(activeAsset); render(); }
    };
  }

  return { validateContext, buildDraftIdentity, chooseInitialDocument, needsBaselineBranch, patchForProperty, createObjectInputForTool, toolForAsset, toolRequires2D, createFrameScheduler, createActionDispatcher, create };
});
