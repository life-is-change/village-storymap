(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./scene-studio-toolbar") : root.SceneStudioToolbarModule);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneStudioPanelModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Toolbar) {
  const TOOL_LABELS = Object.freeze({
    select: "选择", "box-select": "框选", "draw-surface": "绘制区域", "draw-rectangle": "绘制矩形",
    "draw-line": "绘制路径", "place-asset": "放置素材", move: "移动", rotate: "旋转", scale: "缩放",
    measure: "测量", pan: "平移视图", "edit-nodes": "编辑节点", "edit-boundary": "调整范围"
  });
  const PHASE_MESSAGES = Object.freeze({
    "no-project": ["info", "尚未创建方案，请创建或载入小组方案。"],
    "drawing-boundary": ["info", "请在地图上绘制设计范围，系统会检查边界、面积与建筑碰撞。"],
    "boundary-error": ["error", "设计范围需要修正后才能继续。"],
    editing: ["success", "正在编辑；二维与三维共用同一份方案。"],
    offline: ["warning", "已保存到本机；网络恢复后会继续同步。"],
    conflict: ["warning", "发现两个版本，请选择保留本地、载入远端或另存方案。"],
    readonly: ["info", "只读查看；不会改变学生方案。"]
  });
  const REVIEW_TOOL_IDS = new Set(["select", "box-select", "move", "rotate", "scale", "measure", "pan"]);
  const CATEGORY_LABELS = Object.freeze({
    bench: "座椅", table: "桌椅", paving: "铺装", grass: "草坪", water: "水景",
    planter: "花坛", planting: "种植", "activity-field": "活动场地", path: "道路",
    tree: "乔木", shrub: "灌木", light: "照明", structure: "构筑物",
    curb: "路缘", "low-wall": "矮墙", fence: "栅栏", hedge: "绿篱", drainage: "排水",
    bin: "环卫", sign: "标识", sculpture: "景观小品", fitness: "健身设施", pavilion: "亭",
    pergola: "廊架", "bus-stop": "候车亭", stall: "摊位", stage: "舞台", "play-equipment": "儿童设施",
    other: "其他"
  });
  const ASSET_GROUPS = Object.freeze({
    site: { label: "场地地面", categories: ["paving", "grass", "water", "planter", "planting", "activity-field"] },
    planting: { label: "绿化", categories: ["tree", "shrub", "hedge"] },
    furniture: { label: "家具设施", categories: ["bench", "table", "light", "bin", "sign", "sculpture", "fitness", "play-equipment"] },
    structure: { label: "构筑物", categories: ["pavilion", "pergola", "bus-stop", "stall", "stage", "structure"] },
    boundary: { label: "边界交通", categories: ["path", "curb", "low-wall", "fence", "drainage"] }
  });

  function groupAssets(assets) {
    const grouped = {};
    for (const asset of assets || []) {
      const category = asset.category || "other";
      (grouped[category] ||= []).push(asset);
    }
    return grouped;
  }

  function buildViewModel(state) {
    const phase = state?.phase || "no-project";
    const [level, message] = PHASE_MESSAGES[phase] || PHASE_MESSAGES.editing;
    const objects = state?.objects || [];
    const selected = state?.selectedObject || objects.find((object) => (state?.selectedIds || []).includes(object.id)) || null;
    return {
      phase,
      title: state?.title || "公共空间设计",
      mode: state?.mode || "2d",
      activeTool: state?.activeTool || "select",
      hasBoundary: !!state?.selectionBoundary,
      readOnly: phase === "readonly",
      banner: { level, message },
      save: {
        status: state?.saveStatus || "clean",
        label: { clean: "未修改", dirty: "待保存", saving: "正在保存…", saved: "已保存", offline: "本机草稿", conflict: "版本冲突" }[state?.saveStatus || "clean"] || "未修改",
        revision: state?.revision ?? null,
        updatedAt: state?.updatedAt || null
      },
      tools: Object.entries(TOOL_LABELS).map(([id, label]) => ({ id, label, active: id === state?.activeTool, disabled: phase === "readonly" })),
      sections: { layers: state?.layers || [], objects, assets: groupAssets(state?.assets || []) },
      selectedIds: state?.selectedIds || [],
      properties: selected,
      canUndo: !!state?.canUndo,
      canRedo: !!state?.canRedo,
      actions: [
        { id: "undo", label: "撤销", disabled: !state?.canUndo },
        { id: "redo", label: "重做", disabled: !state?.canRedo },
        { id: "milestone", label: "创建里程碑", disabled: phase !== "editing" }
      ],
      conflict: state?.conflict || null,
      versions: state?.versions || [],
      comparisonIds: state?.comparisonIds || [],
      interactionStatus: state?.interactionStatus || ""
    };
  }

  function shortcutForEvent(event) {
    const tagName = String(event?.target?.tagName || "").toUpperCase();
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tagName) || event?.target?.isContentEditable) return null;
    const key = String(event?.key || "").toLowerCase();
    const command = !!(event?.ctrlKey || event?.metaKey);
    if (command && key === "z" && event?.shiftKey) return "redo";
    if (command && key === "z") return "undo";
    if (command && key === "c") return "copy";
    if (command && key === "d") return "duplicate";
    if (key === "delete" || key === "backspace") return "delete";
    if (key === "escape") return "cancel";
    if (key === "g") return "group";
    return null;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function icon(name) {
    const paths = {
      eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
      "eye-off": '<path d="m3 3 18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-2.1 2.8M6.5 6.5C3.5 8.3 2 12 2 12s3.5 6 10 6c1.3 0 2.5-.2 3.5-.6"/>',
      lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M16 10V7a4 4 0 0 0-7.5-2"/>',
      up: '<path d="m7 11 5-5 5 5M12 6v12"/>',
      down: '<path d="m7 13 5 5 5-5M12 18V6"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
  }

  function renderLayers(layers) {
    if (!layers.length) return '<p class="scene-studio-empty">暂无方案图层</p>';
    return layers.map((layer) => {
      const isDefault = layer.id === "design";
      const nameControl = isDefault
        ? `<span class="scene-studio-layer-name" title="默认承载未分类对象；删除其他图层时，其中对象会转移到这里">${escapeHtml(layer.name || "方案要素")}<small class="scene-layer-badge">默认图层</small></span>`
        : `<input class="scene-studio-layer-name-input" type="text" maxlength="40" data-action="layer-rename" data-value="${escapeHtml(layer.id)}" value="${escapeHtml(layer.name || layer.id)}" aria-label="重命名 ${escapeHtml(layer.name || layer.id)}" title="输入名称后按回车或移开焦点保存">`;
      return `
      <div class="scene-studio-row" data-layer-id="${escapeHtml(layer.id)}">
        ${nameControl}
        <span class="scene-studio-layer-actions">
          <button class="scene-icon-button" type="button" data-action="layer-visible" data-value="${escapeHtml(layer.id)}" aria-pressed="${layer.visible !== false}" aria-label="${layer.visible === false ? "显示" : "隐藏"} ${escapeHtml(layer.name || layer.id)}" title="${layer.visible === false ? "显示" : "隐藏"}">${icon(layer.visible === false ? "eye-off" : "eye")}</button>
          <button class="scene-icon-button" type="button" data-action="layer-lock" data-value="${escapeHtml(layer.id)}" aria-pressed="${!!layer.locked}" aria-label="${layer.locked ? "解锁" : "锁定"} ${escapeHtml(layer.name || layer.id)}" title="${layer.locked ? "解锁" : "锁定"}">${icon(layer.locked ? "lock" : "unlock")}</button>
          <button class="scene-icon-button" type="button" data-action="layer-move" data-value="${escapeHtml(layer.id)}|up" aria-label="上移 ${escapeHtml(layer.name || layer.id)}" title="上移">${icon("up")}</button>
          <button class="scene-icon-button" type="button" data-action="layer-move" data-value="${escapeHtml(layer.id)}|down" aria-label="下移 ${escapeHtml(layer.name || layer.id)}" title="下移">${icon("down")}</button>
          ${isDefault ? "" : `<button class="scene-icon-button is-danger" type="button" data-action="layer-delete" data-value="${escapeHtml(layer.id)}" aria-label="删除 ${escapeHtml(layer.name || layer.id)}" title="删除图层；其中对象将移至方案要素">${icon("trash")}</button>`}
        </span>
      </div>`;
    }).join("");
  }

  function renderObjects(objects, selectedIds) {
    if (!objects.length) return '<p class="scene-studio-empty">尚未放置对象</p>';
    const selected = new Set(selectedIds);
    return objects.map((object) => `<button type="button" class="scene-object-row${selected.has(object.id) ? " is-selected" : ""}" data-action="select-object" data-value="${escapeHtml(object.id)}">${escapeHtml(object.properties?.displayName || object.category || object.id)}</button>`).join("");
  }

  function renderAssets(groups, activeCategory, query, activeGroup = "site") {
    const entries = Object.entries(groups);
    if (!entries.length) return '<p class="scene-studio-empty">正在载入素材…</p>';
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
    const groupDefinition = ASSET_GROUPS[activeGroup] || ASSET_GROUPS.site;
    const availableCategories = entries.map(([category]) => category).filter((category) => groupDefinition.categories.includes(category));
    const groupButtons = Object.entries(ASSET_GROUPS).map(([id, definition]) => `<button type="button" data-action="asset-group" data-value="${id}" aria-pressed="${activeGroup === id}">${definition.label}</button>`).join("");
    const categories = [`<button type="button" data-action="asset-category" data-value="all" aria-pressed="${activeCategory === "all"}">全部</button>`]
      .concat(availableCategories.map((category) => `<button type="button" data-action="asset-category" data-value="${escapeHtml(category)}" aria-pressed="${activeCategory === category}">${escapeHtml(CATEGORY_LABELS[category] || category)}</button>`));
    const assets = entries
      .filter(([category]) => groupDefinition.categories.includes(category) && (activeCategory === "all" || activeCategory === category))
      .flatMap(([, items]) => items)
      .filter((asset) => !normalizedQuery || String(asset.label || asset.displayName || asset.id).toLocaleLowerCase().includes(normalizedQuery));
    const cards = assets.map((asset) => `<button class="scene-asset-card" type="button" data-action="choose-asset" data-value="${escapeHtml(asset.id)}"><span class="scene-asset-thumb" aria-hidden="true">${escapeHtml((asset.label || asset.displayName || "组件").slice(0, 1))}</span><span><strong>${escapeHtml(asset.label || asset.displayName || asset.id)}</strong><small>${escapeHtml(CATEGORY_LABELS[asset.category] || asset.category || "组件")}</small></span></button>`).join("");
    return `<div class="scene-asset-groups" role="tablist" aria-label="素材分组">${groupButtons}</div><div class="scene-asset-filters" role="toolbar" aria-label="素材分类">${categories.join("")}</div><div class="scene-asset-grid">${cards || '<p class="scene-studio-empty">没有符合条件的素材</p>'}</div>`;
  }

  function renderProperties(object, mode) {
    if (!object) return '<p class="scene-studio-empty">选择对象后编辑属性</p>';
    const transform = object.transform || {};
    const properties = object.properties || {};
    return `
      <dl><dt>对象</dt><dd>${escapeHtml(properties.displayName || object.category || object.id)}</dd><dt>类型</dt><dd>${escapeHtml(object.kind)}</dd></dl>
      <label>朝向（°）<input type="number" data-action="property" data-path="transform.headingDeg" value="${Number(transform.headingDeg) || 0}"></label>
      <label>高度偏移（m）<input type="number" step="0.1" data-action="property" data-path="transform.heightOffsetM" value="${Number(transform.heightOffsetM) || 0}"></label>
      <label>水平缩放<input type="number" step="0.1" min="0.01" data-action="property" data-path="transform.scaleXY" value="${Number(transform.scale?.[0]) || 1}"></label>
      ${mode === "3d" && (object.kind === "asset" || object.kind === "structure") ? `
      <label>Z 轴缩放<input type="number" step="0.1" min="0.01" data-action="property" data-path="transform.scaleZ" value="${Number(transform.scale?.[2]) || 1}"></label>
      <label>俯仰（°）<input type="number" data-action="property" data-path="transform.pitchDeg" value="${Number(transform.pitchDeg) || 0}"></label>
      <label>翻滚（°）<input type="number" data-action="property" data-path="transform.rollDeg" value="${Number(transform.rollDeg) || 0}"></label>
      <label>材质标识<input type="text" data-action="property" data-value-type="string" data-path="properties.materialRef" value="${escapeHtml(properties.materialRef || "")}"></label>` : ""}
      ${object.kind === "line" ? `<label>宽度（m）<input type="number" step="0.1" min="0.05" data-action="property" data-path="properties.widthM" value="${Number(properties.widthM) || 1}"></label>` : ""}
      ${object.kind === "surface" ? `<label>拉伸高度（m）<input type="number" step="0.05" data-action="property" data-path="properties.extrusionHeightM" value="${Number(properties.extrusionHeightM) || 0}"></label>` : ""}`;
  }

  function renderVersions(versions, comparisonIds) {
    if (!versions.length) return '<p class="scene-studio-empty">尚未创建里程碑</p>';
    const compared = new Set(comparisonIds || []);
    return versions.map((version) => `<article class="scene-version-row${compared.has(version.id) ? " is-compared" : ""}">
      <strong>${escapeHtml(version.label)}</strong><small>R${Number(version.revision) || 0} · ${escapeHtml(version.author_name || version.authorName || "小组成员")} · ${escapeHtml(version.created_at || version.createdAt || "")}</small>
      <span>${version.submission_status === "submitted" || version.submissionStatus === "submitted" ? "已提交" : "里程碑"}</span>
      <div><button type="button" data-action="compare-version" data-value="${escapeHtml(version.id)}">${compared.has(version.id) ? "取消对比" : "在2D叠加对比"}</button><button type="button" data-action="restore-version" data-value="${escapeHtml(version.id)}">恢复为新草稿</button><button type="button" data-action="submit-version" data-value="${escapeHtml(version.id)}">提交此版本</button></div>
    </article>`).join("");
  }

  function createSceneStudioPanel(options) {
    const root = options.root;
    const onAction = options.onAction || function () {};
    root.setAttribute("tabindex", "0");
    root.setAttribute("role", "application");
    root.setAttribute("aria-label", "公共空间设计工作室");
    let activeInspector = "assets";
    let inspectorCollapsed = false;
    let activeAssetCategory = "all";
    let activeAssetGroup = "site";
    let assetQuery = "";
    let lastModel = null;

    function actionFromTarget(target) {
      const control = target?.closest?.("[data-action]");
      if (!control?.dataset?.action) return null;
      return { type: control.dataset.action, value: control.dataset.value || "", path: control.dataset.path || "", source: control };
    }
    function updateAssetBrowser() {
      const browser = root.querySelector?.(".scene-asset-browser");
      if (!browser || !lastModel) return false;
      browser.innerHTML = renderAssets(lastModel.sections.assets, activeAssetCategory, assetQuery, activeAssetGroup);
      return true;
    }
    function onClick(event) {
      const action = actionFromTarget(event.target);
      if (!action) return;
      if (action.type === "panel-tab") {
        activeInspector = ["assets", "properties", "versions"].includes(action.value) ? action.value : "assets";
        inspectorCollapsed = false;
        if (activeInspector === "properties") {
          onAction({ type: "inspect-properties", value: "", path: "", source: action.source });
          if (lastModel) lastModel = { ...lastModel, activeTool: "select", tools: lastModel.tools.map((tool) => ({ ...tool, active: tool.id === "select" })) };
        }
        if (lastModel) renderPanel(lastModel);
        return;
      }
      if (action.type === "toggle-inspector") {
        inspectorCollapsed = !inspectorCollapsed;
        if (lastModel) renderPanel(lastModel);
        return;
      }
      if (action.type === "asset-category") {
        activeAssetCategory = action.value || "all";
        if (!updateAssetBrowser() && lastModel) renderPanel(lastModel);
        return;
      }
      if (action.type === "asset-group") {
        activeAssetGroup = ASSET_GROUPS[action.value] ? action.value : "site";
        activeAssetCategory = "all";
        if (!updateAssetBrowser() && lastModel) renderPanel(lastModel);
        return;
      }
      onAction(action);
    }
    function onInput(event) {
      const action = actionFromTarget(event.target);
      if (action?.type === "asset-search") {
        assetQuery = event.target.value || "";
        if (!updateAssetBrowser() && lastModel) renderPanel(lastModel);
        return;
      }
      if (action?.type === "property") onAction({ ...action, value: event.target.dataset?.valueType === "string" ? event.target.value : Number(event.target.value) });
    }
    function onChange(event) {
      const action = actionFromTarget(event.target);
      if (action?.type === "layer-rename") onAction({ ...action, name: event.target.value || "" });
    }
    function onKeydown(event) {
      const type = shortcutForEvent(event);
      if (!type) return;
      event.preventDefault?.();
      onAction({ type, source: event.target });
    }
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    root.addEventListener("keydown", onKeydown);

    function renderPanel(model) {
        lastModel = model;
        root.innerHTML = `
          <div class="scene-studio-shell" data-phase="${escapeHtml(model.phase)}" data-mode="${escapeHtml(model.mode)}" data-active-inspector="${escapeHtml(activeInspector)}" data-inspector-collapsed="${inspectorCollapsed}">
            <header class="scene-studio-header">
              <div class="scene-studio-title"><span>模块二 · 公共空间</span><h2>${escapeHtml(model.title)}</h2></div>
              <div class="scene-header-controls">
                <span class="scene-save-chip" data-status="${escapeHtml(model.save.status)}">${escapeHtml(model.save.label)}${model.save.revision !== null ? ` · R${escapeHtml(model.save.revision)}` : ""}</span>
                <div class="scene-studio-mode" aria-label="二维三维视图"><button type="button" data-action="mode" data-value="2d" aria-pressed="${model.mode === "2d"}">2D 校核</button><button type="button" data-action="mode" data-value="3d" aria-pressed="${model.mode === "3d"}">3D 设计</button></div>
                <button class="scene-header-action" type="button" data-action="toggle-inspector" aria-pressed="${!inspectorCollapsed}">${inspectorCollapsed ? "展开素材与属性" : "收起素材与属性"}</button>
                <button class="scene-header-action" type="button" data-action="milestone" ${model.phase === "editing" ? "" : "disabled"}>创建里程碑</button>
                <button class="scene-exit-button" type="button" data-action="close" aria-label="退出公共空间设计">← 退出设计</button>
              </div>
            </header>
            <div class="scene-studio-banner is-${escapeHtml(model.banner.level)}" role="status">${escapeHtml(model.banner.message)}${model.phase === "conflict" ? `<div class="scene-studio-conflict"><strong>远端版本 R${escapeHtml(model.conflict?.remoteRevision ?? "?")} 与本机草稿不同</strong><button type="button" data-action="conflict-local">保留本地副本</button><button type="button" data-action="conflict-remote">载入远端版本</button><button type="button" data-action="conflict-copy">另存为新方案</button></div>` : ""}</div>
            <nav class="scene-studio-tools" aria-label="场景编辑工具">${model.tools.filter((tool) => model.mode !== "2d" || REVIEW_TOOL_IDS.has(tool.id)).map((tool) => `<button type="button" data-action="tool" data-value="${escapeHtml(tool.id)}" aria-pressed="${tool.active}" ${tool.disabled ? "disabled" : ""}>${escapeHtml(tool.label)}</button>`).join("")}</nav>
            <aside class="scene-studio-left" aria-label="场景结构">
              <div class="scene-panel-heading"><span>场景结构</span><small>${model.sections.objects.length} 个对象</small></div>
              <section data-panel="layers"><h3><span>图层</span><button class="scene-icon-button" type="button" data-action="add-layer" aria-label="添加图层" title="添加图层">${icon("plus")}</button></h3>${renderLayers(model.sections.layers)}</section>
              <section data-panel="objects"><h3>对象</h3>${renderObjects(model.sections.objects, model.selectedIds)}</section>
            </aside>
            <main class="scene-studio-canvas" aria-label="场景地图编辑区">${Toolbar?.renderToolbarHtml?.(model) || ""}</main>
            <aside class="scene-studio-right" aria-label="设计资源与属性">
              <nav class="scene-inspector-tabs" aria-label="右侧面板">
                <button type="button" data-action="panel-tab" data-value="assets" aria-pressed="${activeInspector === "assets"}">素材库</button>
                <button type="button" data-action="panel-tab" data-value="properties" aria-pressed="${activeInspector === "properties"}">属性</button>
                <button type="button" data-action="panel-tab" data-value="versions" aria-pressed="${activeInspector === "versions"}">版本</button>
              </nav>
              <div class="scene-inspector-body">
                <section data-panel="assets" data-inspector-panel="assets" ${activeInspector === "assets" ? "" : "hidden"}><div class="scene-section-title"><div><h3>素材库</h3><p>组件、线和区域均直接在三维场景中绘制</p></div><button type="button" data-action="upload-asset">上传 GLB</button></div><label class="scene-asset-search"><span>搜索素材</span><input type="search" data-action="asset-search" value="${escapeHtml(assetQuery)}" placeholder="座椅、乔木、铺装…"></label><div class="scene-asset-browser">${renderAssets(model.sections.assets, activeAssetCategory, assetQuery, activeAssetGroup)}</div></section>
                <section data-panel="properties" data-inspector-panel="properties" ${activeInspector === "properties" ? "" : "hidden"}><h3>对象属性</h3><div class="scene-properties-content">${renderProperties(model.properties, model.mode)}</div></section>
                <section data-panel="versions" data-inspector-panel="versions" ${activeInspector === "versions" ? "" : "hidden"}><h3>方案版本</h3>${renderVersions(model.versions, model.comparisonIds)}</section>
              </div>
            </aside>
            <footer class="scene-studio-footer">
              <div class="scene-history-actions"><button type="button" data-action="undo" ${model.canUndo ? "" : "disabled"}>撤销</button><button type="button" data-action="redo" ${model.canRedo ? "" : "disabled"}>重做</button><button type="button" data-action="cancel">取消当前工具</button></div>
              <div class="scene-selection-actions" ${model.selectedIds.length ? "" : "hidden"}>${model.mode === "2d" ? '<button type="button" data-action="duplicate">复制</button><button type="button" data-action="delete" class="is-danger">删除</button>' : ""}<button type="button" data-action="group">成组</button><button type="button" data-action="align" data-value="left">左对齐</button><button type="button" data-action="distribute" data-value="horizontal">水平等距</button></div>
              <div class="scene-studio-save"><span data-scene-status>${escapeHtml(model.interactionStatus || model.banner.message)}</span></div>
            </footer>
          </div>`;
        options.onRendered?.(model, root);
    }

    return {
      render: renderPanel,
      updateStatus(message) {
        const node = root.querySelector?.("[data-scene-status]");
        if (node) node.textContent = String(message || "");
      },
      updateSaveState(save) {
        const node = root.querySelector?.(".scene-save-chip");
        if (!node) return;
        const status = save?.status || "clean";
        const label = { clean: "未修改", dirty: "待保存", saving: "正在保存…", saved: "已保存", offline: "本机草稿", conflict: "版本冲突" }[status] || "未修改";
        node.dataset.status = status;
        node.textContent = `${label}${save?.revision !== null && save?.revision !== undefined ? ` · R${save.revision}` : ""}`;
      },
      updateSelection(model) {
        lastModel = model || lastModel;
        const selected = new Set(lastModel?.selectedIds || []);
        for (const row of root.querySelectorAll?.(".scene-object-row") || []) {
          const isSelected = selected.has(row.dataset?.value);
          row.classList?.toggle?.("is-selected", isSelected);
          row.setAttribute?.("aria-pressed", String(isSelected));
        }
        const properties = root.querySelector?.(".scene-properties-content");
        if (properties) properties.innerHTML = renderProperties(lastModel?.properties, lastModel?.mode);
        const actions = root.querySelector?.(".scene-selection-actions");
        if (actions) actions.hidden = !selected.size;
      },
      updateActiveTool(tool) {
        for (const button of root.querySelectorAll?.('[data-action="tool"]') || []) {
          button.setAttribute?.("aria-pressed", String(button.dataset?.value === tool));
        }
      },
      focus() { root.focus(); },
      dispose() {
        root.removeEventListener("click", onClick);
        root.removeEventListener("input", onInput);
        root.removeEventListener("change", onChange);
        root.removeEventListener("keydown", onKeydown);
        root.innerHTML = "";
      }
    };
  }

  return { TOOL_LABELS, buildViewModel, shortcutForEvent, createSceneStudioPanel };
});
