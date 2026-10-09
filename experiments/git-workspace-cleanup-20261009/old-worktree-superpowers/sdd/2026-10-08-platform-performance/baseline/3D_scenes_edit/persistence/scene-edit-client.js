(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("../domain/scene-document") : root.SceneDocumentModule
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEditClientModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SceneDocument) {
  function normalizeError(error) {
    if (!error) return null;
    const message = String(error.message || error.details || "Scene edit request failed");
    if (error.code === "40001" || message.includes("REVISION_CONFLICT")) {
      const parsed = Number.parseInt(error.details, 10);
      return { ok: false, code: "REVISION_CONFLICT", message, remoteRevision: Number.isFinite(parsed) ? parsed : null };
    }
    if (/fetch|network|offline|timeout/i.test(message)) return { ok: false, code: "NETWORK_ERROR", message };
    if (/jwt|auth|forbidden|permission/i.test(message)) return { ok: false, code: "FORBIDDEN", message };
    return { ok: false, code: "REQUEST_FAILED", message };
  }

  function createSceneEditClient(options) {
    const supabase = options?.supabaseClient;

    async function rpc(name, args) {
      if (!supabase?.rpc) return { ok: false, code: "AUTH_UNAVAILABLE", message: "Supabase client is unavailable" };
      try {
        const { data, error } = await supabase.rpc(name, args);
        return error ? normalizeError(error) : { ok: true, data };
      } catch (error) {
        return normalizeError(error);
      }
    }

    async function query(build) {
      if (!supabase?.from) return { ok: false, code: "AUTH_UNAVAILABLE", message: "Supabase client is unavailable" };
      try {
        const { data, error } = await build();
        return error ? normalizeError(error) : { ok: true, data: data || [] };
      } catch (error) {
        return normalizeError(error);
      }
    }

    return {
      findActiveProject(scope) {
        return query(() => {
          let request = supabase.from("scene_edit_projects").select("id, revision, updated_at")
            .eq("teaching_project_id", scope.teachingProjectId).eq("village_id", scope.villageId)
            .eq("scope_kind", scope.scopeKind || "group");
          request = scope.scopeKind === "admin_sandbox"
            ? request.is("group_id", null).eq("created_by", scope.ownerId)
            : request.eq("group_id", scope.groupId);
          return request.eq("space_id", scope.spaceId).eq("status", "draft")
            .order("updated_at", { ascending: false }).limit(1).maybeSingle();
        });
      },
      createProject(input) {
        return rpc("scene_edit_create_project", {
          p_teaching_project_id: input.teachingProjectId,
          p_village_id: input.villageId,
          p_space_id: input.spaceId,
          p_group_id: input.groupId,
          p_scope_kind: input.scopeKind || "group",
          p_title: input.title,
          p_baseline_revision: input.baselineRevision,
          p_selection_boundary: input.selectionBoundary || null
        });
      },
      branchFromBaseline(input) {
        return rpc("scene_edit_branch_project", {
          p_project_id: input.projectId,
          p_new_baseline_revision: input.baselineRevision,
          p_title: input.title
        });
      },
      loadProject(projectId) {
        return rpc("scene_edit_load_project", { p_project_id: projectId });
      },
      saveDraft(document) {
        const validation = SceneDocument.validate(document);
        if (!validation.ok) return Promise.resolve({ ok: false, code: "VALIDATION_FAILED", message: validation.errors.join("; "), errors: validation.errors });
        return rpc("scene_edit_save_draft", {
          p_project_id: document.projectId,
          p_expected_revision: document.revision,
          p_document: SceneDocument.clone(document)
        });
      },
      createVersion(input) {
        const validation = SceneDocument.validate(input.document);
        if (!validation.ok) return Promise.resolve({ ok: false, code: "VALIDATION_FAILED", message: validation.errors.join("; "), errors: validation.errors });
        return rpc("scene_edit_create_version", {
          p_project_id: input.document.projectId,
          p_expected_revision: input.document.revision,
          p_label: input.label,
          p_description: input.description || "",
          p_preview_path: input.previewPath || null
        });
      },
      restoreVersionAsDraft(input) {
        return rpc("scene_edit_restore_version", { p_version_id: input.versionId, p_title: input.title });
      },
      submitVersion(versionId) {
        return rpc("scene_edit_submit_version", { p_version_id: versionId });
      },
      listVersions(projectId) {
        return query(() => supabase.from("scene_edit_versions").select("*").eq("project_id", projectId).order("created_at", { ascending: false }));
      },
      listAssets(scope) {
        return query(() => supabase.from("scene_edit_assets").select("*").eq("course_id", scope.courseId).is("archived_at", null).order("created_at", { ascending: false }));
      },
      registerAsset(record) {
        return rpc("scene_edit_register_asset", {
          p_course_id: record.course_id,
          p_group_id: record.group_id || null,
          p_scope_kind: record.scope_kind,
          p_kind: record.kind,
          p_storage_path: record.storage_path,
          p_display_name: record.display_name,
          p_mime_type: record.mime_type,
          p_file_size: record.file_size,
          p_metadata: record.metadata || {},
          p_license: record.license || "student-provided"
        });
      },
      updateAssetMetadata(assetId, metadata) {
        return rpc("scene_edit_update_asset_metadata", { p_asset_id: assetId, p_metadata: metadata || {} });
      },
      publishAsset(assetId) {
        return rpc("scene_edit_publish_asset", { p_asset_id: assetId });
      },
      copySharedAsset(assetId, groupId) {
        return rpc("scene_edit_copy_asset", { p_asset_id: assetId, p_group_id: groupId });
      },
      archiveAsset(assetId) {
        return rpc("scene_edit_archive_asset", { p_asset_id: assetId });
      },
      saveComponent(input) {
        return rpc("scene_edit_save_component", {
          p_course_id: input.courseId,
          p_group_id: input.groupId || null,
          p_scope_kind: input.scope,
          p_display_name: input.displayName,
          p_document_fragment: input.fragment,
          p_preview_path: input.previewPath || null
        });
      },
      listComponents(scope) {
        return query(() => supabase.from("scene_edit_components").select("*").eq("course_id", scope.courseId).is("archived_at", null).order("created_at", { ascending: false }));
      },
      publishComponent(componentId) {
        return rpc("scene_edit_publish_component", { p_component_id: componentId });
      },
      copySharedComponent(componentId, groupId) {
        return rpc("scene_edit_copy_component", { p_component_id: componentId, p_group_id: groupId });
      },
      archiveComponent(componentId) {
        return rpc("scene_edit_archive_component", { p_component_id: componentId });
      }
    };
  }

  return { createSceneEditClient, normalizeError };
});
