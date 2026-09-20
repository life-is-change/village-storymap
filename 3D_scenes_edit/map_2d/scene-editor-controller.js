(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../domain/scene-document") : root.SceneDocumentModule,
    typeof module === "object" && module.exports ? require("../domain/scene-commands") : root.SceneCommandsModule,
    typeof module === "object" && module.exports ? require("../domain/geometry-rules") : root.SceneGeometryRulesModule
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEditorControllerModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SceneDocument, Commands, DefaultGeometryRules) {
  const TOOLS = Object.freeze(["select", "box-select", "draw-boundary", "edit-boundary", "draw-surface", "draw-rectangle", "draw-line", "place-asset", "move", "rotate", "scale", "measure", "pan", "edit-nodes"]);
  const SNAP_PRIORITY = Object.freeze({ endpoint: 0, edge: 1, center: 2, baseline: 3 });

  function findSnapCoordinate(position, options) {
    const geometry = options?.geometryRules || DefaultGeometryRules;
    const origin = options?.origin || position;
    const toleranceM = Number(options?.toleranceM) || 0.75;
    const candidates = (options?.candidates || []).map((candidate) => {
      const local = geometry.toLocalMeters(candidate.coordinate, origin);
      return { ...candidate, distance: Math.hypot(local[0], local[1]), priority: SNAP_PRIORITY[candidate.type] ?? 99 };
    }).filter((candidate) => candidate.distance <= toleranceM)
      .sort((a, b) => a.priority - b.priority || a.distance - b.distance);
    if (candidates.length) return { coordinate: candidates[0].coordinate.slice(), type: candidates[0].type, distanceM: candidates[0].distance };
    return { coordinate: geometry.snapCoordinate(position, { origin, gridM: options?.gridM || 0.5 }), type: "grid", distanceM: null };
  }

  function measureGeometry(geometry, rules) {
    if (geometry?.type === "Polygon") return { areaM2: rules.measureAreaM2(geometry) };
    if (geometry?.type !== "LineString") return {};
    const result = { lengthM: rules.measureLengthM(geometry) };
    if (geometry.coordinates.length >= 3) {
      const middle = geometry.coordinates.length - 2;
      const origin = geometry.coordinates[middle];
      const before = rules.toLocalMeters(geometry.coordinates[middle - 1], origin);
      const after = rules.toLocalMeters(geometry.coordinates[middle + 1], origin);
      const dot = before[0] * after[0] + before[1] * after[1];
      const denominator = Math.hypot(...before) * Math.hypot(...after);
      result.angleDeg = denominator ? Math.acos(Math.max(-1, Math.min(1, dot / denominator))) * 180 / Math.PI : 0;
    }
    return result;
  }

  function defaultTransform() {
    return { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 };
  }

  function createSceneEditorController(options) {
    const adapter = options.adapter;
    const rules = options.geometryRules;
    const idFactory = options.idFactory;
    const groupIdFactory = options.groupIdFactory || (() => `group-${idFactory()}`);
    const onDocumentChange = options.onDocumentChange || function () {};
    const onStatus = options.onStatus || function () {};
    const baselineBuildings = options.baselineBuildings || [];
    const villageBoundary = options.villageBoundary || null;
    let history = options.history;
    let selectedIds = [];
    let tool = "select";
    let errorIds = [];

    function render() {
      adapter.render(history.present, { selectedIds, errorIds, tool });
    }

    function apply(command) {
      history = Commands.execute(history, command);
      onDocumentChange(history.present, command);
      render();
      return history.present;
    }

    function layerFor(id) {
      return history.present.layers.find((layer) => layer.id === id);
    }

    function reject(code, message, objectId) {
      if (objectId) errorIds = [...new Set([...errorIds, objectId])];
      const result = { ok: false, code, message };
      onStatus({ level: "error", ...result });
      render();
      return result;
    }

    function createObject(input) {
      const layerId = input.layerId || "design";
      if (layerFor(layerId)?.locked) return reject("LAYER_LOCKED", "图层已锁定");
      if (history.present.selectionBoundary && !rules.containsGeometry(history.present.selectionBoundary, input.geometry)) {
        return reject("OUTSIDE_BOUNDARY", "对象必须位于当前设计范围内");
      }
      const object = {
        id: idFactory(),
        kind: input.kind,
        category: input.category,
        geometry: SceneDocument.clone(input.geometry),
        properties: { ...(input.properties || {}) },
        layerId,
        groupId: null,
        zIndex: history.present.objects.length
      };
      if (input.kind === "asset" || input.kind === "structure") object.transform = { ...defaultTransform(), ...(input.transform || {}) };
      const validation = SceneDocument.validateObject(object);
      if (!validation.ok) return reject("INVALID_OBJECT", validation.errors.join("; "));
      apply({ type: "addObject", object });
      selectedIds = [object.id];
      if (rules.intersectsAny(input.geometry, baselineBuildings)) onStatus({ level: "warning", code: "BASELINE_COLLISION", message: "对象与现状建筑相交" });
      render();
      return { ok: true, object };
    }

    function select(ids, selectOptions) {
      const available = new Set(history.present.objects.map((object) => object.id));
      const requested = (ids || []).filter((id) => available.has(id));
      selectedIds = selectOptions?.additive ? [...new Set([...selectedIds, ...requested])] : [...new Set(requested)];
      errorIds = [];
      if (typeof adapter.updateSelection === "function") adapter.updateSelection(selectedIds, { errorIds, tool });
      else render();
      return selectedIds.slice();
    }

    function updateSelection(patch) {
      const editable = selectedIds.filter((id) => {
        const object = history.present.objects.find((candidate) => candidate.id === id);
        return object && !layerFor(object.layerId)?.locked;
      });
      if (!editable.length) return reject("NOTHING_EDITABLE", "请选择未锁定对象");
      apply({ type: "updateObjects", ids: editable, patch });
      return { ok: true };
    }

    function duplicateSelection() {
      const idMap = Object.fromEntries(selectedIds.map((id) => [id, idFactory()]));
      const first = history.present.objects.find((object) => selectedIds.includes(object.id));
      const origin = first?.geometry?.type === "Point" ? first.geometry.coordinates : [114, 30];
      const shifted = rules.fromLocalMeters([1, 1], origin);
      apply({ type: "duplicateObjects", ids: selectedIds, idMap, coordinateOffset: [shifted[0] - origin[0], shifted[1] - origin[1]] });
      selectedIds = Object.values(idMap);
      render();
    }

    function moveObject(id, coordinate) {
      const object = history.present.objects.find((candidate) => candidate.id === id);
      if (!object || object.geometry?.type !== "Point" || !Array.isArray(coordinate) || coordinate.length < 2) {
        return reject("OBJECT_NOT_MOVABLE", "三维视图只能水平移动点状组件", id);
      }
      if (layerFor(object.layerId)?.locked) return reject("LAYER_LOCKED", "图层已锁定", id);
      const geometry = { type: "Point", coordinates: coordinate.slice(0, 2).map(Number) };
      if (history.present.selectionBoundary && !rules.containsGeometry(history.present.selectionBoundary, geometry)) {
        return reject("OUTSIDE_BOUNDARY", "对象必须位于当前设计范围内", id);
      }
      selectedIds = [id];
      apply({ type: "updateObject", id, patch: { geometry } });
      return { ok: true, id };
    }

    function undo() {
      history = Commands.undo(history);
      selectedIds = selectedIds.filter((id) => history.present.objects.some((object) => object.id === id));
      onDocumentChange(history.present, { type: "undo" });
      render();
    }

    function redo() {
      history = Commands.redo(history);
      onDocumentChange(history.present, { type: "redo" });
      render();
    }

    render();
    return {
      setTool(nextTool) { if (!TOOLS.includes(nextTool)) throw new Error(`Unknown tool: ${nextTool}`); tool = nextTool; render(); },
      createObject,
      setSelectionBoundary(geometry) {
        const validation = rules.validateSelectionBoundary(geometry, { villageBoundary, baselineBuildings });
        if (!validation.ok) return reject("INVALID_BOUNDARY", validation.errors.join("; "));
        apply({ type: "setSelectionBoundary", geometry });
        if (validation.warnings.length) onStatus({ level: "warning", code: "BOUNDARY_WARNING", message: validation.warnings.join("; "), measurements: validation.measurements });
        return { ok: true, warnings: validation.warnings, measurements: validation.measurements };
      },
      select,
      moveObject,
      updateSelection,
      duplicateSelection,
      deleteSelection() { apply({ type: "deleteObjects", ids: selectedIds }); selectedIds = []; render(); },
      groupSelection(name) {
        if (selectedIds.length < 2) return reject("GROUP_REQUIRES_TWO", "至少选择两个对象");
        const id = groupIdFactory();
        apply({ type: "groupObjects", ids: selectedIds, group: { id, name: name || "组合" } });
        return { ok: true, groupId: id };
      },
      ungroupSelection() {
        const groups = new Set(history.present.objects.filter((object) => selectedIds.includes(object.id)).map((object) => object.groupId).filter(Boolean));
        for (const groupId of groups) apply({ type: "ungroupObjects", groupId });
      },
      alignSelection(axis) { apply({ type: "alignObjects", ids: selectedIds, axis }); },
      distributeSelection(axis) { apply({ type: "distributeObjects", ids: selectedIds, axis }); },
      setLayerLocked(layerId, locked) { apply({ type: "updateLayer", layerId, patch: { locked: !!locked } }); },
      setLayerVisible(layerId, visible) { apply({ type: "updateLayer", layerId, patch: { visible: !!visible } }); },
      toggleLayerLocked(layerId) { const layer = layerFor(layerId); if (layer) apply({ type: "updateLayer", layerId, patch: { locked: !layer.locked } }); },
      toggleLayerVisible(layerId) { const layer = layerFor(layerId); if (layer) apply({ type: "updateLayer", layerId, patch: { visible: layer.visible === false } }); },
      reorderLayer(layerId, order) { apply({ type: "reorderLayer", layerId, order }); },
      addLayer(name) { const id = `layer-${idFactory()}`; apply({ type: "addLayer", layer: { id, name: name || "新图层" } }); return id; },
      acknowledgeSavedRevision(revision, updatedAt) {
        if (!Number.isInteger(revision) || revision < history.present.revision) return false;
        for (const document of [...history.past, history.present, ...history.future]) {
          document.revision = revision;
          if (updatedAt) document.updatedAt = updatedAt;
        }
        render();
        return true;
      },
      replaceDocument(nextDocument) {
        history = Commands.createHistory(nextDocument, { limit: history.limit });
        selectedIds = [];
        errorIds = [];
        render();
      },
      undo,
      redo,
      getState: () => ({ document: history.present, selectedIds: selectedIds.slice(), tool, errorIds: errorIds.slice(), canUndo: history.past.length > 0, canRedo: history.future.length > 0 }),
      dispose() { adapter.dispose?.(); }
    };
  }

  return { TOOLS, findSnapCoordinate, measureGeometry, createSceneEditorController };
});
