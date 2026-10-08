(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GroupPlanAdminModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function clean(value) { return String(value ?? "").trim(); }
  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
  function attr(value) { return escapeHtml(value); }

  function buildAdminGroupPlanUrl({ projectId, villageId, groupId, spaceId } = {}) {
    const params = new URLSearchParams({
      adminGroupPlan: "1", project: clean(projectId), village: clean(villageId),
      group: clean(groupId), space: clean(spaceId)
    });
    return `./index.html?${params.toString()}`;
  }

  function resolveGroupPlanAdminContext(state = {}) {
    const project = state.project || state.context?.project;
    const villageId = clean(project?.formalVillageId || project?.formal_village_id);
    if (!clean(project?.id) || !villageId) return null;
    const villages = state.villages || state.context?.villages || [];
    const village = villages.find((item) => clean(item.id) === villageId);
    return {
      teachingProjectId: clean(project.id), villageId,
      projectName: clean(project.name), villageName: clean(village?.name)
    };
  }

  function renderGroupRows(rows = []) {
    if (!rows.length) return '<tr><td colspan="7" class="admin-empty">当前课程还没有小组。</td></tr>';
    return rows.map((row) => {
      const groupId = attr(row.group_id);
      const spaceId = attr(row.space_id);
      const latestId = attr(row.latest_snapshot_id);
      const baseId = attr(row.base_snapshot_id);
      const restoreId = attr(row.latest_restore_point_id);
      const conflicts = Number(row.unresolved_conflicts || 0);
      const base = escapeHtml(row.base_version_name || "等待冻结版本");
      const latest = escapeHtml(row.latest_version_name || "暂无推荐版本");
      const lifecycle = spaceId ? "方案空间已建立" : "待补建空间";
      return `<tr>
        <td><strong>${escapeHtml(row.group_name || row.group_id)}</strong><small class="group-plan-row-meta">${Number(row.member_count || 0)} 人</small></td>
        <td><span class="group-plan-state ${spaceId ? "is-ready" : "is-waiting"}">${lifecycle}</span></td>
        <td>${base}</td><td>${latest}</td>
        <td>${conflicts ? `<span class="group-plan-conflict-count">${conflicts} 个冲突</span>` : "无待处理冲突"}</td>
        <td>${escapeHtml(row.last_edited_at || row.latest_update_status || "尚未编辑")}</td>
        <td><div class="group-plan-actions">
          ${spaceId
            ? `<button class="admin-btn" type="button" data-enter-group-plan="${spaceId}" data-group-id="${groupId}">进入方案</button>
              ${latestId && latestId !== baseId ? `<button class="admin-btn" type="button" data-update-group-plan="${spaceId}" data-group-id="${groupId}" data-target-snapshot="${latestId}" data-base-snapshot="${baseId}">代更新</button>` : ""}
              ${conflicts ? `<button class="admin-btn" type="button" data-view-group-conflicts="${spaceId}" data-group-id="${groupId}">查看冲突</button>` : ""}
              ${restoreId ? `<button class="admin-btn" type="button" data-restore-group-plan="${restoreId}">恢复版本</button>` : ""}`
            : `<button class="admin-btn admin-btn-primary" type="button" data-ensure-group-plan="${groupId}" data-target-snapshot="${latestId}">补建空间</button>`}
        </div></td>
      </tr>`;
    }).join("");
  }

  function createGroupPlanAdminController({ root: panelRoot, supabaseClient, notify, confirm, navigate } = {}) {
    if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");
    const tell = typeof notify === "function" ? notify : () => {};
    const ask = typeof confirm === "function" ? confirm : async () => true;
    const go = typeof navigate === "function" ? navigate : (url) => { window.location.href = url; };
    let context = null;
    let rows = [];
    let bound = false;

    async function rpc(name, args) {
      const response = await supabaseClient.rpc(name, args);
      if (response?.error) throw response.error;
      return response?.data;
    }
    function requireContext(input = context || {}) {
      if (!input.teachingProjectId || !input.villageId) throw new Error("GROUP_PLAN_ADMIN_CONTEXT_REQUIRED");
      return input;
    }
    async function loadDashboard(input = context) {
      const current = requireContext(input);
      const data = await rpc("get_group_plan_admin_dashboard", {
        p_teaching_project_id: current.teachingProjectId,
        p_village_id: current.villageId
      });
      rows = Array.isArray(data) ? data : [];
      return rows;
    }
    async function ensureSpace(input = {}) {
      const current = requireContext(input);
      return rpc("ensure_group_plan_space", {
        p_teaching_project_id: current.teachingProjectId,
        p_village_id: current.villageId,
        p_group_id: clean(input.groupId),
        p_snapshot_id: clean(input.snapshotId) || null
      });
    }
    async function updateBaseline(input = {}) {
      const current = requireContext(input);
      return rpc("apply_group_baseline_update", {
        p_teaching_project_id: current.teachingProjectId,
        p_village_id: current.villageId,
        p_space_id: clean(input.spaceId),
        p_target_snapshot_id: clean(input.targetSnapshotId),
        p_expected_base_snapshot_id: clean(input.expectedBaseSnapshotId)
      });
    }
    async function restore(input = {}) {
      return rpc("restore_group_plan_restore_point", { p_restore_point_id: clean(input.restorePointId) });
    }
    function paint() {
      if (!panelRoot) return;
      const unresolved = rows.reduce((sum, row) => sum + Number(row.unresolved_conflicts || 0), 0);
      panelRoot.innerHTML = `<div class="group-plan-admin-context">
        <div><span>教学项目</span><strong>${escapeHtml(context.projectName || context.teachingProjectId)}</strong></div>
        <div><span>正式村庄</span><strong>${escapeHtml(context.villageName || context.villageId)}</strong></div>
        <div><span>小组方案</span><strong>${rows.length} 组 · ${unresolved} 个待处理冲突</strong></div>
      </div><div class="admin-table-wrap"><table class="admin-table group-plan-table"><thead><tr>
        <th>小组</th><th>空间状态</th><th>当前基线</th><th>最新冻结</th><th>冲突</th><th>最近活动</th><th>操作</th>
      </tr></thead><tbody>${renderGroupRows(rows)}</tbody></table></div>`;
    }
    async function refresh() { await loadDashboard(context); paint(); return rows; }
    async function mount(input) {
      context = requireContext(input);
      if (panelRoot && !bound) {
        bound = true;
        panelRoot.addEventListener("click", async (event) => {
          const target = event.target.closest?.("button");
          if (!target) return;
          try {
            if (target.dataset.ensureGroupPlan) {
              await ensureSpace({ ...context, groupId: target.dataset.ensureGroupPlan, snapshotId: target.dataset.targetSnapshot });
              tell("小组方案空间已补建", "success");
              await refresh();
            } else if (target.dataset.enterGroupPlan) {
              go(buildAdminGroupPlanUrl({ projectId: context.teachingProjectId, villageId: context.villageId, groupId: target.dataset.groupId, spaceId: target.dataset.enterGroupPlan }));
            } else if (target.dataset.viewGroupConflicts) {
              go(`${buildAdminGroupPlanUrl({ projectId: context.teachingProjectId, villageId: context.villageId, groupId: target.dataset.groupId, spaceId: target.dataset.viewGroupConflicts })}&conflicts=1`);
            } else if (target.dataset.updateGroupPlan) {
              if (await ask("确认代小组更新方案底图？组内修改会保留，冲突可稍后处理。")) {
                await updateBaseline({ ...context, spaceId: target.dataset.updateGroupPlan, targetSnapshotId: target.dataset.targetSnapshot, expectedBaseSnapshotId: target.dataset.baseSnapshot });
                tell("小组方案基线已更新", "success");
                await refresh();
              }
            } else if (target.dataset.restoreGroupPlan) {
              if (await ask("确认恢复到该更新前状态？当前方案会生成新的恢复记录。")) {
                await restore({ restorePointId: target.dataset.restoreGroupPlan });
                tell("小组方案已恢复", "success");
                await refresh();
              }
            }
          } catch (error) { tell(error?.message || "小组方案操作失败", "error"); }
        });
      }
      return refresh();
    }
    return { loadDashboard, ensureSpace, updateBaseline, restore, mount, refresh };
  }

  return { renderGroupRows, buildAdminGroupPlanUrl, resolveGroupPlanAdminContext, createGroupPlanAdminController };
});
