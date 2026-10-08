(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./scene-document") : root.SceneDocumentModule
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneCommandsModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SceneDocument) {
  function createHistory(document, options) {
    return {
      present: SceneDocument.clone(document),
      past: [],
      future: [],
      limit: Math.max(1, Number(options?.limit) || 100)
    };
  }

  function mergeObject(target, patch) {
    const next = { ...target, ...SceneDocument.clone(patch) };
    if (patch.transform) next.transform = { ...(target.transform || {}), ...SceneDocument.clone(patch.transform) };
    if (patch.properties) next.properties = { ...(target.properties || {}), ...SceneDocument.clone(patch.properties) };
    if (patch.geometry) next.geometry = SceneDocument.clone(patch.geometry);
    return next;
  }

  function mapSelected(document, ids, mapper) {
    const selected = new Set(ids || []);
    document.objects = document.objects.map((object) => selected.has(object.id) ? mapper(object) : object);
  }

  function apply(document, command) {
    const next = SceneDocument.clone(document);
    const type = command?.type;
    if (type === "addObject") {
      next.objects.push(SceneDocument.clone(command.object));
    } else if (type === "addLayer") {
      if (!command.layer?.id || next.layers.some((layer) => layer.id === command.layer.id)) throw new Error("addLayer requires a fresh id");
      next.layers.push({ id: command.layer.id, name: command.layer.name || "新图层", visible: command.layer.visible !== false, locked: !!command.layer.locked, order: next.layers.length });
    } else if (type === "setSelectionBoundary") {
      next.selectionBoundary = command.geometry ? SceneDocument.clone(command.geometry) : null;
    } else if (type === "updateObject") {
      next.objects = next.objects.map((object) => object.id === command.id ? mergeObject(object, command.patch || {}) : object);
    } else if (type === "updateObjects") {
      mapSelected(next, command.ids, (object) => mergeObject(object, command.patch || {}));
    } else if (type === "deleteObjects") {
      const ids = new Set(command.ids || []);
      next.objects = next.objects.filter((object) => !ids.has(object.id));
      next.groups = next.groups
        .map((group) => ({ ...group, objectIds: (group.objectIds || []).filter((id) => !ids.has(id)) }))
        .filter((group) => group.objectIds.length);
    } else if (type === "duplicateObjects") {
      const ids = new Set(command.ids || []);
      const offset = Array.isArray(command.coordinateOffset) ? command.coordinateOffset : [0, 0];
      for (const source of next.objects.filter((object) => ids.has(object.id))) {
        const duplicate = SceneDocument.clone(source);
        duplicate.id = command.idMap?.[source.id];
        if (!duplicate.id || next.objects.some((object) => object.id === duplicate.id)) {
          throw new Error(`duplicateObjects requires a fresh id for ${source.id}`);
        }
        duplicate.groupId = null;
        shiftGeometry(duplicate.geometry, offset);
        next.objects.push(duplicate);
      }
    } else if (type === "groupObjects") {
      if (!command.group?.id || next.groups.some((group) => group.id === command.group.id)) throw new Error("groupObjects requires a fresh group id");
      const ids = new Set(command.ids || []);
      next.groups.push({ ...SceneDocument.clone(command.group), objectIds: [...ids] });
      mapSelected(next, ids, (object) => ({ ...object, groupId: command.group.id }));
    } else if (type === "ungroupObjects") {
      next.groups = next.groups.filter((group) => group.id !== command.groupId);
      next.objects = next.objects.map((object) => object.groupId === command.groupId ? { ...object, groupId: null } : object);
    } else if (type === "alignObjects") {
      align(next, command.ids, command.axis);
    } else if (type === "distributeObjects") {
      distribute(next, command.ids, command.axis);
    } else if (type === "reorderLayer") {
      const currentIndex = next.layers.findIndex((item) => item.id === command.layerId);
      if (currentIndex >= 0) {
        const [layer] = next.layers.splice(currentIndex, 1);
        const targetIndex = Math.max(0, Math.min(next.layers.length, Number(command.order) || 0));
        next.layers.splice(targetIndex, 0, layer);
      }
      next.layers.forEach((item, index) => { item.order = index; });
    } else if (type === "updateLayer") {
      next.layers = next.layers.map((layer) => layer.id === command.layerId ? { ...layer, ...SceneDocument.clone(command.patch || {}) } : layer);
    } else if (type === "deleteLayer") {
      if (command.layerId === "design") throw new Error("The default layer cannot be deleted");
      if (!next.layers.some((layer) => layer.id === command.layerId)) return next;
      next.objects = next.objects.map((object) => object.layerId === command.layerId ? { ...object, layerId: "design" } : object);
      next.layers = next.layers.filter((layer) => layer.id !== command.layerId);
      next.layers.forEach((layer, index) => { layer.order = index; });
    } else {
      throw new Error(`Unknown scene command: ${type}`);
    }
    next.updatedAt = new Date().toISOString();
    return next;
  }

  function shiftGeometry(geometry, offset) {
    if (!geometry || !Array.isArray(offset)) return;
    function shift(value) {
      if (Array.isArray(value) && typeof value[0] === "number") {
        value[0] += Number(offset[0]) || 0;
        value[1] += Number(offset[1]) || 0;
      } else if (Array.isArray(value)) value.forEach(shift);
    }
    shift(geometry.coordinates);
  }

  function selectedPoints(document, ids) {
    const selected = new Set(ids || []);
    return document.objects.filter((object) => selected.has(object.id) && object.geometry?.type === "Point");
  }

  function align(document, ids, axis) {
    const objects = selectedPoints(document, ids);
    if (objects.length < 2) return;
    const xs = objects.map((object) => object.geometry.coordinates[0]);
    const ys = objects.map((object) => object.geometry.coordinates[1]);
    const horizontal = { left: Math.min(...xs), center: (Math.min(...xs) + Math.max(...xs)) / 2, right: Math.max(...xs) };
    const vertical = { bottom: Math.min(...ys), middle: (Math.min(...ys) + Math.max(...ys)) / 2, top: Math.max(...ys) };
    if (Object.hasOwn(horizontal, axis)) objects.forEach((object) => { object.geometry.coordinates[0] = horizontal[axis]; });
    else if (Object.hasOwn(vertical, axis)) objects.forEach((object) => { object.geometry.coordinates[1] = vertical[axis]; });
    else throw new Error(`Unsupported alignment axis: ${axis}`);
  }

  function distribute(document, ids, axis) {
    const objects = selectedPoints(document, ids);
    if (objects.length < 3) return;
    const coordinateIndex = axis === "horizontal" ? 0 : axis === "vertical" ? 1 : -1;
    if (coordinateIndex < 0) throw new Error(`Unsupported distribution axis: ${axis}`);
    const sorted = objects.slice().sort((a, b) => a.geometry.coordinates[coordinateIndex] - b.geometry.coordinates[coordinateIndex]);
    const start = sorted[0].geometry.coordinates[coordinateIndex];
    const end = sorted[sorted.length - 1].geometry.coordinates[coordinateIndex];
    const step = (end - start) / (sorted.length - 1);
    sorted.forEach((object, index) => { object.geometry.coordinates[coordinateIndex] = start + step * index; });
  }

  function execute(history, command) {
    const nextDocument = apply(history.present, command);
    const past = [...history.past, SceneDocument.clone(history.present)];
    if (past.length > history.limit) past.splice(0, past.length - history.limit);
    return { present: nextDocument, past, future: [], limit: history.limit };
  }

  function undo(history) {
    if (!history.past.length) return history;
    const past = history.past.slice();
    const present = past.pop();
    return { present, past, future: [SceneDocument.clone(history.present), ...history.future], limit: history.limit };
  }

  function redo(history) {
    if (!history.future.length) return history;
    const [present, ...future] = history.future;
    const past = [...history.past, SceneDocument.clone(history.present)];
    if (past.length > history.limit) past.shift();
    return { present, past, future, limit: history.limit };
  }

  return { createHistory, execute, undo, redo };
});
