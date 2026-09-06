(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GroupBaselinePanelModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function total(change = {}) {
    return ["added", "updated", "deleted"]
      .reduce((sum, key) => sum + (Number(change?.[key]) || 0), 0);
  }

  function renderConflict(conflict) {
    const layer = escapeHtml(conflict.layer_key || conflict.layerKey);
    const object = escapeHtml(conflict.object_code || conflict.objectCode);
    return `<button type="button" class="group-baseline-conflict" data-locate-layer="${layer}" data-locate-object="${object}">
      <span>${layer || "对象"} · ${object || "未编号"}</span><small>定位处理</small>
    </button>`;
  }

  function renderGroupBaselinePanel(state = {}) {
    if (state.status === "loading") return '<div class="group-baseline-empty">正在读取方案基线…</div>';
    if (state.status === "no-group") return '<div class="group-baseline-empty">请先加入小组，再进入本小组方案空间。</div>';
    if (state.status === "no-baseline") return '<div class="group-baseline-empty">等待管理员冻结现状版本后，小组方案将自动建立。</div>';
    if (state.status === "error") return `<div class="group-baseline-empty is-error">${escapeHtml(state.message || "方案基线读取失败")}</div>`;

    const current = state.current || {};
    const latest = state.latest || current;
    const preview = state.preview || {};
    const canUpdate = Boolean(current.id && latest.id && current.id !== latest.id);
    const conflicts = Array.isArray(state.conflicts) ? state.conflicts : [];
    return `
      <div class="group-baseline-summary">
        <div><span>当前基线</span><strong>${escapeHtml(current.version_name || current.versionName || "未命名版本")}</strong></div>
        <div><span>${canUpdate ? "可更新至" : "最新版本"}</span><strong>${escapeHtml(latest.version_name || latest.versionName || "—")}</strong></div>
      </div>
      ${canUpdate ? `<div class="group-baseline-counts">
        <span>基线变化 ${total(preview.baseline)} 个</span>
        <span>组内覆盖 ${total(preview.group)} 个</span>
        <span class="is-warning">预计冲突 ${Number(preview.potential_conflicts) || 0} 个</span>
      </div>
      <button type="button" class="group-baseline-update-btn" data-group-baseline-update>更新小组底图</button>`
        : '<p class="group-baseline-current">当前已使用最新冻结版本。</p>'}
      ${conflicts.length ? `<div class="group-baseline-conflicts"><strong>${conflicts.length} 个待处理冲突</strong>${conflicts.map(renderConflict).join("")}</div>` : ""}
    `;
  }

  function createGroupBaselinePanel({ root, client, confirm, notify, onReload, onLocate } = {}) {
    if (!root) throw new Error("GROUP_BASELINE_ROOT_REQUIRED");
    if (!client) throw new Error("GROUP_BASELINE_CLIENT_REQUIRED");
    const ask = typeof confirm === "function" ? confirm : async () => true;
    const tell = typeof notify === "function" ? notify : () => {};
    let state = { status: "loading" };

    function paint() {
      root.innerHTML = renderGroupBaselinePanel(state);
    }

    async function refresh() {
      state = { status: "loading" };
      paint();
      try {
        const facts = await client.getState();
        if (!facts?.space) state = { status: "no-group" };
        else if (!facts.current) state = { status: "no-baseline" };
        else {
          const canUpdate = facts.latest?.id && facts.latest.id !== facts.current.id;
          const [preview, conflicts] = await Promise.all([
            canUpdate ? client.previewUpdate({ targetSnapshotId: facts.latest.id }) : Promise.resolve(null),
            client.listConflicts()
          ]);
          state = { status: "ready", ...facts, preview, conflicts };
        }
      } catch (error) {
        state = { status: "error", message: error?.message };
      }
      paint();
      return state;
    }

    async function applyLatest() {
      if (!state.current?.id || !state.latest?.id || state.current.id === state.latest.id) return false;
      const approved = await ask(`确认将小组方案底图从 ${state.current.version_name || "当前版本"} 更新到 ${state.latest.version_name || "新版本"}？组内已修改内容会保留，冲突可稍后处理。`);
      if (!approved) return false;
      try {
        await client.applyUpdate({
          targetSnapshotId: state.latest.id,
          expectedBaseSnapshotId: state.current.id
        });
        await onReload?.();
        await refresh();
        tell("小组方案底图已更新");
        return true;
      } catch (error) {
        if (error?.code === "GROUP_SPACE_BUSY") {
          tell("当前有成员正在编辑，请保存或结束编辑后再更新。");
          return false;
        }
        if (error?.code === "BASELINE_VERSION_CONFLICT") {
          tell("基线已变化，已为你刷新最新状态，请重新确认。");
          await refresh();
          return false;
        }
        tell(error?.message || "小组方案底图更新失败");
        return false;
      }
    }

    root.addEventListener?.("click", (event) => {
      const update = event.target?.closest?.("[data-group-baseline-update]");
      if (update) void applyLatest();
      const locate = event.target?.closest?.("[data-locate-layer][data-locate-object]");
      if (locate) onLocate?.({ layerKey: locate.dataset.locateLayer, objectCode: locate.dataset.locateObject });
    });

    paint();
    return { refresh, applyLatest, getState: () => state };
  }

  return { createGroupBaselinePanel, renderGroupBaselinePanel };
});
