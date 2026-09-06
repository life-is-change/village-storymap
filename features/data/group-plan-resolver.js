(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GroupPlanResolverModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const EDITABLE_GROUP_LAYERS = new Set(["building", "road", "water"]);
  const OPERATIONS = new Set(["added", "updated", "deleted"]);

  function clean(value) {
    return String(value ?? "").trim();
  }

  function canEditGroupLayer(layerKey) {
    return EDITABLE_GROUP_LAYERS.has(clean(layerKey));
  }

  function featureKey(layerKey, objectCode) {
    return `${clean(layerKey)}::${clean(objectCode)}`;
  }

  function overrideTarget(row = {}) {
    return featureKey(row.layer_key, row.base_object_code || row.object_code);
  }

  function compareOverride(left = {}, right = {}) {
    const revisionDiff = Number(left.feature_revision || 0) - Number(right.feature_revision || 0);
    if (revisionDiff) return revisionDiff;
    return String(left.updated_at || "").localeCompare(String(right.updated_at || ""));
  }

  function resolveSparsePlan({ baselineItems = [], overrides = [] } = {}) {
    const latest = new Map();
    (Array.isArray(overrides) ? overrides : []).forEach((row) => {
      const operation = clean(row?.operation_kind);
      if (!OPERATIONS.has(operation)) throw new Error("GROUP_OVERRIDE_OPERATION_INVALID");
      const key = overrideTarget(row);
      if (!clean(row?.layer_key) || !clean(row?.object_code)) throw new Error("GROUP_OVERRIDE_IDENTITY_REQUIRED");
      const current = latest.get(key);
      if (!current || compareOverride(row, current) > 0) latest.set(key, row);
    });

    const resolved = [];
    (Array.isArray(baselineItems) ? baselineItems : []).forEach((row) => {
      const key = featureKey(row?.layer_key, row?.object_code);
      const override = latest.get(key);
      if (override?.operation_kind === "deleted") return;
      if (override?.operation_kind === "updated") {
        resolved.push({ ...override, source: "group_override" });
        return;
      }
      resolved.push({
        ...row,
        operation_kind: null,
        feature_revision: Number(row?.feature_revision || 0),
        source: "baseline"
      });
    });

    latest.forEach((row) => {
      if (row.operation_kind === "added") resolved.push({ ...row, source: "group_override" });
    });

    return resolved.sort((left, right) => (
      clean(left.layer_key).localeCompare(clean(right.layer_key))
      || clean(left.object_code).localeCompare(clean(right.object_code))
    ));
  }

  function normalizeResolvedFeature(row = {}) {
    return {
      layerKey: clean(row.layer_key ?? row.layerKey),
      objectCode: clean(row.object_code ?? row.objectCode),
      geometry: row.geom ?? row.geometry ?? null,
      properties: row.props ?? row.properties ?? {},
      source: clean(row.source) || "baseline",
      operationKind: row.operation_kind ?? row.operationKind ?? null,
      featureRevision: Number(row.feature_revision ?? row.featureRevision ?? 0)
    };
  }

  function createGroupPlanLoader({ client } = {}) {
    if (!client) throw new Error("SUPABASE_CLIENT_REQUIRED");
    const cache = new Map();
    const pending = new Map();

    function contextValue(context, camel, snake) {
      return clean(context?.[camel] ?? context?.[snake]);
    }

    function normalizeContext(context = {}) {
      const normalized = {
        teachingProjectId: contextValue(context, "teachingProjectId", "teaching_project_id"),
        villageId: contextValue(context, "villageId", "village_id"),
        spaceId: contextValue(context, "spaceId", "space_id")
      };
      if (!normalized.teachingProjectId || !normalized.villageId || !normalized.spaceId) {
        throw new Error("GROUP_PLAN_CONTEXT_REQUIRED");
      }
      return normalized;
    }

    function keyFor(context) {
      const value = normalizeContext(context);
      return `${value.teachingProjectId}::${value.villageId}::${value.spaceId}`;
    }

    async function load(context, options = {}) {
      const normalized = normalizeContext(context);
      const key = keyFor(normalized);
      if (!options.force && cache.has(key)) return cache.get(key);
      if (!options.force && pending.has(key)) return pending.get(key);
      const request = (async () => {
        const { data, error } = await client.rpc("resolve_group_plan_features", {
          p_teaching_project_id: normalized.teachingProjectId,
          p_village_id: normalized.villageId,
          p_space_id: normalized.spaceId,
          p_layer_key: null
        });
        if (error) throw error;
        const rows = (Array.isArray(data) ? data : []).map((row) => ({
          ...row,
          feature_revision: Number(row?.feature_revision || 0)
        }));
        cache.set(key, rows);
        return rows;
      })();
      pending.set(key, request);
      try {
        return await request;
      } finally {
        pending.delete(key);
      }
    }

    function invalidate(spaceId = "") {
      const normalizedSpaceId = clean(spaceId);
      if (!normalizedSpaceId) {
        cache.clear();
        return;
      }
      [...cache.keys()].forEach((key) => {
        if (key.endsWith(`::${normalizedSpaceId}`)) cache.delete(key);
      });
    }

    function forLayer(rows, layerKey) {
      const normalizedLayer = clean(layerKey);
      return (Array.isArray(rows) ? rows : []).filter((row) => clean(row?.layer_key) === normalizedLayer);
    }

    return { load, invalidate, forLayer };
  }

  return {
    EDITABLE_GROUP_LAYERS,
    canEditGroupLayer,
    resolveSparsePlan,
    normalizeResolvedFeature,
    createGroupPlanLoader
  };
});
