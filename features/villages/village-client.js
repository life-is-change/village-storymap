(function (root, factory) {
  const model = typeof module === "object" && module.exports
    ? require("./village-model.js")
    : root.VillageModelModule;
  const api = factory(model);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VillageClientModule = api;
})(typeof window !== "undefined" ? window : globalThis, function (model) {
  const { SPACE_TYPES, normalizeVillage, normalizeTeachingProject } = model;

  function required(value, code) {
    const normalized = String(value ?? "").trim();
    if (!normalized) throw createError(code);
    return normalized;
  }

  function createError(code, cause = null) {
    const error = new Error(code);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function errorCode(error) {
    const text = String(error?.message || error?.details || error?.hint || error || "SUPABASE_ERROR");
    return text.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0] || "SUPABASE_ERROR";
  }

  function dataOrThrow(response) {
    if (response?.error) throw createError(errorCode(response.error), response.error);
    return response?.data ?? null;
  }

  function mapSpace(row = {}) {
    return {
      id: String(row.id || ""),
      teachingProjectId: row.teaching_project_id || row.teachingProjectId || "",
      villageId: row.village_id || row.villageId || "",
      baseDatasetId: row.base_dataset_id || row.baseDatasetId || null,
      spaceType: row.space_type || row.spaceType || "",
      ownerId: row.owner_id || row.ownerId || null,
      groupId: row.group_id || row.groupId || null,
      title: row.title || "",
      readonly: Boolean(row.readonly)
    };
  }

  function mapVillage(row = {}) {
    const village = normalizeVillage(row);
    const datasets = row.village_datasets || row.datasets || [];
    const publishedDataset = datasets
      .find((dataset) => dataset.status === "published") || null;
    const realityModel = (row.village_reality_models || row.realityModels || [])
      .find((resource) => resource.status === "published") || null;
    return {
      ...village,
      datasets,
      publishedDatasetId: publishedDataset?.id || row.publishedDatasetId || null,
      publishedDataset,
      realityModel
    };
  }

  function createVillageClient({ supabaseClient }) {
    if (!supabaseClient) throw createError("SUPABASE_REQUIRED");

    async function rpc(name, args) {
      return dataOrThrow(await supabaseClient.rpc(name, args));
    }

    async function listVillages() {
      const response = await supabaseClient.from("villages")
        .select("*,village_datasets(*),village_reality_models(*)")
        .order("is_practice", { ascending: true })
        .order("name", { ascending: true });
      return (dataOrThrow(response) || []).map(mapVillage);
    }

    async function listSpaces(context = {}) {
      const teachingProjectId = required(context.teachingProjectId, "PROJECT_REQUIRED");
      const villageId = required(context.villageId, "VILLAGE_REQUIRED");
      const response = await supabaseClient.from("planning_spaces").select("*")
        .eq("teaching_project_id", teachingProjectId)
        .eq("village_id", villageId)
        .order("created_at", { ascending: true });
      return (dataOrThrow(response) || []).map(mapSpace);
    }

    return {
      async getActiveContext() {
        const raw = await rpc("get_active_project_context", {});
        if (!raw?.project) return null;
        const project = normalizeTeachingProject(raw.project);
        const allowedVillageIds = new Set([project.practiceVillageId, project.formalVillageId].filter(Boolean));
        const villages = (await listVillages()).filter((village) => allowedVillageIds.has(village.id));
        const activeVillageId = project.formalProjectOpen && project.formalVillageId
          ? project.formalVillageId
          : project.practiceVillageId;
        const spaces = await listSpaces({ teachingProjectId: project.id, villageId: activeVillageId });
        let userId = null;
        let isStaff = false;
        if (supabaseClient.auth?.getUser) {
          const authResponse = await supabaseClient.auth.getUser();
          if (authResponse?.error) throw createError(errorCode(authResponse.error), authResponse.error);
          userId = authResponse?.data?.user?.id || null;
          const role = authResponse?.data?.user?.app_metadata?.role || authResponse?.data?.user?.user_metadata?.role;
          isStaff = role === "teacher" || role === "admin";
        }
        return {
          project,
          villages,
          actor: { userId, groupId: null, isStaff },
          spaces
        };
      },
      listVillages,
      listSpaces,
      async ensurePersonalSpace(context = {}) {
        const teachingProjectId = required(context.teachingProjectId, "PROJECT_REQUIRED");
        const villageId = required(context.villageId, "VILLAGE_REQUIRED");
        const spaceType = context.villageRole === "practice"
          ? SPACE_TYPES.PRACTICE_PERSONAL
          : SPACE_TYPES.FORMAL_PERSONAL;
        return rpc("ensure_context_space", {
          p_teaching_project_id: teachingProjectId,
          p_village_id: villageId,
          p_space_type: spaceType,
          p_title: context.title ? String(context.title).trim() : null,
          p_group_id: null
        });
      },
      createDraft(input = {}) {
        return rpc("create_village_draft", {
          p_name: required(input.name, "VILLAGE_NAME_REQUIRED"),
          p_is_practice: Boolean(input.isPractice),
          p_boundary: input.boundary || null,
          p_default_crs: String(input.defaultCrs || "EPSG:4326")
        });
      },
      createTeachingProject(input = {}) {
        return rpc("create_teaching_project", {
          p_name: required(input.name, "PROJECT_NAME_REQUIRED"),
          p_course_id: required(input.courseId, "COURSE_REQUIRED"),
          p_practice_village_id: required(input.practiceVillageId, "PRACTICE_VILLAGE_REQUIRED")
        });
      },
      saveDatasetDraft(input = {}) {
        return rpc("save_village_dataset_draft", {
          p_village_id: required(input.villageId, "VILLAGE_REQUIRED"),
          p_source_kind: required(input.sourceKind, "SOURCE_KIND_REQUIRED"),
          p_imagery_config: input.imageryConfig || null,
          p_layer_manifest: input.layerManifest || {},
          p_validation_summary: input.validationSummary || {},
          p_status: input.status || "draft",
          p_dataset_id: input.datasetId || null,
          p_version_label: input.versionLabel || null
        });
      },
      publishDataset(input = {}) {
        return rpc("publish_village_dataset", {
          p_dataset_id: required(input.datasetId, "DATASET_REQUIRED")
        });
      },
      bindFormalVillage(input = {}) {
        return rpc("bind_formal_village", {
          p_teaching_project_id: required(input.teachingProjectId, "PROJECT_REQUIRED"),
          p_village_id: required(input.villageId, "VILLAGE_REQUIRED")
        });
      },
      saveRealityDraft(input = {}) {
        return rpc("save_village_reality_model_draft", {
          p_village_id: required(input.villageId, "VILLAGE_REQUIRED"),
          p_ion_asset_id: Number(input.ionAssetId),
          p_title: required(input.title, "REALITY_MODEL_TITLE_REQUIRED"),
          p_height_offset: Number(input.heightOffset || 0),
          p_terrain_enabled: input.terrainEnabled !== false,
          p_status: input.status || "draft",
          p_model_id: input.modelId || null
        });
      },
      publishRealityModel(input = {}) {
        return rpc("publish_village_reality_model", {
          p_model_id: required(input.modelId, "REALITY_MODEL_REQUIRED")
        });
      }
    };
  }

  return { createVillageClient, dataOrThrow, errorCode, mapSpace, mapVillage };
});
