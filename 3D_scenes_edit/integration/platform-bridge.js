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

  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function geometryId(text) {
    let a = 2166136261, b = 5381;
    for (const c of text) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function distinguishIdentities(features) {
    const groups = new Map();
    for (const f of features) if (f.id != null) {
      const key = String(f.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    const identities = new Set();
    for (const [id, group] of groups) {
      const geometries = new Set(), hashes = new Map();
      for (const f of group) {
        if (group.length > 1) {
          const text = stable(f.geometry), hash = geometryId(text);
          if (geometries.has(text)) throw Error('现状源记录重复：' + id + '，请检查重复导入');
          if (hashes.has(hash) && hashes.get(hash) !== text) throw Error('现状几何摘要碰撞：' + id);
          geometries.add(text); hashes.set(hash, text);
          f.identityAliases = [id];
          f.id = id + ':geometry-' + hash;
        }
        if (identities.has(String(f.id))) throw Error('现状源编号重复：' + f.id);
        identities.add(String(f.id));
      }
    }
    return features;
  }

  function buildSceneEditContext(state) {
    if (state?.activeView === "overview") return fail("OVERVIEW_ACTIVE", "请先进入村庄的二维或三维视图");
    if (!state?.user?.id) return fail("USER_REQUIRED", "请先登录后再进入公共空间设计");
    const isAdminSandbox = String(state?.role || "").toLowerCase() === "admin" && !state?.group?.id;
    const isPersonal = state?.space?.spaceType === "practice_personal" && state.space.ownerId === state.user.id;
    if (!isAdminSandbox && !isPersonal && !state?.group?.id) return fail("GROUP_REQUIRED", "当前课程尚未分配小组");
    const spaceId = state?.space?.actualSpaceId || state?.space?.id;
    if (!spaceId) return fail("SPACE_REQUIRED", "请先选择一个小组空间");
    if (!state.teachingProjectId || !state.courseId || !state.villageId) return fail("PROJECT_CONTEXT_REQUIRED", "当前教学项目上下文不完整");
    try {
      const baselineFeatures = distinguishIdentities((state.baselineFeatures || []).map((feature) => {
        const geojson = state.serializeFeature ? state.serializeFeature(feature) : feature;
        const plain = clone(geojson);
        const layerKey = plain?.layerKey || plain?.properties?.layerKey || feature?.layerKey || feature?.get?.("layerKey") || "baseline";
        const sourceCode = plain?.properties?.sourceCode ?? feature?.get?.("sourceCode");
        // Some road adapters expose a road NAME as sourceCode. Distinct OSM
        // segments share that name, so prefer the dataset's explicit ID.
        const dataId = plain?.properties?.id ?? plain?.properties?.osm_id;
        const identity = dataId ?? sourceCode;
        const legacyId = plain?.id ?? plain?.properties?.id ?? feature?.getId?.();
        const id = identity != null && String(identity).trim()
          ? `${layerKey}:${identity}` : (plain?.id ?? feature?.getId?.());
        return {
          ...(id != null ? { id } : {}),
          ...(legacyId != null && id !== legacyId ? { legacyId } : {}),
          layerKey,
          geometry: plain?.geometry || null,
          properties: plain?.properties || {}
        };
      }).filter((feature) => feature.geometry));
      return {
        ok: true,
        context: {
          userId: String(state.user.id), userName: String(state.user.name || ""),
          teachingProjectId: String(state.teachingProjectId), courseId: String(state.courseId), villageId: String(state.villageId),
          scopeKind: isAdminSandbox ? "admin_sandbox" : isPersonal ? "practice_personal" : "group",
          ownerId: String(state.user.id),
          groupId: isAdminSandbox || isPersonal ? null : String(state.group.id), spaceId: String(spaceId),
          title: isAdminSandbox ? "管理员试用方案" : !isPersonal && state.space.spaceType === "formal_shared" ? `${state.group.name || "本小组"} · 公共空间方案` : (state.space.title ? `${state.space.title} · 公共空间方案` : "公共空间方案"),
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
