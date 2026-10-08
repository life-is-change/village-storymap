(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ThreeDEditPolicyModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SHARED_TYPES = new Set(["practice_shared", "formal_shared"]);

  function resolve3DEditPolicy({ space = {}, isAdmin = false, canManage = false } = {}) {
    const type = String(space.type || space.spaceType || space.space_type || "");
    const actualSpaceId = String(space.actualSpaceId || space.actual_space_id || space.id || "");
    const readonly = Boolean(space.readonly || space.readOnly || space.is_readonly);
    const shared = SHARED_TYPES.has(type);
    return {
      actualSpaceId,
      shared,
      canEditModel: !readonly && (shared ? Boolean(isAdmin && canManage) : Boolean(canManage))
    };
  }

  return { resolve3DEditPolicy };
});
