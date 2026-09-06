(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyReviewClientModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SURVEY_LAYERS = new Set(["building", "road", "water"]);

  function normalize(value) {
    return String(value ?? "").trim();
  }

  function requireSharedContext(getContext) {
    const context = getContext?.() || {};
    if (normalize(context.spaceType) !== "formal_shared") {
      throw new Error("FORMAL_SHARED_SPACE_REQUIRED");
    }
    const teachingProjectId = normalize(context.teachingProjectId);
    const villageId = normalize(context.villageId);
    const spaceId = normalize(context.spaceId);
    if (!teachingProjectId) throw new Error("PROJECT_CONTEXT_REQUIRED");
    if (!villageId) throw new Error("VILLAGE_CONTEXT_REQUIRED");
    if (!spaceId) throw new Error("SPACE_CONTEXT_REQUIRED");
    return { teachingProjectId, villageId, spaceId };
  }

  function requireTarget(layerKey, objectCode) {
    const layer = normalize(layerKey);
    const code = normalize(objectCode);
    if (!SURVEY_LAYERS.has(layer)) throw new Error("SURVEY_LAYER_REQUIRED");
    if (!code) throw new Error("OBJECT_CODE_REQUIRED");
    return { layerKey: layer, objectCode: code };
  }

  function dataOrThrow(response) {
    if (response?.error) throw response.error;
    return response?.data ?? null;
  }

  function createSurveyReviewClient({ supabaseClient, getContext }) {
    if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");

    function contextualQuery() {
      const context = requireSharedContext(getContext);
      return {
        context,
        query: supabaseClient.from("survey_feature_reviews")
          .select("*")
          .eq("teaching_project_id", context.teachingProjectId)
          .eq("village_id", context.villageId)
          .eq("space_id", context.spaceId)
      };
    }

    return {
      async listReviews() {
        const { query } = contextualQuery();
        return dataOrThrow(await query.order("layer_key", { ascending: true })) || [];
      },

      async getReview(layerKey, objectCode) {
        const target = requireTarget(layerKey, objectCode);
        const { query } = contextualQuery();
        return dataOrThrow(await query
          .eq("layer_key", target.layerKey)
          .eq("object_code", target.objectCode)
          .maybeSingle());
      },

      async confirmGeometry(input = {}) {
        const context = requireSharedContext(getContext);
        const target = requireTarget(input.layerKey, input.objectCode);
        const expectedRevision = Number(input.expectedRevision);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new Error("EXPECTED_GEOMETRY_REVISION_REQUIRED");
        }
        const lockToken = normalize(input.lockToken);
        if (!lockToken) throw new Error("LOCK_TOKEN_REQUIRED");
        return dataOrThrow(await supabaseClient.rpc("confirm_survey_feature_geometry", {
          p_teaching_project_id: context.teachingProjectId,
          p_village_id: context.villageId,
          p_space_id: context.spaceId,
          p_layer_key: target.layerKey,
          p_object_code: target.objectCode,
          p_expected_revision: expectedRevision,
          p_lock_token: lockToken
        }));
      }
    };
  }

  return { createSurveyReviewClient, requireSharedContext };
});
