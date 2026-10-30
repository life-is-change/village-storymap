(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneStudioToolbarModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function renderToolbarHtml(model) {
    const active=model?.activeTool||'select',count=model?.selectedIds?.length||0,object=model?.properties;
    const button=(action,label,value='')=>`<button type="button" data-action="${action}"${value?` data-value="${value}"`:''} ${model?.readOnly&&action!=='cancel'?'disabled':''}>${label}</button>`;
    const name=escapeHtml(model?.activeAssetLabel||({'draw-line':'道路／步道','draw-surface':'场地','draw-rectangle':'矩形场地','draw-boundary':'局部设计范围'})[active]||'组件');
    let actions='',title='',guide='';
    if(['draw-line','draw-surface','draw-rectangle','draw-boundary'].includes(active)){
      title='正在绘制：'+name;actions=button('finish-drawing','完成绘制')+button('cancel','放弃本次绘制');
      guide='地图点选节点 → 完成绘制；放弃只丢弃本次草稿。';
    }else if(active==='edit-boundary'){
      title='调整旧版放置范围';actions=button('finish-boundary-edit','完成调整')+button('delete-boundary-vertex','删除选中点')+button('cancel-boundary-edit','放弃调整');guide='拖动编号点；点击边线可加点。旧蓝框与活动场地、村庄模拟范围分别保存。';
    }else if(active==='place-asset'){
      title='连续放置：'+name;actions=button('cancel','结束放置');guide='点击地图连续放置；结束后已放置对象保留。';
    }else if(['move','edit-nodes','edit-road-nodes','measure'].includes(active)){
      title=({'move':'整体移动','edit-nodes':'编辑顶点','edit-road-nodes':'编辑道路顶点',measure:'测量距离'})[active];actions=button('cancel','结束编辑');
      if(active==='edit-road-nodes')actions=button('delete-road-vertex','删除选中顶点')+actions;
      guide=active==='edit-road-nodes'?'拖动黄色编号顶点；点击蓝色中点加点。松开保存，至少保留两个顶点。':active==='edit-nodes'?'拖动所选道路或场地的顶点；线段中部可插点。宽度在右侧设置。':active==='move'?'拖动所选道路或组件整体移动；松开保存，可用撤销退回。':'点击地图测量距离。';
    }else{
      title=count?'已选 '+count+' 个对象':'选择与编辑';
      actions=button('tool','选择对象','select');
      if(count){
        const shape=['line','surface','boundary'].includes(object?.kind);
        const road=object?.kind==='line'&&object.category==='path';
        actions+=road?button('edit-road','编辑顶点')+button('tool','整体移动','move'):(model.mode==='2d'||!shape)?button('tool','拖动位置','move'):button('move-shape','平移（2D）')+button('edit-shape','调整形状（2D）');
        if(count===1)actions+=button('rotate-geometry','旋转90°','90');
        actions+=button('inspect-properties','修改属性')+(object?.kind==='boundary'?'':button('duplicate','复制'))+button('delete',object?.kind==='boundary'?'清除旧蓝框':'删除');
      }
      if(count&&model.mode==='2d'&&['line','surface','boundary'].includes(object?.kind)&&object?.category!=='path')actions+=button('tool','编辑节点','edit-nodes');
      if(model.mode==='2d')actions+='<details class="scene-map-options"><summary>辅助工具</summary>'+button('tool','框选对象','box-select')+button('tool','测量距离','measure')+button('tool','平移视图','pan')+'</details>';
      guide=count?'右侧调整所选对象的参数；范围与组件独立编辑。':'从左侧依次设定范围、规划道路、放置组件，或点击已有对象编辑。';
    }
    return `<div class="scene-studio-contextual-tools" aria-label="当前场景操作"><nav class="scene-studio-tool-strip"><strong>${title}</strong><div class="scene-studio-tool-group">${actions}</div></nav><div class="scene-studio-canvas-guide" role="status"><span data-operation-guide>${escapeHtml(guide)}</span><small data-scene-status>${escapeHtml(model?.interactionStatus||"")}</small></div></div>`;
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
