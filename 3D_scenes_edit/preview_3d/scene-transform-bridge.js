(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("../domain/scene-commands") : root.SceneCommandsModule);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneTransformBridgeModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Commands) {
  function createSceneTransformBridge(options) {
    const actions = options?.actions || {};
    function update(id, values) {
      const history = options?.getHistory?.();
      const object = history?.present?.objects?.find((candidate) => candidate.id === id);
      if (!object || (object.kind !== "asset" && object.kind !== "structure")) return { ok: false, code: "NOT_TRANSFORMABLE" };
      const transform = object.transform || {};
      const scale = Array.isArray(transform.scale) ? transform.scale.slice() : [1, 1, 1];
      if (Number.isFinite(values.scaleZ)) scale[2] = values.scaleZ;
      const transformPatch = {};
      for (const key of ["heightOffsetM", "pitchDeg", "rollDeg"]) if (Number.isFinite(values[key])) transformPatch[key] = values[key];
      if (Number.isFinite(values.scaleZ)) transformPatch.scale = scale;
      const properties = typeof values.materialRef === "string" ? { materialRef: values.materialRef } : undefined;
      const next = Commands.execute(history, { type: "updateObject", id, patch: { transform: transformPatch, ...(properties ? { properties } : {}) } });
      options.setHistory?.(next);
      options.onDocumentChange?.(next.present, { type: "3d-transform", id, values: { ...values } });
      return { ok: true, document: next.present };
    }
    return {
      update,
      moveXY: (id, coordinate) => actions.moveXY?.(id, coordinate),
      yaw: (id, degrees) => actions.yaw?.(id, degrees),
      scaleXY: (id, scale) => actions.scaleXY?.(id, scale),
      duplicate: (ids) => actions.duplicate?.(ids),
      remove: (ids) => actions.remove?.(ids),
      group: (ids) => actions.group?.(ids),
      editVertices(object) {
        if (object?.kind === "line" || object?.kind === "surface") return { ok: false, code: "EDIT_IN_2D", message: "请在二维视图中编辑线或面的节点" };
        return { ok: true };
      }
    };
  }
  return { createSceneTransformBridge };
});
