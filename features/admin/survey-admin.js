(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyAdminModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalizeSurveyDashboard(row = {}) {
    return {
      baselineTotal: Number(row.baseline_total || 0),
      reviewedBaseline: Number(row.reviewed_baseline || 0),
      added: Number(row.added || 0),
      deleted: Number(row.deleted || 0),
      currentActive: Number(row.current_active || 0)
    };
  }

  function buildSurveyFeatureFilters(input = {}) {
    return {
      layerKey: String(input.layer || input.layerKey || ""),
      geometryStatus: String(input.status || input.geometryStatus || ""),
      actorId: String(input.actorId || "")
    };
  }

  function resolveFormalSharedContext(state = {}) {
    const project = state.project || state.context?.project;
    const villageId = project?.formalVillageId || project?.formal_village_id;
    if (!project?.id || !villageId) return null;
    const spaces = state.spaces || state.context?.spaces || [];
    const space = spaces.find((item) =>
      (item.villageId || item.village_id) === villageId
      && (item.spaceType || item.space_type) === "formal_shared"
    );
    if (!space?.id) return null;
    const villages = state.villages || state.context?.villages || [];
    const village = villages.find((item) => item.id === villageId);
    return {
      teachingProjectId: project.id,
      villageId,
      spaceId: space.id,
      projectName: String(project.name || ""),
      villageName: String(village?.name || "")
    };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  async function assertPhotoDeletable(supabaseClient, photoId) {
    const response = await supabaseClient.rpc("assert_survey_photo_deletable", { p_photo_id: Number(photoId) });
    if (response?.error) throw response.error;
    return response?.data === true;
  }

  function requireContext(context = {}) {
    if (!context.teachingProjectId || !context.villageId || !context.spaceId) {
      throw new Error("SURVEY_CONTEXT_REQUIRED");
    }
    return context;
  }

  function createSurveyAdminController({ root: panelRoot, supabaseClient, notify } = {}) {
    if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");
    let currentContext = null;
    let listenersBound = false;
    async function rpc(name, args) {
      const response = await supabaseClient.rpc(name, args);
      if (response?.error) throw response.error;
      return response?.data;
    }
    return {
      async loadDashboard(context) {
        const current = requireContext(context);
        const data = await rpc("get_shared_survey_dashboard", {
          p_teaching_project_id: current.teachingProjectId,
          p_village_id: current.villageId,
          p_space_id: current.spaceId
        });
        const dashboard = normalizeSurveyDashboard(data || {});
        if (panelRoot) {
          const stats = panelRoot.querySelector?.("[data-survey-stats]") || panelRoot;
          stats.innerHTML = `<div class="admin-stat-grid">
            <div><strong>${dashboard.reviewedBaseline} / ${dashboard.baselineTotal}</strong><span>V0 几何校核</span></div>
            <div><strong>${dashboard.added}</strong><span>新增</span></div>
            <div><strong>${dashboard.deleted}</strong><span>删除</span></div>
            <div><strong>${dashboard.currentActive}</strong><span>当前对象</span></div>
          </div>`;
        }
        return dashboard;
      },
      async listFeatures(input) {
        const context = requireContext(input);
        const filters = buildSurveyFeatureFilters(input);
        return rpc("list_shared_survey_features", {
          p_teaching_project_id: context.teachingProjectId,
          p_village_id: context.villageId,
          p_space_id: context.spaceId,
          p_layer_key: filters.layerKey || null,
          p_geometry_status: filters.geometryStatus || null,
          p_actor_id: filters.actorId || null
        });
      },
      async restoreVersion(input) {
        const context = requireContext(input);
        const data = await rpc("restore_survey_feature_version", {
          p_teaching_project_id: context.teachingProjectId,
          p_village_id: context.villageId,
          p_space_id: context.spaceId,
          p_layer_key: input.layerKey,
          p_object_code: input.objectCode,
          p_feature_version_id: input.featureVersionId,
          p_expected_revision: input.expectedRevision
        });
        notify?.("历史版本已恢复", "success");
        return data;
      },
      async freezeSnapshot(input) {
        const context = requireContext(input);
        const data = await rpc("freeze_shared_survey_snapshot", {
          p_teaching_project_id: context.teachingProjectId,
          p_village_id: context.villageId,
          p_space_id: context.spaceId,
          p_version_name: String(input.versionName || "").trim(),
          p_description: String(input.description || "").trim(),
          p_recommended_for_groups: Boolean(input.recommendedForGroups)
        });
        notify?.("共享现状版本已冻结，现状空间仍可继续编辑", "success");
        return data;
      },
      async loadHistory(input) {
        const context = requireContext(input);
        const response = await supabaseClient.from("feature_versions")
          .select("id,action,created_at,created_by,created_by_user_id")
          .eq("teaching_project_id", context.teachingProjectId)
          .eq("village_id", context.villageId)
          .eq("space_id", context.spaceId)
          .eq("layer_key", input.layerKey)
          .eq("object_code", input.objectCode)
          .order("created_at", { ascending: false });
        if (response?.error) throw response.error;
        return response?.data || [];
      },
      async mount(context) {
        currentContext = requireContext(context);
        if (panelRoot) {
          panelRoot.innerHTML = `<div class="survey-admin-context">
            <div><span>教学项目</span><strong>${escapeHtml(context.projectName || "未命名项目")}</strong></div>
            <div><span>正式村庄</span><strong>${escapeHtml(context.villageName || context.villageId)}</strong></div>
            <div><span>共享空间</span><strong>${escapeHtml(context.spaceId)}</strong></div>
          </div><div data-survey-stats></div>
          <form class="admin-course-toolbar" data-survey-freeze-form>
            <input name="versionName" class="admin-course-input" required placeholder="版本名称，例如 V1 第一次现场校核" />
            <input name="description" class="admin-course-input" placeholder="版本说明（可选）" />
            <label class="admin-course-hint"><input name="recommended" type="checkbox" /> 推荐作为后续小组底图</label>
            <button type="submit" class="admin-btn admin-btn-primary">冻结当前版本</button>
          </form>
          <div class="admin-course-toolbar" data-survey-filters>
            <select name="layer" class="admin-course-select"><option value="">全部图层</option><option value="building">建筑</option><option value="road">道路</option><option value="water">水系</option></select>
            <select name="status" class="admin-course-select"><option value="">全部状态</option><option value="pending">未校核</option><option value="confirmed_unchanged">确认无误</option><option value="modified">已修改</option><option value="deleted">已删除</option><option value="added">新增</option></select>
            <input name="actorId" class="admin-course-input" placeholder="最近操作者 ID（可选）" />
            <button type="button" class="admin-btn" data-survey-refresh>刷新</button>
          </div>
          <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>图层</th><th>对象</th><th>状态</th><th>修订</th><th>最近操作</th><th>操作</th></tr></thead><tbody data-survey-feature-list><tr><td colspan="6" class="admin-empty">加载中…</td></tr></tbody></table></div>
          <div data-survey-history></div>`;
        }
        const refresh = async () => {
          const filters = panelRoot?.querySelector?.("[data-survey-filters]");
          const input = {
            ...currentContext,
            layer: filters?.querySelector?.("[name=layer]")?.value || "",
            status: filters?.querySelector?.("[name=status]")?.value || "",
            actorId: filters?.querySelector?.("[name=actorId]")?.value || ""
          };
          const [dashboard, rows] = await Promise.all([this.loadDashboard(currentContext), this.listFeatures(input)]);
          const list = panelRoot?.querySelector?.("[data-survey-feature-list]");
          if (list) list.innerHTML = rows.length ? rows.map((row) => `<tr>
            <td>${escapeHtml(row.layer_key)}</td><td>${escapeHtml(row.object_code)}</td><td>${escapeHtml(row.geometry_status)}</td><td>${Number(row.geometry_revision || 0)}</td>
            <td>${escapeHtml(row.latest_modified_at || "尚未校核")}</td><td><a class="admin-btn" href="./index.html?space=${encodeURIComponent(currentContext.spaceId)}&layer=${encodeURIComponent(row.layer_key)}&object=${encodeURIComponent(row.object_code)}">地图定位</a> <button class="admin-btn" type="button" data-survey-history-for="${escapeHtml(`${row.layer_key}:${row.object_code}`)}">查看历史</button></td>
          </tr>`).join("") : '<tr><td colspan="6" class="admin-empty">没有符合条件的对象。</td></tr>';
          return { dashboard, rows };
        };
        if (panelRoot && !listenersBound) {
          listenersBound = true;
          panelRoot.querySelector("[data-survey-freeze-form]")?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            try {
              await this.freezeSnapshot({
                ...currentContext,
                versionName: form.elements.versionName?.value,
                description: form.elements.description?.value,
                recommendedForGroups: form.elements.recommended?.checked
              });
              form.reset();
              await refresh();
            } catch (error) { notify?.(error.message || "冻结失败", "error"); }
          });
          panelRoot.addEventListener("click", async (event) => {
            try {
              if (event.target.closest?.("[data-survey-refresh]")) await refresh();
              const historyButton = event.target.closest?.("[data-survey-history-for]");
              if (historyButton) {
                const [layerKey, objectCode] = historyButton.dataset.surveyHistoryFor.split(":");
                const rows = await this.loadHistory({ ...currentContext, layerKey, objectCode });
                const history = panelRoot.querySelector("[data-survey-history]");
                if (history) history.innerHTML = `<div class="survey-admin-history"><h3>${escapeHtml(layerKey)} · ${escapeHtml(objectCode)} 的历史</h3>${rows.length ? rows.map((row) => `<div><span>${escapeHtml(row.created_at || "")}</span><strong>${escapeHtml(row.action)}</strong><span>${escapeHtml(row.created_by || "")}</span></div>`).join("") : "暂无历史记录"}</div>`;
              }
            } catch (error) { notify?.(error.message || "校核数据加载失败", "error"); }
          });
        }
        return refresh();
      }
    };
  }

  return {
    normalizeSurveyDashboard, buildSurveyFeatureFilters, resolveFormalSharedContext,
    assertPhotoDeletable, createSurveyAdminController
  };
});
