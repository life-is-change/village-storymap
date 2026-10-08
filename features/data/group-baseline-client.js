(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GroupBaselineClientModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const STABLE_CODES = new Set([
    "GROUP_SPACE_BUSY",
    "BASELINE_VERSION_CONFLICT",
    "GROUP_MEMBERSHIP_REQUIRED",
    "STAFF_REQUIRED",
    "GROUP_PLAN_SPACE_REQUIRED",
    "GROUP_BASELINE_REQUIRED"
  ]);

  function clean(value) {
    return String(value ?? "").trim();
  }

  function normalizeBaselineError(error) {
    const message = clean(error?.message || error?.details || error || "小组基线操作失败");
    const code = Array.from(STABLE_CODES).find((item) => message.includes(item))
      || "GROUP_BASELINE_REQUEST_FAILED";
    const normalized = new Error(message);
    normalized.code = code;
    normalized.cause = error;
    return normalized;
  }

  function createGroupBaselineClient({ supabaseClient, getContext } = {}) {
    if (!supabaseClient) throw new Error("SUPABASE_CLIENT_REQUIRED");
    if (typeof getContext !== "function") throw new Error("GROUP_CONTEXT_PROVIDER_REQUIRED");

    function context() {
      const value = getContext() || {};
      const result = {
        teachingProjectId: clean(value.teachingProjectId ?? value.teaching_project_id),
        villageId: clean(value.villageId ?? value.village_id),
        spaceId: clean(value.spaceId ?? value.space_id),
        spaceType: clean(value.spaceType ?? value.space_type)
      };
      if (result.spaceType !== "group_plan") throw new Error("GROUP_PLAN_SPACE_REQUIRED");
      if (!result.teachingProjectId || !result.villageId || !result.spaceId) {
        throw new Error("GROUP_PLAN_CONTEXT_REQUIRED");
      }
      return result;
    }

    async function rpc(name, args) {
      const { data, error } = await supabaseClient.rpc(name, args);
      if (error) throw normalizeBaselineError(error);
      return data;
    }

    function scopedArgs(extra = {}) {
      const value = context();
      return {
        p_teaching_project_id: value.teachingProjectId,
        p_village_id: value.villageId,
        p_space_id: value.spaceId,
        ...extra
      };
    }

    async function getState() {
      return rpc("get_group_plan_baseline_state", scopedArgs());
    }

    async function previewUpdate({ targetSnapshotId } = {}) {
      const target = clean(targetSnapshotId);
      if (!target) throw new Error("TARGET_SNAPSHOT_REQUIRED");
      return rpc("preview_group_baseline_update", scopedArgs({ p_target_snapshot_id: target }));
    }

    async function applyUpdate({ targetSnapshotId, expectedBaseSnapshotId } = {}) {
      const target = clean(targetSnapshotId);
      const expected = clean(expectedBaseSnapshotId);
      if (!target || !expected) throw new Error("BASELINE_UPDATE_VERSION_REQUIRED");
      return rpc("apply_group_baseline_update", scopedArgs({
        p_target_snapshot_id: target,
        p_expected_base_snapshot_id: expected
      }));
    }

    async function listConflicts({ includeResolved = false } = {}) {
      const value = context();
      let query = supabaseClient
        .from("group_baseline_conflicts")
        .select("*")
        .eq("space_id", value.spaceId);
      if (!includeResolved) query = query.eq("resolution_status", "unresolved");
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw normalizeBaselineError(error);
      return Array.isArray(data) ? data : [];
    }

    async function resolveConflict({ conflictId, resolution, payload = {} } = {}) {
      return rpc("resolve_group_baseline_conflict", {
        p_conflict_id: clean(conflictId),
        p_resolution: clean(resolution),
        p_payload: payload || {}
      });
    }

    async function listRestorePoints() {
      const value = context();
      const { data, error } = await supabaseClient
        .from("group_plan_restore_points")
        .select("*")
        .eq("space_id", value.spaceId)
        .order("created_at", { ascending: false });
      if (error) throw normalizeBaselineError(error);
      return Array.isArray(data) ? data : [];
    }

    async function restorePoint({ restorePointId } = {}) {
      return rpc("restore_group_plan_restore_point", {
        p_restore_point_id: clean(restorePointId)
      });
    }

    return {
      getState,
      previewUpdate,
      applyUpdate,
      listConflicts,
      resolveConflict,
      listRestorePoints,
      restorePoint
    };
  }

  return { createGroupBaselineClient, normalizeBaselineError };
});
