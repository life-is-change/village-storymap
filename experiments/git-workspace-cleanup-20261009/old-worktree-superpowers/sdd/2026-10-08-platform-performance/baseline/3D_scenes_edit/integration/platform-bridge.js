(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ScenePlatformBridgeModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function fail(code, message) {
    return { ok: false, code, message };
  }

  function buildSceneEditContext(state) {
    if (state?.activeView === "overview") return fail("OVERVIEW_ACTIVE", "请先进入村庄的二维或三维视图");
    if (!state?.user?.id) return fail("USER_REQUIRED", "请先登录后再进入公共空间设计");
    const isAdminSandbox = String(state?.role || "").toLowerCase() === "admin" && !state?.group?.id;
    if (!isAdminSandbox && !state?.group?.id) return fail("GROUP_REQUIRED", "当前课程尚未分配小组");
    const spaceId = state?.space?.actualSpaceId || state?.space?.id;
    if (!spaceId) return fail("SPACE_REQUIRED", "请先选择一个小组空间");
    if (!state.teachingProjectId || !state.courseId || !state.villageId) return fail("PROJECT_CONTEXT_REQUIRED", "当前教学项目上下文不完整");
    try {
      const baselineFeatures = (state.baselineFeatures || []).map((feature) => {
        const geojson = state.serializeFeature ? state.serializeFeature(feature) : feature;
        const plain = clone(geojson);
        return {
          layerKey: plain?.properties?.layerKey || feature?.layerKey || feature?.get?.("layerKey") || "baseline",
          geometry: plain?.geometry || null,
          properties: plain?.properties || {}
        };
      }).filter((feature) => feature.geometry);
      return {
        ok: true,
        context: {
          userId: String(state.user.id), userName: String(state.user.name || ""),
          teachingProjectId: String(state.teachingProjectId), courseId: String(state.courseId), villageId: String(state.villageId),
          scopeKind: isAdminSandbox ? "admin_sandbox" : "group",
          ownerId: String(state.user.id),
          groupId: isAdminSandbox ? null : String(state.group.id), spaceId: String(spaceId),
          title: isAdminSandbox ? "管理员试用方案" : (state.space.title ? `${state.space.title} · 公共空间方案` : "公共空间方案"),
          baselineRevision: Number.isInteger(state.space.baselineRevision) ? state.space.baselineRevision : Math.max(0, Number(state.baselineRevision) || 0),
          baselineFeatures,
          villageBoundary: clone(state.villageBoundary || null), selectionBoundary: clone(state.selectionBoundary || null), projectId: state.projectId || null
        }
      };
    } catch (error) {
      return fail("BASELINE_SERIALIZE_FAILED", error.message || "现状数据转换失败");
    }
  }

  function scopeKey(context) {
    return [context.userId, context.scopeKind || "group", context.ownerId || context.userId, context.teachingProjectId, context.villageId, context.groupId || "-", context.spaceId].join(":");
  }

  function createPlatformBridge(options) {
    let instance = null;
    let currentScope = "";
    const mount = options.mount;

    async function open(stateOverride, runtimeOptions = {}) {
      const built = buildSceneEditContext(stateOverride || options.readState());
      if (!built.ok) return built;
      if (instance) instance.dispose?.();
      instance = null;
      currentScope = scopeKey(built.context);
      mount.hidden = false;
      options.onFocusChange?.(true);
      let created;
      try {
        created = await options.studioApi.create(options.buildOptions(built.context, runtimeOptions));
      } catch (error) {
        mount.hidden = true;
        currentScope = "";
        options.onFocusChange?.(false);
        return fail("STUDIO_CREATE_FAILED", error?.message || "公共空间设计工作台启动失败");
      }
      if (!created?.ok) {
        mount.hidden = true;
        currentScope = "";
        options.onFocusChange?.(false);
        return created || fail("STUDIO_CREATE_FAILED", "公共空间设计工作台启动失败");
      }
      instance = created;
      return { ok: true, context: built.context, instance };
    }

    function close() {
      instance?.dispose?.();
      instance = null;
      currentScope = "";
      mount.hidden = true;
      options.onFocusChange?.(false);
    }

    async function sync(stateOverride) {
      const built = buildSceneEditContext(stateOverride || options.readState());
      if (!built.ok) { close(); return { ...built, changed: true }; }
      const nextScope = scopeKey(built.context);
      if (instance && nextScope === currentScope) return { ok: true, changed: false, instance };
      const result = await open(stateOverride || options.readState());
      return { ...result, changed: true };
    }

    return { open, close, sync, getInstance: () => instance, getScopeKey: () => currentScope };
  }

  const openSceneStudio = (bridge, state) => bridge.open(state);
  const closeSceneStudio = (bridge) => bridge.close();
  const syncSceneEditContext = (bridge, state) => bridge.sync(state);
  return { buildSceneEditContext, createPlatformBridge, openSceneStudio, closeSceneStudio, syncSceneEditContext };
});
