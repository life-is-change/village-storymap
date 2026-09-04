(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PersonalSpaceClientModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function assertNoError(response) {
    if (response?.error) throw response.error;
    return response?.data ?? null;
  }

  function createPersonalSpaceClient({ supabaseClient }) {
    if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");
    const selectionCache = new Map();
    const featureCache = new Map();
    const versionCache = new Map();

    function cached(cache, key, loader) {
      if (cache.has(key)) return cache.get(key);
      const pending = Promise.resolve().then(loader).catch((error) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, pending);
      return pending;
    }

    function invalidateCache({ spaceId = null, versionId = null } = {}) {
      if (spaceId == null && versionId == null) {
        selectionCache.clear();
        featureCache.clear();
        versionCache.clear();
        return;
      }
      if (spaceId != null) selectionCache.delete(String(spaceId));
      if (spaceId != null) versionCache.delete(String(spaceId));
      if (versionId != null) featureCache.delete(String(versionId));
    }

    return {
      async ensure({ courseId, teachingProjectId, villageId, spaceType, title }) {
        if (!teachingProjectId) throw new Error("PROJECT_REQUIRED");
        if (!["practice_personal", "formal_personal"].includes(spaceType)) throw new Error("PERSONAL_SPACE_TYPE_REQUIRED");
        return assertNoError(await supabaseClient.rpc("ensure_course_personal_space", {
          p_course_id: String(courseId),
          p_teaching_project_id: String(teachingProjectId),
          p_village_id: String(villageId),
          p_space_type: spaceType,
          p_title: title ? String(title) : null
        }));
      },
      async listVersions(spaceId) {
        const key = String(spaceId);
        return cached(versionCache, key, async () => assertNoError(
          await supabaseClient.from("personal_layer_versions")
            .select("*").eq("space_id", key)
            .order("created_at", { ascending: false })
        ));
      },
      async listSelections(spaceId) {
        const key = String(spaceId);
        return cached(selectionCache, key, async () => assertNoError(
          await supabaseClient.from("personal_layer_selections")
            .select("*").eq("space_id", key)
            .order("layer_key", { ascending: true })
        ));
      },
      async listFeatures(versionId) {
        const key = String(versionId);
        return cached(featureCache, key, async () => assertNoError(
          await supabaseClient.from("personal_layer_features")
            .select("*").eq("layer_version_id", key)
            .eq("is_deleted", false).order("object_code", { ascending: true })
        ));
      },
      async refreshCurrentLayers(spaceId) {
        const key = String(spaceId);
        const previousSelections = await this.listSelections(key);
        (Array.isArray(previousSelections) ? previousSelections : []).forEach((selection) => {
          if (selection?.current_version_id) featureCache.delete(String(selection.current_version_id));
        });
        selectionCache.delete(key);
        versionCache.delete(key);
        const freshSelections = await this.listSelections(key);
        return Promise.all((Array.isArray(freshSelections) ? freshSelections : [])
          .filter((selection) => selection?.current_version_id)
          .map((selection) => this.listFeatures(selection.current_version_id)));
      },
      async upsertFeature({ spaceId, versionId, layerKey, objectCode, objectName, geom, props = {} }) {
        if (String(layerKey) === "contours") throw new Error("CONTOURS_READ_ONLY");
        const result = assertNoError(await supabaseClient.from("personal_layer_features").upsert({
          space_id: String(spaceId),
          layer_version_id: String(versionId),
          layer_key: String(layerKey),
          object_code: String(objectCode),
          object_name: String(objectName || objectCode),
          geom,
          props,
          is_deleted: false,
          updated_at: new Date().toISOString()
        }, { onConflict: "layer_version_id,object_code" }));
        invalidateCache({ versionId });
        return result;
      },
      async softDeleteFeature(versionId, objectCode) {
        const result = assertNoError(await supabaseClient.from("personal_layer_features")
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .eq("layer_version_id", String(versionId))
          .eq("object_code", String(objectCode)));
        invalidateCache({ versionId });
        return result;
      },
      async setCurrentVersion(spaceId, layerKey, versionId) {
        const result = assertNoError(await supabaseClient.rpc("set_personal_layer_version", {
          p_space_id: String(spaceId),
          p_layer_key: String(layerKey),
          p_version_id: String(versionId)
        }));
        invalidateCache({ spaceId });
        return result;
      },
      async deleteVersion(versionId) {
        const result = assertNoError(await supabaseClient.rpc("delete_personal_layer_version", {
          p_version_id: String(versionId)
        }));
        invalidateCache();
        return result;
      },
      async saveEdits(spaceId, changes) {
        const normalizedSpaceId = String(spaceId);
        selectionCache.delete(normalizedSpaceId);
        const freshSelections = await this.listSelections(normalizedSpaceId);
        const versionApi = typeof module === "object" && module.exports
          ? require("./personal-edit-version.js")
          : globalThis.PersonalEditVersionModule;
        versionApi.assertChangesMatchSelections(changes, freshSelections);
        const result = assertNoError(await supabaseClient.rpc("save_personal_feature_edit_batch", {
          p_space_id: normalizedSpaceId,
          p_changes: Array.isArray(changes) ? changes : []
        }));
        invalidateCache();
        return result;
      },
      invalidateCache
    };
  }

  return { createPersonalSpaceClient };
});
