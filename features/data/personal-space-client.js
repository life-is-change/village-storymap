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
    return {
      async ensure({ courseId, villageId, title }) {
        return assertNoError(await supabaseClient.rpc("ensure_course_personal_space", {
          p_course_id: String(courseId),
          p_village_id: String(villageId),
          p_title: title ? String(title) : null
        }));
      },
      async listVersions(spaceId) {
        return assertNoError(await supabaseClient.from("personal_layer_versions")
          .select("*").eq("space_id", String(spaceId))
          .order("created_at", { ascending: false }));
      },
      async listSelections(spaceId) {
        return assertNoError(await supabaseClient.from("personal_layer_selections")
          .select("*").eq("space_id", String(spaceId))
          .order("layer_key", { ascending: true }));
      },
      async listFeatures(versionId) {
        return assertNoError(await supabaseClient.from("personal_layer_features")
          .select("*").eq("layer_version_id", String(versionId))
          .eq("is_deleted", false).order("object_code", { ascending: true }));
      },
      async upsertFeature({ spaceId, versionId, layerKey, objectCode, objectName, geom, props = {} }) {
        if (String(layerKey) === "contours") throw new Error("CONTOURS_READ_ONLY");
        return assertNoError(await supabaseClient.from("personal_layer_features").upsert({
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
      },
      async softDeleteFeature(versionId, objectCode) {
        return assertNoError(await supabaseClient.from("personal_layer_features")
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .eq("layer_version_id", String(versionId))
          .eq("object_code", String(objectCode)));
      },
      async setCurrentVersion(spaceId, layerKey, versionId) {
        return assertNoError(await supabaseClient.rpc("set_personal_layer_version", {
          p_space_id: String(spaceId),
          p_layer_key: String(layerKey),
          p_version_id: String(versionId)
        }));
      },
      async deleteVersion(versionId) {
        return assertNoError(await supabaseClient.rpc("delete_personal_layer_version", {
          p_version_id: String(versionId)
        }));
      },
      async saveEdits(spaceId, changes) {
        return assertNoError(await supabaseClient.rpc("save_personal_feature_edit_batch", {
          p_space_id: String(spaceId),
          p_changes: Array.isArray(changes) ? changes : []
        }));
      }
    };
  }

  return { createPersonalSpaceClient };
});
