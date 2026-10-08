(function (root, factory) {
  const packageModule = typeof module === "object" && module.exports
    ? require("./village-package.js")
    : root.VillagePackageModule;
  const api = factory(packageModule);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VillageAdminModule = api;
})(typeof window !== "undefined" ? window : globalThis, function (packageModule) {
  function codedError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function buildVillageDraftInput(input = {}) {
    const name = String(input.name || "").trim();
    if (!name) throw codedError("VILLAGE_NAME_REQUIRED");
    if (!input.boundary) throw codedError("VILLAGE_BOUNDARY_REQUIRED");
    return {
      name,
      isPractice: Boolean(input.isPractice),
      boundary: input.boundary,
      defaultCrs: String(input.defaultCrs || input.mibuDefaultCrs || "EPSG:4326").trim()
    };
  }

  function datasetLayers(dataset = {}) {
    return dataset.layers || dataset.layerManifest?.layers || dataset.layer_manifest?.layers || [];
  }

  function validateDatasetForPublication(dataset = {}) {
    if (!dataset.id) throw codedError("DATASET_NOT_FOUND");
    if (dataset.status !== "ready") throw codedError("DATASET_NOT_READY");
    const hasBuildings = datasetLayers(dataset).some((layer) =>
      ["building", "buildings"].includes(String(layer.type || "").toLowerCase())
      && Number(layer.featureCount ?? layer.feature_count ?? 0) > 0
    );
    if (!hasBuildings) throw codedError("BUILDINGS_REQUIRED");
    return dataset;
  }

  function validateRealityDraft(input = {}) {
    const ionAssetId = Number(input.ionAssetId);
    const heightOffset = Number(input.heightOffset || 0);
    if (!Number.isSafeInteger(ionAssetId) || ionAssetId <= 0) throw codedError("REALITY_ASSET_ID_INVALID");
    if (!Number.isFinite(heightOffset) || heightOffset < -1000 || heightOffset > 1000) {
      throw codedError("REALITY_HEIGHT_OFFSET_INVALID");
    }
    return { ionAssetId, heightOffset };
  }

  function getVillageActionState(village = {}, project = {}) {
    const datasets = village.datasets || village.village_datasets || [];
    const readyDataset = datasets.find((dataset) => dataset.status === "ready") || null;
    const isBound = Boolean(project?.formalVillageId === village.id || project?.formal_village_id === village.id);
    const published = Boolean(village.publishedDatasetId || village.published_dataset_id || village.status === "published");
    return {
      readyDatasetId: readyDataset?.id || null,
      canPublish: Boolean(readyDataset?.id),
      canBind: !village.isPractice && !village.is_practice && published && !isBound,
      isBound
    };
  }

  function createVillageAdminController({
    root = null, client, boundary, geoprocessing = null, supabaseClient = null, datasets = [],
    notify = () => {}, confirm = async () => true
  } = {}) {
    if (!client) throw codedError("VILLAGE_CLIENT_REQUIRED");
    let state = { villages: [], datasets: [...datasets], context: null, removalPreviews: {} };
    const listeners = [];

    function findVillage(villageId) {
      return state.villages.find((village) => village.id === villageId);
    }

    function findDataset(datasetId) {
      return state.datasets.find((dataset) => dataset.id === datasetId);
    }

    function render() {
      if (!root) return;
      const list = root.querySelector("[data-village-admin-list]");
      if (list) {
        list.innerHTML = state.villages.length
          ? state.villages.map((village) => {
            const actions = getVillageActionState(village, state.context?.project);
            const preview = state.removalPreviews[village.id] || {};
            const publishButton = actions.canPublish
              ? `<button class="admin-btn" type="button" data-village-publish-dataset="${escapeHtml(actions.readyDatasetId)}">发布 V0</button>`
              : "";
            const bindButton = actions.canBind
              ? `<button class="admin-btn admin-btn-primary" type="button" data-village-bind-formal="${escapeHtml(village.id)}">绑定为本学期正式村庄</button>`
              : (actions.isBound ? "<span>已绑定为正式村庄</span>" : "");
            let lifecycleAction = "";
            if (village.status === "archived") {
              lifecycleAction = `<button class="admin-btn" type="button" data-village-restore="${escapeHtml(village.id)}">恢复</button>`;
            } else if (preview.action === "delete") {
              lifecycleAction = `<button class="admin-btn admin-btn-danger" type="button" data-village-remove="${escapeHtml(village.id)}">永久删除</button>`;
            } else if (preview.action === "archive") {
              lifecycleAction = `<button class="admin-btn admin-btn-danger" type="button" data-village-remove="${escapeHtml(village.id)}">归档</button>`;
            } else if (preview.reason) {
              lifecycleAction = `<span class="village-lifecycle-note">${escapeHtml(preview.reason)}</span>`;
            }
            return `<li data-village-id="${escapeHtml(village.id)}"><strong>${escapeHtml(village.name)}</strong> <span class="village-status">${escapeHtml(village.status || "draft")}</span> ${publishButton} ${bindButton} ${lifecycleAction}</li>`;
          }).join("")
          : "<li>尚未创建村庄。</li>";
      }
      const project = root.querySelector("[data-village-active-project]");
      if (project) project.textContent = state.context?.project?.name || "尚未创建本学期教学项目";
      const activeProject = root.querySelector("[data-teaching-project-active]");
      const projectForm = root.querySelector("[data-teaching-project-create-form]");
      if (activeProject) {
        activeProject.hidden = !state.context?.project;
        const details = activeProject.querySelector("[data-teaching-project-details]");
        if (details && state.context?.project) {
          const current = state.context.project;
          details.innerHTML = `<strong>${escapeHtml(current.name)}</strong><span>课程模板：${escapeHtml(current.courseId || current.course_id || "-")}</span><span>阶段：${escapeHtml(current.stage || "preparing")}</span>`;
        }
      }
      if (projectForm) projectForm.hidden = Boolean(state.context?.project);
      root.querySelectorAll("[data-village-select]").forEach((select) => {
        const selected = select.value;
        select.innerHTML = '<option value="">选择村庄</option>' + state.villages
          .map((village) => `<option value="${escapeHtml(village.id)}">${escapeHtml(village.name)}</option>`)
          .join("");
        select.value = selected;
      });
      root.querySelectorAll("[data-practice-village-select]").forEach((select) => {
        const selected = select.value;
        select.innerHTML = '<option value="">选择练习村庄</option>' + state.villages
          .filter((village) => (village.isPractice || village.is_practice) && village.status === "published")
          .map((village) => `<option value="${escapeHtml(village.id)}">${escapeHtml(village.name)}</option>`)
          .join("");
        select.value = selected;
      });
    }

    async function refresh() {
      const [villages, context] = await Promise.all([
        client.listVillages(),
        client.getActiveContext().catch(() => null)
      ]);
      const removalPreviews = {};
      await Promise.all((villages || []).map(async (village) => {
        try {
          removalPreviews[village.id] = await client.getVillageRemovalPreview({ villageId: village.id });
        } catch (error) {
          removalPreviews[village.id] = { action: "blocked", reason: error.code || error.message };
        }
      }));
      state = { ...state, villages: villages || [], context, removalPreviews };
      const remoteDatasets = state.villages.flatMap((village) => village.datasets || village.village_datasets || []);
      if (remoteDatasets.length) state.datasets = remoteDatasets;
      render();
      return state;
    }

    async function createVillage(input) {
      const currentBoundary = input.boundary || boundary?.getBoundary?.()?.geometry;
      const mibu = state.villages.find((village) => village.isPractice);
      const created = await client.createDraft(buildVillageDraftInput({
        ...input,
        boundary: currentBoundary,
        mibuDefaultCrs: mibu?.defaultCrs || "EPSG:4326"
      }));
      notify("村庄草稿已创建", "success");
      await refresh();
      return created;
    }

    async function publishDataset(datasetId) {
      const dataset = validateDatasetForPublication(findDataset(datasetId));
      if (!await confirm("发布后将作为该村庄的当前 V0 数据，是否继续？")) return false;
      const result = await client.publishDataset({ datasetId: dataset.id });
      notify("V0 已发布", "success");
      await refresh();
      return result;
    }

    async function bindFormalVillage(villageId, teachingProjectId = state.context?.project?.id) {
      const village = findVillage(villageId);
      if (!village?.publishedDatasetId && village?.status !== "published") {
        throw codedError("PUBLISHED_DATASET_REQUIRED");
      }
      if (!teachingProjectId) throw codedError("PROJECT_REQUIRED");
      const result = await client.bindFormalVillage({ teachingProjectId, villageId });
      notify("正式村庄已绑定", "success");
      await refresh();
      return result;
    }

    async function archiveTeachingProject(teachingProjectId = state.context?.project?.id) {
      if (!teachingProjectId) throw codedError("PROJECT_REQUIRED");
      if (!await confirm("结束后该学期项目将归档，随后可创建下一学期项目。是否继续？")) return false;
      const result = await client.archiveTeachingProject({ teachingProjectId });
      notify("本学期教学项目已归档", "success");
      await refresh();
      return result;
    }

    async function createTeachingProject(input = {}) {
      if (state.context?.project) throw codedError("ACTIVE_PROJECT_EXISTS");
      const normalized = {
        name: String(input.name || "").trim(),
        courseId: String(input.courseId || "").trim(),
        practiceVillageId: String(input.practiceVillageId || "").trim()
      };
      if (!normalized.name) throw codedError("PROJECT_NAME_REQUIRED");
      if (!normalized.courseId) throw codedError("COURSE_REQUIRED");
      if (!normalized.practiceVillageId) throw codedError("PRACTICE_VILLAGE_REQUIRED");
      const result = await client.createTeachingProject(normalized);
      notify("新学期教学项目已创建", "success");
      await refresh();
      return result;
    }

    function storagePaths(preview = {}) {
      const paths = preview.storagePaths || preview.storage_paths || [];
      return Array.from(new Set((Array.isArray(paths) ? paths : []).map((path) => String(path || "").trim()).filter(Boolean)));
    }

    async function deleteVillage(villageId) {
      if (!findVillage(villageId)) throw codedError("VILLAGE_REQUIRED");
      const preview = await client.getVillageRemovalPreview({ villageId });
      if (preview?.action === "blocked") throw codedError(preview.reason || "VILLAGE_REMOVAL_BLOCKED");
      if (preview?.action === "archive") {
        if (!await confirm("该村庄已有使用记录，只能归档。归档后不再对学生显示，是否继续？")) return false;
        const result = await client.archiveVillage({ villageId });
        notify("村庄已归档，历史教学成果保持不变", "success");
        await refresh();
        return result;
      }
      if (preview?.action !== "delete") throw codedError(preview?.reason || "VILLAGE_REMOVAL_BLOCKED");
      if (!await confirm("该村庄尚未投入教学。此操作将永久删除管理员准备的数据与文件，是否继续？")) return false;
      const paths = storagePaths(preview);
      if (paths.length) {
        if (!supabaseClient?.storage?.from) throw codedError("STORAGE_CLEANUP_FAILED");
        const response = await supabaseClient.storage.from("village-datasets").remove(paths);
        if (response?.error) throw codedError("STORAGE_CLEANUP_FAILED");
      }
      const result = await client.deleteUnusedVillage({ villageId });
      notify("未使用村庄及其管理员准备数据已永久删除", "success");
      await refresh();
      return result;
    }

    async function restoreVillage(villageId) {
      if (!await confirm("恢复后，满足发布条件的练习村庄会重新向教学项目开放。是否继续？")) return false;
      const result = await client.restoreVillage({ villageId });
      notify("村庄已恢复", "success");
      await refresh();
      return result;
    }

    async function prepareOnPlatform(input) {
      if (!geoprocessing?.submit) throw codedError("GEOPROCESSING_REQUIRED");
      return geoprocessing.submit(input);
    }

    async function saveUploadedDataset(input) {
      return client.saveDatasetDraft({ ...input, sourceKind: "uploaded_bundle" });
    }

    async function importPackage({ villageId, files, packageId }) {
      if (!packageModule) throw codedError("PACKAGE_MODULE_REQUIRED");
      const selection = await packageModule.validatePackageSelection(files);
      const manifestVillage = String(selection.manifest.village?.name || "").trim();
      const selectedVillage = findVillage(villageId);
      if (!selectedVillage) throw codedError("VILLAGE_REQUIRED");
      if (manifestVillage && manifestVillage !== String(selectedVillage.name || "").trim()) {
        throw codedError("PACKAGE_VILLAGE_MISMATCH");
      }
      const uploadInput = await packageModule.uploadVillagePackage({
        supabaseClient,
        villageId,
        selection,
        packageId: packageId || `${selection.manifest.village.slug || "v0"}-${Date.now()}`
      });
      const saved = await saveUploadedDataset(uploadInput);
      notify("V0 数据包校验并上传完成，可在第 3 步发布", "success");
      await refresh();
      return saved;
    }

    async function saveRealityDraft(input) {
      const normalized = validateRealityDraft(input);
      return client.saveRealityDraft({
        ...input,
        ...normalized,
        title: String(input.title || "村庄实景模型").trim(),
        terrainEnabled: input.terrainEnabled !== false
      });
    }

    function bind(target, event, handler) {
      target?.addEventListener(event, handler);
      if (target) listeners.push(() => target.removeEventListener(event, handler));
    }

    async function mount() {
      if (root) {
        const list = root.querySelector("[data-village-admin-list]");
        bind(list, "click", async (event) => {
          const publishButton = event.target.closest?.("[data-village-publish-dataset]");
          const bindButton = event.target.closest?.("[data-village-bind-formal]");
          const removeButton = event.target.closest?.("[data-village-remove]");
          const restoreButton = event.target.closest?.("[data-village-restore]");
          try {
            if (publishButton) await publishDataset(publishButton.dataset.villagePublishDataset);
            if (bindButton) await bindFormalVillage(bindButton.dataset.villageBindFormal);
            if (removeButton) await deleteVillage(removeButton.dataset.villageRemove);
            if (restoreButton) await restoreVillage(restoreButton.dataset.villageRestore);
          } catch (error) {
            notify(error.code || error.message, "error");
          }
        });
        const projectArchiveButton = root.querySelector("[data-teaching-project-archive]");
        bind(projectArchiveButton, "click", async () => {
          try {
            await archiveTeachingProject();
          } catch (error) {
            notify(error.code || error.message, "error");
          }
        });
        const projectForm = root.querySelector("[data-teaching-project-create-form]");
        bind(projectForm, "submit", async (event) => {
          event.preventDefault();
          try {
            await createTeachingProject({
              name: projectForm.elements.projectName?.value,
              courseId: projectForm.elements.courseId?.value,
              practiceVillageId: projectForm.elements.practiceVillageId?.value
            });
            projectForm.reset();
          } catch (error) {
            notify(error.code || error.message, "error");
          }
        });
        const form = root.querySelector("[data-village-create-form]");
        bind(form, "submit", async (event) => {
          event.preventDefault();
          try {
            await createVillage({
              name: form.elements.villageName?.value,
              isPractice: form.elements.isPractice?.checked,
              defaultCrs: form.elements.defaultCrs?.value
            });
            form.reset();
          } catch (error) {
            notify(error.code || error.message, "error");
          }
        });
        const file = root.querySelector("[data-village-boundary-file]");
        bind(file, "change", async () => {
          try {
            const result = await boundary.loadFile(file.files?.[0]);
            const summary = root.querySelector("[data-village-boundary-summary]");
            if (summary) summary.textContent = `已读取 ${result.polygonCount} 个面，范围 ${result.bounds.join(", ")}`;
          } catch (error) {
            notify(error.code || error.message, "error");
          }
        });
        const bundleInput = root.querySelector("[data-village-upload-bundle]");
        bind(bundleInput, "change", async () => {
          try {
            const section = bundleInput.closest?.("[data-village-package-step]") || bundleInput.parentElement?.parentElement;
            const villageId = section?.querySelector("[name=villageId]")?.value;
            if (!villageId) throw codedError("VILLAGE_REQUIRED");
            const status = section?.querySelector("[data-village-package-status]");
            if (status) status.textContent = "正在校验文件并上传，请勿关闭页面…";
            const saved = await importPackage({ villageId, files: bundleInput.files });
            if (status) status.textContent = `导入完成：${saved?.version_label || saved?.versionLabel || "V0 数据包"}`;
            bundleInput.value = "";
          } catch (error) {
            const status = root.querySelector("[data-village-package-status]");
            if (status) status.textContent = `导入失败：${error.code || error.message}`;
            notify(error.code || error.message || "DATASET_MANIFEST_INVALID", "error");
          }
        });
        const realityForm = root.querySelector("[data-village-reality-form]");
        bind(realityForm, "submit", async (event) => {
          event.preventDefault();
          try {
            const saved = await saveRealityDraft({
              villageId: realityForm.elements.villageId?.value,
              ionAssetId: realityForm.elements.ionAssetId?.value,
              heightOffset: realityForm.elements.heightOffset?.value,
              title: realityForm.elements.title?.value
            });
            if (realityForm.elements.publishNow?.checked && saved?.id) {
              await client.publishRealityModel({ modelId: saved.id });
              notify("实景模型已发布；进入3D后将独立加载，不影响白模", "success");
            } else {
              notify("实景模型草稿已保存，发布后即可在3D中独立加载", "success");
            }
            await refresh();
          } catch (error) {
            notify(error.code || error.message, "error");
          }
        });
      }
      return refresh();
    }

    function destroy() {
      listeners.splice(0).forEach((dispose) => dispose());
      boundary?.destroy?.();
    }

    return {
      mount, refresh, destroy, createVillage, publishDataset, bindFormalVillage,
      archiveTeachingProject, createTeachingProject, deleteVillage, restoreVillage,
      prepareOnPlatform, saveUploadedDataset, importPackage, saveRealityDraft,
      publishRealityModel: (modelId) => client.publishRealityModel({ modelId }),
      getState: () => state
    };
  }

  return {
    buildVillageDraftInput,
    createVillageAdminController,
    getVillageActionState,
    validateDatasetForPublication,
    validateRealityDraft
  };
});
