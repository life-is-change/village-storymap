(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../domain/scene-document") : root.SceneDocumentModule,
    typeof module === "object" && module.exports ? require("../domain/scene-commands") : root.SceneCommandsModule,
    typeof module === "object" && module.exports ? require("../domain/geometry-rules") : root.SceneGeometryRulesModule
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEditorControllerModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SceneDocument, Commands, DefaultGeometryRules) {
  const TOOLS = Object.freeze(["select", "box-select", "draw-boundary", "edit-boundary", "draw-surface", "draw-rectangle", "draw-line", "place-asset", "move", "rotate", "scale", "measure", "pan", "edit-nodes", "edit-road-nodes"]);
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

  function snapPathEndpoints(geometry, geometries, rules, toleranceM = 2) {
    if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return geometry;
    const lines = (geometries || []).flatMap(g => g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : []);
    const coordinates = geometry.coordinates.map(p => p.slice());
    for (const index of [0, coordinates.length - 1]) {
      const origin = coordinates[index]; let best = null;
      if (!origin.slice(0, 2).every(Number.isFinite)) continue;
      for (const line of lines) for (let i = 1; i < line.length; i++) {
        const a = rules.toLocalMeters(line[i - 1], origin), b = rules.toLocalMeters(line[i], origin);
        const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length)) : 0;
        const point = [a[0] + t * dx, a[1] + t * dy], distance = Math.hypot(...point);
        if (distance <= toleranceM && (!best || distance < best.distance)) best = { point, distance };
      }
      if (best) coordinates[index] = [...rules.fromLocalMeters(best.point, origin), ...origin.slice(2)];
    }
    return { ...geometry, coordinates };
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

    const isPath = object => object.kind === 'line' && object.category === 'path' && object.properties?.sceneRole !== 'site-component';
    const isField = object => object.kind === 'surface' && object.category === 'activity-field';
    function prepareGeometry(object, geometry) {
      if (!isPath(object)) return geometry;
      return snapPathEndpoints(geometry, [...(options.baselineRoads || []), ...history.present.objects.filter(o => o.id !== object.id && isPath(o)).map(o => o.geometry)], rules);
    }
    function checkBoundary(object, geometry) {
      const villagePath = (isPath(object) || isField(object)) && villageBoundary;
      const boundary = villagePath || history.present.selectionBoundary;
      if (!villagePath && history.present.objects.some(o => isField(o) && rules.containsGeometry(o.geometry, geometry))) return null;
      if (boundary && !rules.containsGeometry(boundary, geometry)) return villagePath
        ? { code: 'OUTSIDE_VILLAGE', message: '道路、步道与活动场地必须位于当前村庄边界内' }
        : { code: 'OUTSIDE_BOUNDARY', message: '对象必须位于当前设计范围内' };
      return null;
    }

    function createObject(input) {
      const layerId = isPath(input) ? 'circulation' : input.layerId || "design";
      if (layerFor(layerId)?.locked) return reject("LAYER_LOCKED", "图层已锁定");
      const geometry = prepareGeometry(input, input.geometry), boundaryError = checkBoundary(input, geometry);
      if (boundaryError) return reject(boundaryError.code, boundaryError.message);
      const object = {
        id: idFactory(),
        kind: input.kind,
        category: input.category,
        geometry: SceneDocument.clone(geometry),
        properties: { ...(input.properties || {}) },
        layerId,
        groupId: null,
        zIndex: history.present.objects.length
      };
      if (input.kind === "asset" || input.kind === "structure") object.transform = { ...defaultTransform(), ...(input.transform || {}) };
      const validation = SceneDocument.validateObject(object);
      if (!validation.ok) return reject("INVALID_OBJECT", validation.errors.join("; "));
      apply({ type: "addObject", object, ...(isPath(input) && !layerFor(layerId) ? { layer: { id: layerId, name: '村庄道路与步道', visible: true, locked: false, order: history.present.layers.length } } : {}) });
      selectedIds = [object.id];
      if (rules.intersectsAny(input.geometry, baselineBuildings)) onStatus({ level: "warning", code: "BASELINE_COLLISION", message: "对象与现状建筑相交" });
      render();
      return { ok: true, object };
    }

    function select(ids, selectOptions) {
      const available = new Set(history.present.objects.map((object) => object.id));
      if (history.present.selectionBoundary) available.add('selection-boundary');
      const requested = (ids || []).filter((id) => available.has(id));
      selectedIds = selectOptions?.additive ? [...new Set([...selectedIds, ...requested])] : [...new Set(requested)];
      errorIds = [];
      if (typeof adapter.updateSelection === "function") adapter.updateSelection(selectedIds, { errorIds, tool });
      else render();
      return selectedIds.slice();
    }

    function updateSelection(patch) {
      if (selectedIds.length === 1 && selectedIds[0] === 'selection-boundary') {
        if (!patch.geometry) return reject('RANGE_GEOMETRY_REQUIRED','旧版放置范围仅支持几何编辑');
        const validation = rules.validateSelectionBoundary(patch.geometry,{villageBoundary,baselineBuildings});
        if (!validation.ok) return reject('INVALID_BOUNDARY',validation.errors.join('; '));
        apply({type:'setSelectionBoundary',geometry:patch.geometry});return {ok:true};
      }
      const editable = selectedIds.filter((id) => {
        const object = history.present.objects.find((candidate) => candidate.id === id);
        return object && !layerFor(object.layerId)?.locked;
      });
      if (!editable.length) return reject("NOTHING_EDITABLE", "请选择未锁定对象");
      if (patch.geometry) {
        if (editable.length !== 1) return reject('ONE_GEOMETRY_REQUIRED', '请逐个编辑道路或设施节点');
        const object = history.present.objects.find(o => o.id === editable[0]);
        const geometry = prepareGeometry(object, patch.geometry), boundaryError = checkBoundary(object, geometry);
        if (boundaryError) return reject(boundaryError.code, boundaryError.message, object.id);
        const valid = SceneDocument.validateObject({ ...object, ...patch, geometry });
        if (!valid.ok) return reject('INVALID_OBJECT', valid.errors.join('; '), object.id);
        patch = { ...patch, geometry };
      }
      apply({ type: "updateObjects", ids: editable, patch });
      return { ok: true };
    }

    function duplicateSelection() {
      if (history.present.objects.some(object => selectedIds.includes(object.id) && layerFor(object.layerId)?.locked)) return reject('LAYER_LOCKED', '图层已锁定');
      const idMap = Object.fromEntries(selectedIds.map((id) => [id, idFactory()]));
      const first = history.present.objects.find((object) => selectedIds.includes(object.id));
      const origin = first?.geometry?.type === "Point" ? first.geometry.coordinates : [114, 30];
      const shifted = rules.fromLocalMeters([1, 1], origin);
      const command = { type: "duplicateObjects", ids: selectedIds, idMap, coordinateOffset: [shifted[0] - origin[0], shifted[1] - origin[1]] };
      for (const object of Commands.execute(history, command).present.objects.filter(object => Object.values(idMap).includes(object.id))) {
        const error = checkBoundary(object, object.geometry);
        if (error) return reject(error.code, error.message);
      }
      apply(command);
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
      const boundaryError = checkBoundary(object, geometry);
      if (boundaryError) return reject(boundaryError.code, boundaryError.message, id);
      selectedIds = [id];
      apply({ type: "updateObject", id, patch: { geometry } });
      return { ok: true, id };
    }

    function rotateSelection(degrees) {
      if (selectedIds.length !== 1) return reject('ONE_GEOMETRY_REQUIRED','请逐个旋转范围或道路');
      const id=selectedIds[0],object=history.present.objects.find(o=>o.id===id);
      const geometry=id==='selection-boundary'?history.present.selectionBoundary:object?.geometry;
      if (!geometry || !Number.isFinite(Number(degrees))) return reject('INVALID_ROTATION','请选择可旋转的范围或道路');
      if (geometry.type==='Point') return updateSelection({transform:{headingDeg:(Number(object.transform?.headingDeg)||0)+Number(degrees)}});
      const points=geometry.type==='Polygon'?geometry.coordinates[0].slice(0,-1):geometry.coordinates;
      const origin=[(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2];
      const angle=Number(degrees)*Math.PI/180;
      const rotate=p=>{const [x,y]=rules.toLocalMeters(p,origin);return [...rules.fromLocalMeters([x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)],origin),...p.slice(2)];};
      const next={...geometry,coordinates:geometry.type==='Polygon'?geometry.coordinates.map(r=>r.map(rotate)):geometry.coordinates.map(rotate)};
      return updateSelection({geometry:next});
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
      setSimulationConfig(config) { apply({ type: "setSimulation", config }); return { ok: true }; },
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
      rotateSelection,
      duplicateSelection,
      deleteSelection() {
        const ids=selectedIds.filter(id=>id!=='selection-boundary');
        if (ids.some(id=>layerFor(history.present.objects.find(o=>o.id===id)?.layerId)?.locked)) return reject('LAYER_LOCKED','图层已锁定');
        if (selectedIds.length) apply({ type: "deleteObjects", ids,clearSelectionBoundary:selectedIds.includes('selection-boundary') }); selectedIds = []; render();
      },
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
      addLayer(name) {
        const id = `layer-${idFactory()}`;
        const fallbackName = `图层 ${history.present.layers.length + 1}`;
        apply({ type: "addLayer", layer: { id, name: String(name || fallbackName).trim() || fallbackName } });
        return id;
      },
      renameLayer(layerId, name) {
        const layer = layerFor(layerId);
        const nextName = String(name || "").trim().slice(0, 40);
        if (!layer) return reject("LAYER_NOT_FOUND", "图层不存在");
        if (layerId === "design") return reject("DEFAULT_LAYER_REQUIRED", "方案要素是默认图层，不能重命名");
        if (!nextName) return reject("LAYER_NAME_REQUIRED", "请输入图层名称");
        apply({ type: "updateLayer", layerId, patch: { name: nextName } });
        return { ok: true, layerId };
      },
      deleteLayer(layerId) {
        if (layerId === "design") return reject("DEFAULT_LAYER_REQUIRED", "方案要素用于接收未分类对象，不能删除");
        if (!layerFor(layerId)) return reject("LAYER_NOT_FOUND", "图层不存在");
        apply({ type: "deleteLayer", layerId });
        return { ok: true, layerId };
      },
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

  return { TOOLS, findSnapCoordinate, snapPathEndpoints, measureGeometry, createSceneEditorController };
});
