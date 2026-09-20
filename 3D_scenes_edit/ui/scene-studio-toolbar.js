(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneStudioToolbarModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function renderToolbarHtml(model) {
    if (model?.mode !== "3d") return "";
    const tool = (id, label) => `<button type="button" data-action="tool" data-value="${id}" aria-pressed="${model.activeTool === id}">${label}</button>`;
    const editingBoundary = model.activeTool === "edit-boundary";
    const selectionActions = (model?.selectedIds || []).length ? `
      <span class="scene-studio-tool-divider" aria-hidden="true"></span>
      <div class="scene-studio-tool-group" aria-label="选中对象操作">
        <button type="button" data-action="duplicate">复制</button>
        <button type="button" data-action="delete" class="is-danger">删除</button>
      </div>` : "";
    const guide = model?.interactionStatus || (model?.phase === "drawing-boundary"
      ? "单击添加边界点，右键或双击完成，Esc 取消"
      : "从右侧素材库选择组件，再在场景中单击放置");
    return `<div class="scene-studio-contextual-tools" aria-label="三维场景设计工具">
      <nav class="scene-studio-tool-strip">
        <div class="scene-studio-tool-group" aria-label="主要工具">
          ${model.hasBoundary ? tool("edit-boundary", "调整范围") : tool("draw-boundary", "划定范围")}${tool("select", "选择")}${tool("move", "移动")}
        </div>
        ${editingBoundary ? `<span class="scene-studio-tool-divider" aria-hidden="true"></span><div class="scene-studio-tool-group" aria-label="范围调整操作"><button type="button" data-action="finish-boundary-edit">完成调整</button><button type="button" data-action="delete-boundary-vertex" class="is-danger">删除选中点</button><button type="button" data-action="cancel-boundary-edit">取消调整</button></div>` : selectionActions}
      </nav>
      <div class="scene-studio-canvas-guide" role="status"><strong>${model?.phase === "drawing-boundary" ? "划定设计范围" : "场景操作"}</strong><span>${escapeHtml(guide)}</span></div>
    </div>`;
  }

  function createSceneStudioToolbar(options) {
    const root = options.root;
    const onAction = options.onAction || function () {};
    function onClick(event) {
      const control = event.target?.closest?.("[data-action]");
      if (control?.dataset?.action) onAction({ type: control.dataset.action, value: control.dataset.value || "" });
    }
    root.setAttribute?.("role", "toolbar");
    root.addEventListener("click", onClick);
    return {
      render(model) { root.innerHTML = renderToolbarHtml(model); },
      focus() { root.focus?.(); },
      dispose() { root.removeEventListener("click", onClick); root.innerHTML = ""; }
    };
  }

  return { renderToolbarHtml, createSceneStudioToolbar };
});
