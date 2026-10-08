(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FeatureEditSessionModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const LOCK_LEASE_SECONDS = 90;
  const LOCK_HEARTBEAT_MS = 30000;

  const LAYERS = {
    building: { label: "建筑", unit: "个" },
    road: { label: "道路", unit: "条" },
    cropland: { label: "农田", unit: "块" },
    openSpace: { label: "公共空间", unit: "处" },
    water: { label: "水体", unit: "处" }
  };

  const ACTIONS = {
    add: "新增",
    update: "修改",
    delete: "删除"
  };

  function normalize(value) {
    return String(value || "").trim();
  }

  function requireContext(deps, payload = {}) {
    const context = payload.context || deps?.getContext?.() || {};
    const teachingProjectId = normalize(context.teachingProjectId);
    const villageId = normalize(context.villageId);
    const spaceId = normalize(context.spaceId || payload.spaceId);
    if (!teachingProjectId) throw new Error("PROJECT_CONTEXT_REQUIRED");
    if (!villageId) throw new Error("VILLAGE_CONTEXT_REQUIRED");
    if (!spaceId) throw new Error("SPACE_CONTEXT_REQUIRED");
    return { teachingProjectId, villageId, spaceId };
  }

  function buildLockTarget(spaceId, layerKey, objectCode) {
    const target = {
      spaceId: normalize(spaceId),
      layerKey: normalize(layerKey),
      objectCode: normalize(objectCode)
    };
    if (!target.spaceId || !target.layerKey || !target.objectCode) return null;
    return target;
  }

  function summarizeChanges(changes = []) {
    const counts = new Map();
    changes.forEach((change) => {
      const layerKey = normalize(change?.layerKey);
      const action = normalize(change?.action);
      if (!layerKey || !ACTIONS[action]) return;
      const key = `${action}::${layerKey}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const actionOrder = ["update", "add", "delete"];
    const layerOrder = ["building", "road", "cropland", "openSpace", "water"];
    const parts = [];
    actionOrder.forEach((action) => {
      layerOrder.forEach((layerKey) => {
        const count = counts.get(`${action}::${layerKey}`) || 0;
        if (!count) return;
        const meta = LAYERS[layerKey] || { label: layerKey, unit: "个" };
        parts.push(`${ACTIONS[action]}${meta.label} ${count} ${meta.unit}`);
      });
    });

    return {
      total: Array.from(counts.values()).reduce((sum, count) => sum + count, 0),
      text: parts.join("、") || "暂无未保存修改"
    };
  }

  function canFreezeSnapshot(role) {
    const normalized = normalize(role).toLowerCase();
    return normalized === "admin" || normalized === "teacher";
  }

  async function acquireFeatureEditLock(deps, target, editorName) {
    const context = requireContext(deps, target);
    const lockTarget = buildLockTarget(target?.spaceId, target?.layerKey, target?.objectCode);
    const client = deps?.getSupabaseClient?.();
    if (!lockTarget || !normalize(editorName)) {
      return { success: false, reason: "invalid_target" };
    }
    if (!client) return { success: true, offline: true, target: lockTarget };

    const { data, error } = await client.rpc("acquire_feature_edit_lock", {
      p_space_id: context.spaceId,
      p_teaching_project_id: context.teachingProjectId,
      p_village_id: context.villageId,
      p_layer_key: lockTarget.layerKey,
      p_object_code: lockTarget.objectCode,
      p_editor_name: normalize(editorName),
      p_lease_seconds: LOCK_LEASE_SECONDS
    });
    if (error) throw error;
    return data || { success: false, reason: "lock_failed" };
  }

  async function heartbeatFeatureEditLock(deps, lock) {
    const client = deps?.getSupabaseClient?.();
    if (!client || lock?.offline) return { success: true };
    const context = requireContext(deps, lock);
    const { data, error } = await client.rpc("heartbeat_feature_edit_lock", {
      p_space_id: context.spaceId,
      p_teaching_project_id: context.teachingProjectId,
      p_village_id: context.villageId,
      p_layer_key: lock.layerKey,
      p_object_code: lock.objectCode,
      p_editor_name: lock.editorName,
      p_lock_token: lock.lockToken,
      p_lease_seconds: LOCK_LEASE_SECONDS
    });
    if (error) throw error;
    return data || { success: false };
  }

  async function releaseFeatureEditLock(deps, lock) {
    const client = deps?.getSupabaseClient?.();
    if (!lock || !client || lock.offline) return { success: true };
    const context = requireContext(deps, lock);
    const { data, error } = await client.rpc("release_feature_edit_lock", {
      p_space_id: context.spaceId,
      p_teaching_project_id: context.teachingProjectId,
      p_village_id: context.villageId,
      p_layer_key: lock.layerKey,
      p_object_code: lock.objectCode,
      p_editor_name: lock.editorName,
      p_lock_token: lock.lockToken
    });
    if (error) throw error;
    return data || { success: true };
  }

  async function saveFeatureEditBatch(deps, payload) {
    const context = requireContext(deps, payload);
    const client = deps?.getSupabaseClient?.();
    if (!client) throw new Error("当前未连接 Supabase，无法保存并同步本次编辑。");
    const { data, error } = await client.rpc("save_feature_edit_batch", {
      p_space_id: context.spaceId,
      p_teaching_project_id: context.teachingProjectId,
      p_village_id: context.villageId,
      p_editor_name: normalize(payload?.editorName),
      p_summary: normalize(payload?.summary),
      p_note: normalize(payload?.note),
      p_changes: payload?.changes || []
    });
    if (error) throw error;
    return { success: true, batchId: data };
  }

  async function saveGroupPlanEditBatch(deps, payload = {}) {
    const rawContext = payload.context || deps?.getContext?.() || {};
    if (normalize(rawContext.spaceType ?? rawContext.space_type) !== "group_plan") {
      throw new Error("GROUP_PLAN_SPACE_REQUIRED");
    }
    const context = requireContext(deps, payload);
    const changes = Array.isArray(payload.changes) ? payload.changes : [];
    if (!changes.length) throw new Error("GROUP_PLAN_CHANGES_REQUIRED");
    changes.forEach((change) => {
      const layerKey = normalize(change?.layerKey);
      if (!["building", "road", "water"].includes(layerKey)) {
        throw new Error("GROUP_LAYER_READ_ONLY");
      }
      if (!normalize(change?.action) || !normalize(change?.objectCode)) {
        throw new Error("GROUP_PLAN_CHANGE_INVALID");
      }
      if (!Number.isInteger(Number(change?.expectedRevision)) || Number(change.expectedRevision) < 0) {
        throw new Error("GROUP_PLAN_REVISION_REQUIRED");
      }
    });

    const client = deps?.getSupabaseClient?.();
    if (!client) throw new Error("当前未连接 Supabase，无法保存小组方案。");
    const { data, error } = await client.rpc("save_group_plan_edit_batch", {
      p_teaching_project_id: context.teachingProjectId,
      p_village_id: context.villageId,
      p_space_id: context.spaceId,
      p_editor_name: normalize(payload.editorName),
      p_summary: normalize(payload.summary),
      p_changes: changes
    });
    if (error) throw error;
    return { success: true, result: data };
  }

  async function listSnapshots(deps, spaceId) {
    const context = requireContext(deps, { spaceId });
    const client = deps?.getSupabaseClient?.();
    if (!client) return [];
    const { data, error } = await client
      .from("feature_snapshots")
      .select("id,space_id,version_name,version_type,description,created_by,created_at,is_published,version_number,recommended_for_groups,stats")
      .eq("space_id", context.spaceId)
      .eq("teaching_project_id", context.teachingProjectId)
      .eq("village_id", context.villageId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function listRecentVersions(deps, spaceId, limit = 20) {
    const context = requireContext(deps, { spaceId });
    const client = deps?.getSupabaseClient?.();
    if (!client) return [];
    const { data, error } = await client
      .from("feature_change_batches")
      .select("id,space_id,editor_name,summary,note,created_at")
      .eq("space_id", context.spaceId)
      .eq("teaching_project_id", context.teachingProjectId)
      .eq("village_id", context.villageId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function listSnapshotItems(deps, snapshotId) {
    const client = deps?.getSupabaseClient?.();
    if (!client || !normalize(snapshotId)) return [];
    const { data, error } = await client
      .from("feature_snapshot_items")
      .select("snapshot_id,layer_key,object_code,object_name,geom,props,is_deleted")
      .eq("snapshot_id", normalize(snapshotId))
      .eq("is_deleted", false);
    if (error) throw error;
    return data || [];
  }

  async function freezeSnapshot(deps, payload) {
    const context = requireContext(deps, payload);
    const client = deps?.getSupabaseClient?.();
    if (!client) throw new Error("当前未配置 Supabase。");
    const { data, error } = await client.rpc("freeze_feature_snapshot", {
      p_space_id: context.spaceId,
      p_teaching_project_id: context.teachingProjectId,
      p_village_id: context.villageId,
      p_version_name: normalize(payload?.versionName),
      p_description: normalize(payload?.description),
      p_created_by: normalize(payload?.createdBy),
      p_version_type: normalize(payload?.versionType) || "published",
      p_items: Array.isArray(payload?.items) ? payload.items : []
    });
    if (error) throw error;
    return data;
  }

  async function freezeSurveySnapshot(deps, payload) {
    const context = requireContext(deps, payload);
    const client = deps?.getSupabaseClient?.();
    if (!client) throw new Error("当前未配置 Supabase。");
    const { data, error } = await client.rpc("freeze_shared_survey_snapshot", {
      p_teaching_project_id: context.teachingProjectId,
      p_village_id: context.villageId,
      p_space_id: context.spaceId,
      p_version_name: normalize(payload?.versionName),
      p_description: normalize(payload?.description),
      p_recommended_for_groups: Boolean(payload?.recommendedForGroups)
    });
    if (error) throw error;
    return data;
  }

  return {
    LOCK_LEASE_SECONDS,
    LOCK_HEARTBEAT_MS,
    buildLockTarget,
    summarizeChanges,
    canFreezeSnapshot,
    requireContext,
    acquireFeatureEditLock,
    heartbeatFeatureEditLock,
    releaseFeatureEditLock,
    saveFeatureEditBatch,
    saveGroupPlanEditBatch,
    listSnapshots,
    listRecentVersions,
    listSnapshotItems,
    freezeSnapshot,
    freezeSurveySnapshot
  };
});
