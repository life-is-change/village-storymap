(function(root,factory){const c=typeof module==='object'&&module.exports,api=factory(c?require('./plan-adapter'):root.VillagePlanAdapter,c?require('./session'):root.VillagePlanSession,c?require('./overlay'):root.VillagePlanOverlay,c?require('../domain/scene'):root.VillageScene,c?require('../views/catalog'):root.VillageCatalog);if(c)module.exports=api;if(root)root.VillageSimulationWorkspace=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Adapter,Session,Overlay,Scene,Catalog){
 'use strict';const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const statusText=r=>r?.ok?'已保存到方案':r?.errors?.join('；')||({'REVISION_CONFLICT':'方案有版本冲突，请返回设计处理后重试',NETWORK_ERROR:'网络不可用，配置仅保留为本机草稿',CONTEXT_CHANGED:'空间已切换，请重新打开模拟'})[r?.code]||('未完成：'+(r?.code||'请检查配置'));
 function workflow(c,step){return '<nav class="village-sim-steps" aria-label="准备模拟的五个步骤">'+[['area','① 模拟范围'],['roads','② 路网与出入口'],['facilities','③ 设施功能'],['people','④ 人群情境'],['run','⑤ 检查与运行']].map(([id,label])=>'<button data-step="'+id+'" aria-pressed="'+(step===id)+'">'+label+(id==='area'&&c.area?' ✓':'')+'</button>').join('')+'</nav>';}
 function palette(category,chosen,c){const group=Catalog.CATEGORIES.find(g=>g.id===category)||Catalog.CATEGORIES[0],current=c.assignments.find(a=>a.key===chosen);return '<div class="village-sim-categories">'+Catalog.CATEGORIES.map(g=>'<button data-category="'+g.id+'" aria-pressed="'+(g.id===group.id)+'">'+escape(g.label)+'</button>').join('')+'</div><div class="village-sim-types">'+group.types.map(type=>'<button data-type="'+type+'" '+(!chosen?'disabled':'')+' aria-pressed="'+(current?.type===type)+'">'+Catalog.svg(type)+Catalog.preview(type)+'<b>'+escape(Scene.TYPES[type].label)+'</b><small>'+escape(Catalog.info(type).unit)+'</small></button>').join('')+'</div>';}
 function roadActions(c,items){
  const count=items.filter(i=>i.kind==='road'&&i.key.startsWith('object:')&&!c.roads.includes(i.key)).length;
  return '<div class="village-sim-actions"><button data-do="draw-road">返回设计补画巷道／步道</button>'+(count?'<button data-do="add-paths">加入未选设计步道（'+count+'）</button>':'')+'</div><p class="village-sim-hint">步道独立于公园范围，保存在当前方案；补画后重新打开模拟，并将新步道加入本次路网。</p>';
 }
 function connectionReport(report){
  if(!report?.network?.accessDiagnostics)return '';
  const rows=(report.scene?.buildings||[]).map(b=>({b,d:report.network.accessDiagnostics[b.id]})).filter(x=>x.d);
  const labels={connected:'已连通', 'too-far':'距离过远',blocked:'障碍阻挡',disconnected:'路网断开','no-roads':'缺少道路'};
  const advice={connected:'短接驳已通；仍请核对实际门口。','too-far':'超过26米自动接驳范围，请沿实际巷道补画步道，或核对入口位置。',blocked:'附近道路的直线接驳被建筑、水体或模拟范围边界阻挡，请调整入口或绘制绕行步道。',disconnected:'入口已接上道路，但这片路网不通村口，请补齐道路断点。','no-roads':'请先选择或补画可通行道路。'};
  const missing=rows.filter(x=>x.d.reason!=='connected').length;
  rows.sort((a,b)=>(a.d.reason==='connected')-(b.d.reason==='connected'));
  return '<details class="village-sim-connections" '+(missing?'open':'')+'><summary>入口与道路连接 · '+missing+' 处未连通</summary><p class="village-sim-hint">绿点／绿线：入口与短接驳；红点／红色虚线：失败的候选连接，不代表可走或已建道路。橙色圆点是村口。26米为教学接驳参数。</p>'+rows.map(({b,d})=>'<article class="village-sim-connection '+(d.reason==='connected'?'is-connected':'is-blocked')+'"><b>'+escape(Scene.TYPES[b.type]?.label)+' · '+escape(b.name)+'</b><span>'+labels[d.reason]+(Number.isFinite(d.distance)?' · 接驳距离 '+d.distance.toFixed(1)+' 米':'')+'</span><p>'+advice[d.reason]+'</p><div class="village-sim-actions"><button data-connection-focus="'+escape(b.sourceKey)+'">定位入口</button><button data-connection-entry="'+escape(b.sourceKey)+'">调整入口</button></div></article>').join('')+'</details>';
 }
 function startupGuide(c,items,report,expanded){
  const setup=Adapter.setup(c,items,report),label={ready:'✓',missing:'待完成',pending:'待检查',warning:'提醒'};
  return '<section class="village-sim-startup" aria-label="模拟启动清单"><button data-do="toggle-guide" aria-expanded="'+expanded+'">开始模拟前 · '+setup.completed+'/5 项已就绪 '+(expanded?'收起':'展开')+'</button>'+(expanded?'<ol>'+setup.rows.map(r=>'<li class="is-'+r.status+'"><div><b>'+label[r.status]+' · '+escape(r.title)+'</b><p>'+escape(r.detail)+'</p></div><button data-do="'+r.action+'">'+({select:'选设施','boundary-select':'选区域',scenario:'设置人数',roads:'选道路',entry:'设村口',check:'检查'})[r.action]+'</button></li>').join('')+'</ol><p class="village-sim-hint">首次可用：2处住宅＋6位居民＋1处公园；潜在客源先设6人/日、周期1天。其他设施可逐步补齐；潜在客源不等于实际到访，缺少服务会反映在结果里。</p><p class="village-sim-hint">先自动建议设施入口并检查；不连通或门的位置不对，再点选入口、补连接步道。系统不会自动生成现实中不存在的路。</p>':'')+'<button class="village-sim-next" data-do="check-run">检查并进入运行 →</button></section>';
 }
 function facilityForm(c,items,chosen,category='living',includePalette=true){
  const sources=items.filter(i=>['building','area','component'].includes(i.kind)&&!c.assignments.some(a=>a.components.includes(i.key)));
  const stale=c.assignments.filter(a=>!items.some(i=>i.key===a.key));
  const staleHtml=stale.length?'<details class="village-sim-error"><summary>待校核的旧设施（'+stale.length+'）</summary><p>源对象已移除或旧编号不明确。请重新选择对应对象并定义用途，再手动移除失效配置；原配置不会自动丢弃。</p>'+stale.map(a=>'<p>'+escape(a.key)+' · '+escape(Scene.TYPES[a.type]?.label)+' <button data-remove-key="'+escape(a.key)+'">移除此配置</button></p>').join('')+'</details>':'';
  if(!sources.length)return staleHtml+'<div class="village-sim-empty"><b>尚未识别到建筑或设计设施</b><p>请返回设计，确认当前空间的建筑图层已加载，再重新打开模拟。也可以先体验完整虚拟村庄。</p><a href="village_game/" target="_blank" rel="noopener">打开虚拟村庄 ↗</a></div>';
  const item=sources.find(i=>i.key===chosen),a=c.assignments.find(a=>a.key===chosen);
  const group=Catalog.CATEGORIES.find(g=>g.id===category)||Catalog.CATEGORIES[0];
  const boundary=items.find(i=>i.key===Adapter.BOUNDARY_KEY),boundaryUse=c.assignments.find(a=>a.key===Adapter.BOUNDARY_KEY);
  let html=boundary?'<article class="village-sim-boundary"><b>蓝色设计范围 · 可定义整体功能</b><p>不需要先放置组件。可把整片范围设为公园，内部的树木、座椅等再作为配套。</p><div class="village-sim-actions"><button data-do="boundary-select">选择这片范围</button><button data-do="boundary-park">'+(boundaryUse?.type==='park'?'查看公园设置':boundaryUse?'将范围改为公园':'将范围设为公园')+'</button></div></article>':'';
  html+='<p class="village-sim-hint">地图点选建筑或设施，再选择功能；模型外观保留。</p><div class="village-sim-actions"><button data-do="select">地图点选</button><button data-do="focus" '+(!item?'disabled':'')+'>定位所选</button></div><label>对象列表<select data-field="source"><option value="">请选择地图对象或列表对象</option>'+sources.map(i=>'<option value="'+escape(i.key)+'" '+(i.key===chosen?'selected':'')+'>'+escape((i.kind==='building'?'建筑 · ':i.kind==='area'?'面域 · ':'组件 · ')+i.name)+(c.assignments.some(a=>a.key===i.key)?' ✓':'')+'</option>').join('')+'</select></label>';
  html+=staleHtml;
  if(!item)return html+'<p class="village-sim-empty">尚未选中对象。点击地图上的建筑，或从上方列表选择。</p>';
  html+='<article class="village-sim-selected">'+(a?Catalog.preview(a.type):'')+'<div><b>'+escape(item.name)+'</b><small>'+escape(a?Scene.TYPES[a.type].label+' · 已定义':'未定义 · 保留背景')+'</small></div></article>'+(includePalette?palette(category,chosen,c):'');
  if(!a)return html+'<p class="village-sim-hint">选择底部功能卡片后，可设置容量、吸引力和开放时间。</p>';
  html+='<p class="village-sim-hint">'+escape(Scene.TYPES[a.type].description)+'</p><div class="village-sim-grid">'+[['capacity','容量 · '+Catalog.info(a.type).unit,a.capacity,1,Adapter.capLimit(a.type)],['attraction','基础吸引力',a.attraction,0,100],['staff','经营人员',a.staff,0,8],['open','开放时间（时）',a.open,0,23],['close','结束时间（时）',a.close,1,24]].map(([k,l,v,min,max])=>'<label>'+l+'<input type="number" data-assignment="'+k+'" value="'+v+'" min="'+min+'" max="'+max+'"></label>').join('')+'</div><div class="village-sim-actions"><button data-do="entrance">地图设置设施入口</button><button data-type="">取消功能定义</button></div><p class="village-sim-hint">'+(a.entrance?'已指定入口 '+a.entrance.map(n=>n.toFixed(6)).join(', '):'入口暂按最近道路建议，运行前请核对')+'</p>';
  if(item.kind==='area'){
   const owned=new Set(c.assignments.filter(x=>x.key!==chosen).flatMap(x=>x.components));
   html+='<details><summary>设施配套（'+a.components.length+'）</summary><p>整体面域定义功能，内部长椅、树木和游具作为配套；最多增加10点吸引力。</p>'+items.filter(i=>i.kind==='component'&&!owned.has(i.key)&&!c.assignments.some(x=>x.key===i.key)).slice(0,100).map(i=>'<label class="village-sim-check"><input type="checkbox" data-component="'+escape(i.key)+'" '+(a.components.includes(i.key)?'checked':'')+'>'+escape(i.name)+'</label>').join('')+'</details>';
  }
  return html;
 }
 function open(options){
  const existing=options.readDocument().metadata?.simulation;
  if(existing){const valid=Adapter.validateConfig(existing);if(!valid.ok)throw Error(valid.errors.join('；'));}
  const items=Adapter.catalog(options.readDocument(),options.context),byKey=new Map(items.map(x=>[x.key,x]));
  const host=globalThis.document.createElement('aside');host.className='village-simulation-workspace';host.setAttribute('aria-label','村庄模拟');globalThis.document.body.appendChild(host);
  let tab='config',step=existing?.area?'facilities':'area',chosen='',category='living',report=null,guideOpen=!existing?.entry,message='先确定模拟范围，再核对道路、设施和人群。已有功能配置保留；模拟范围与公园范围分别保存。',busy=false,closed=false,frameId,lastTime=0,lastPaint=0,speed=3,lastViewKey='',drawingArea=false;
  const overlay=Overlay.create({...options.environment,pickGround:options.pickGround,onDrawProgress(count){message='已点选 '+count+' 个模拟边界点；右键、双击或点“完成范围绘制”结束。';for(const node of host.querySelectorAll('[data-live-message],[data-draw-message]'))node.textContent=message;},onPick(purpose,p){
   const c=session.state().config;
   if(purpose==='area'){c.area=p;c.entryMode='auto';const r=apply(c);if(!r.ok){message=statusText(r);render();return r;}drawingArea=false;step='roads';message='模拟范围已确定，公园边界与建筑功能保留。现在核对范围内道路和自动对外口。';render();return r;}
   if(purpose==='entry'){c.entry=p;c.entryMode='manual';}else{const a=c.assignments.find(a=>a.key===purpose);if(a)a.entrance=p;}apply(c);message='已设置地面位置，需重新检查并运行。';render();
  },onInspect(item){if(item.kind==='facility'){if(!captureForm().ok)return;chosen=session.state().config.assignments.find(a=>a.components.includes(item.key))?.key||item.key;tab='config';step='facilities';category=Catalog.CATEGORIES.find(g=>g.types.includes(session.state().config.assignments.find(a=>a.key===chosen)?.type))?.id||category;message='已选中 '+(byKey.get(chosen)?.name||'对象')+'，请在下方设置功能。';render();}else{const a=item.person;message=a.name+' · '+(a.indoor?'室内活动':a.state==='moving'?'步行途中':a.state)+' · 饥饿 '+Math.round(a.needsState?.hunger||0)+' / 疲劳 '+Math.round(a.needsState?.fatigue||0)+' / 社交需求 '+Math.round(a.needsState?.social||0);host.querySelector('[data-live-message]').textContent=message;}}});
  const session=Session.create({readDocument:options.readDocument,readContext:()=>options.context,writeConfig:options.writeConfig,save:options.save,overlay,onState(){if(!closed)refreshLive();}});
  function apply(c){const r=session.update(c);if(r.ok)overlay.cancelPick();report=null;if(!r.ok)message=statusText(r);return r;}
  function captureForm(){
   const before=session.state().config,c=JSON.parse(JSON.stringify(before)),a=c.assignments.find(x=>x.key===chosen);
   host.querySelectorAll('[data-setting]').forEach(input=>{c.settings[input.dataset.setting]=input.value.trim()===''?NaN:Number(input.value);});
   if(a)host.querySelectorAll('[data-assignment]').forEach(input=>{a[input.dataset.assignment]=input.value.trim()===''?NaN:Number(input.value);});
   if(Adapter.stable(c)===Adapter.stable(before))return {ok:true};
   return apply(c);
  }
  function settings(c){return '<details data-setup-section="scenario"><summary>人口与来访情境</summary><p>使用合成人物与家庭，不代表已调查的真实人口。两次比较请保持下列条件相同。</p><div class="village-sim-grid">'+[['population','常住人口',0,180],['visitorsPerDay','日潜在客源',0,80],['days','模拟天数',1,7],['seed','随机种子',0,2147483647],['startWeekday','起始星期（0周一）',0,6]].map(([k,l,min,max])=>'<label>'+l+'<input type="number" data-setting="'+k+'" value="'+c.settings[k]+'" min="'+min+'" max="'+max+'"></label>').join('')+'</div></details>';}
  function results(c){
   if(!c.runs.length)return '<p>完成一个周期后，结果将随方案保存。最多保留最近5次运行摘要。</p>';
   const first=c.runs[0];return c.runs.map((r,i)=>{const v=r.result,compatible=session.compatible(first,r);return '<article class="village-sim-result"><b>运行 '+(c.runs.length-i)+' · R'+escape(r.revision)+'</b><small>'+escape(r.completedAt)+'<br>输入 '+escape(r.inputDigest?.slice(0,12))+'</small><p>来访 '+escape(v.arrivals)+' 人 · 游客体验 '+(v.arrivals?escape(v.satisfaction)+' / 100':'暂无到访，暂不评分')+'<br>平均步行 '+escape(v.averageWalkMinutes)+' 分钟 · 缺少居所 '+escape(v.housingShortage)+'</p><p>居民活动 '+escape(v.resident?.completed)+' / '+escape(v.resident?.total)+'；游客活动 '+escape(v.visitor?.completed)+' / '+escape(v.visitor?.total)+'</p><small>'+escape(Object.entries(v.failures||{}).map(([k,n])=>({'missing':'缺少设施',unreachable:'不通',capacity:'容量',closed:'闭店',staff:'到岗',time:'超时',household:'家庭安排'}[k]||k)+' '+n).join(' · '))+'</small>'+(i?'<p>'+(compatible?'同条件，本次相对最新：来访 '+signed(v.arrivals-first.result.arrivals)+'，体验 '+signed(v.satisfaction-first.result.satisfaction)+'，步行 '+signed(v.averageWalkMinutes-first.result.averageWalkMinutes)+' 分钟':'条件不同：人口、客源、种子、基线或规则不同，不能直接排名')+'</p>':'')+'</article>';}).join('');
  }
  const signed=n=>(n>0?'+':'')+(Math.round(n*10)/10);
  function render(){
   if(closed)return;const s=session.state(),c=s.config,viewKey=tab+'|'+step,scroll=lastViewKey===viewKey?(host.querySelector('.village-sim-sidebar')?.scrollTop||0):0;lastViewKey=viewKey;
   const roadChoices=[...items.filter(i=>i.kind==='road'),...c.roads.filter(k=>!byKey.has(k)).map(key=>({key,name:'待校核的旧道路 · '+key}))];
   const mode=c.area&&c.entryMode!=='manual'?'auto':'manual';
   let content='';
   if(tab==='results')content='<h3>运行结果</h3>'+results(c);
   else if(tab==='run'||step==='run')content='<h3>村庄的一天</h3><div data-clock></div><label>播放速度<select data-field="speed"><option value=".5" '+(speed===.5?'selected':'')+'>细看 · 2秒/分钟</option><option value="3" '+(speed===3?'selected':'')+'>观察 · 3分钟/秒</option><option value="15" '+(speed===15?'selected':'')+'>总览 · 15分钟/秒</option></select></label><button class="village-sim-next" data-do="start">'+(s.snapshot?'保存并重新运行':'保存并开始模拟')+'</button><div class="village-sim-actions"><button data-do="pause">暂停／继续</button><button data-do="finish">完成周期并保存</button></div><p>室外显示人物，室内显示空心位置点。先观察工作、上学、家庭生活与游客来访的整体规律。</p><div data-counts></div><div data-events></div><button data-do="check-run">检查并进入运行 →</button><div data-run-report>'+reportHtml()+'</div>';
   else if(step==='area')content='<h3>① 确定模拟范围</h3><p>这是一整片村庄生活实验区，可包含多处住宅、公园和农田，和单个设施的边界分别保存。</p><div class="village-sim-actions"><button class="village-sim-next" data-do="draw-area">'+(c.area?'重新绘制模拟范围':'绘制模拟范围')+'</button><button data-do="finish-area">完成范围绘制</button><button data-do="cancel-area">取消绘制</button></div>'+(options.context.villageBoundary?'<button data-do="village-area">采用整个村庄边界</button>':'')+'<p>'+(c.area?'已设置独立模拟范围；道路将在边界处裁切。':'尚未划定模拟范围。旧方案的设施和道路配置仍保留。')+'</p><p class="village-sim-hint">在地图依次点边界，右键或双击完成。无需避开建筑，但请完整包含参与模拟的设施；道路跨越边界的位置自动作为对外出入口。</p><button data-step="roads">下一步：道路与出入口 →</button>';
   else if(step==='roads')content='<h3>② 核对路网与出入口</h3><p>范围内沿用本组现状道路；缺少入户巷道时再补画。系统不会把不相连的道路虚接起来。</p>'+roadActions(c,items)+'<details open data-setup-section="roads"><summary>选择参与模拟的道路（'+c.roads.length+'）</summary>'+roadChoices.map(i=>'<label class="village-sim-check"><input type="checkbox" data-road="'+escape(i.key)+'" '+(c.roads.includes(i.key)?'checked':'')+'>'+escape(i.name)+'</label>').join('')+'</details><p>对外口：'+(mode==='auto'?'按范围与道路交点自动识别':'手动指定')+'</p><div class="village-sim-actions"><button data-do="auto-entry">自动识别对外口</button><button data-do="entry">手动设置对外口</button><button data-do="entry-focus">定位村口</button></div><button data-do="check">检查方案</button><div data-report>'+reportHtml()+'</div><button data-step="facilities">下一步：定义设施 →</button>';
   else if(step==='people')content='<h3>④ 设置人群情境</h3><p>默认生成岭南村庄的合成家庭与人物，包含成年、老年、儿童的男女画像；不用逐个人设置。家庭关系跨日保留，工作岗位结合农田和服务设施分配。</p>'+settings(c)+'<button data-do="suggest-population">按范围内住宅容量建议人数</button><p>已定义'+c.assignments.filter(a=>a.type==='home').length+'处住宅，当前常住人口'+c.settings.population+'人。学校、照护及经营设施的供给会影响行为；潜在客源不等于实际到访。</p><p class="village-sim-hint">当前为教学合成情境，未来可用真实人口调查替代。预算本轮不加入。</p><button data-do="check-run">检查并进入运行 →</button><div data-report>'+reportHtml()+'</div>';
   else content='<h3>③ 赋予设施功能</h3><p>先点击地图中的房屋或场地，再点底部功能卡片。功能标识保留在原模型上；参数在右侧调整。</p><p>已定义'+c.assignments.length+'处设施。未定义对象保留背景，不必给全村每栋建筑都配功能。</p><button data-do="select">地图点选建筑／场地</button><button data-do="boundary-select">选择原设计范围</button><button data-step="people">下一步：人群情境 →</button><details><summary>启动检查清单</summary>'+startupGuide(c,items,report,guideOpen)+'</details><button data-do="check">检查方案</button><div data-report>'+reportHtml()+'</div>';
   host.innerHTML='<header class="village-sim-top"><b>村庄生活模拟 · 当前方案</b><nav aria-label="模拟步骤">'+[['config','① 配置'],['run','② 运行'],['results','③ 结果']].map(([k,t])=>'<button data-tab="'+k+'" aria-pressed="'+(tab===k)+'">'+t+'</button>').join('')+'</nav><a href="village_game/" target="_blank" rel="noopener">虚拟村庄 ↗</a><button data-do="close" aria-label="返回场景设计">返回设计 ×</button></header><aside class="village-sim-sidebar"><small>VILLAGE LIFE / 真实方案</small><h2>村庄的一天</h2>'+workflow(c,step)+'<p role="status" data-live-message>'+escape(message)+'</p>'+content+'<footer>当前方案隔离保存 · 不覆盖共享现状</footer></aside>'+(tab==='config'&&step==='facilities'?'<aside class="village-sim-inspector"><h3>所选设施</h3>'+facilityForm(c,items,chosen,category,false)+'</aside><section class="village-sim-palette" aria-label="底部设施功能卡片"><b>'+escape(chosen?(byKey.get(chosen)?.name||'所选对象')+' · 点击卡片设定功能':'先点选建筑或场地，再选择功能')+'</b>'+palette(category,chosen,c)+'</section>':'');
   if(!s.snapshot){if(report?.network)overlay.setPlan(report);else overlay.setSources(items,c,chosen);}
   host.setAttribute('data-drawing-area',String(drawingArea));if(drawingArea)host.innerHTML+='<div class="village-sim-draw-help"><span data-draw-message>'+escape(message)+'</span><button data-do="finish-area">完成范围绘制</button><button data-do="cancel-area">取消绘制</button></div>';
   const sidebar=host.querySelector('.village-sim-sidebar');if(sidebar)sidebar.scrollTop=scroll;
   if(step==='people'){const section=host.querySelector('[data-setup-section="scenario"]');if(section)section.open=true;}
   refreshLive();
  }
  function reportHtml(){return report?(report.extent?'<p>实际模拟范围约 '+Math.round(report.extent.widthM)+' × '+Math.round(report.extent.heightM)+' 米（不含边缘留白）</p>':'')+(report.entries?.length?'<p>本次采用 '+report.entries.length+' 处对外出入口。</p>':'')+(report.network?'<p>已连通村口 '+report.scene.buildings.filter(b=>report.network.connected[b.id]).length+' / '+report.scene.buildings.length+' 处设施。未连通设施在运行中无法正常到访，请核对设施入口与路网。</p>':'')+[...(report.errors||[]).map(s=>'<p class="village-sim-error">'+escape(s)+'</p>'),...(report.warnings||[]).filter(s=>!report.network?.accessDiagnostics||!s.includes('入口按最近道路建议')&&!s.includes('入口未连通村口')).map(s=>'<p>'+escape(s)+'</p>')].join('')+connectionReport(report)+(report.ok?'<b>输入检查通过，可以开始模拟。</b>':''):'';}
  function refreshLive(){if(closed)return;const s=session.state(),snap=s.snapshot;
   host.setAttribute('aria-busy',String(busy));
   if(busy){const node=host.querySelector('[data-live-message]');if(node)node.textContent=s.phase==='saving'?'正在保存当前方案，请稍候；保存成功后才会启动。超时会保留草稿并给出提示。':s.phase==='preparing'?'方案已保存，正在准备人物与行程……':s.finishing?'正在结算本周期并保存结果……':'正在处理，请稍候……';}
   const clock=host.querySelector('[data-clock]');if(clock)clock.textContent=snap?'第'+snap.day+'天 '+String(Math.floor(snap.minute/60)).padStart(2,'0')+':'+String(snap.minute%60).padStart(2,'0')+(s.finishing?' · 正在结算':s.playing?' · 运行中':' · 已暂停'):'尚未开始运行';
   const counts=host.querySelector('[data-counts]');if(counts&&snap)counts.textContent='在村游客 '+snap.agents.filter(a=>a.kind==='visitor'&&!['planned','departed'].includes(a.state)).length+' · 步行 '+snap.agents.filter(a=>a.state==='moving').length+' · 等候 '+snap.agents.filter(a=>a.state==='waiting').length;
   const events=host.querySelector('[data-events]');if(events&&snap)events.innerHTML=snap.events.slice(0,5).map(e=>'<p>'+escape(e.text)+'</p>').join('');
   host.querySelectorAll('button[data-do]').forEach(b=>{b.disabled=b.dataset.do==='focus'&&!byKey.has(chosen)||b.dataset.do==='entry-focus'&&!s.config.entry||['pause','finish'].includes(b.dataset.do)&&!s.snapshot||busy&&b.dataset.do!=='close';});
  }
  host.addEventListener('change',event=>{
   const target=event.target,c=session.state().config,a=c.assignments.find(x=>x.key===chosen);
   if(target.dataset.field==='source'){if(!captureForm().ok){render();return;}chosen=target.value;category=Catalog.CATEGORIES.find(g=>g.types.includes(c.assignments.find(a=>a.key===chosen)?.type))?.id||category;render();return;}
   if(target.dataset.field==='speed'){speed=Number(target.value);return;}
   if(target.dataset.field==='type'){return;}
   else if(target.dataset.setting)c.settings[target.dataset.setting]=Number(target.value);
   else if(target.dataset.assignment&&a)a[target.dataset.assignment]=Number(target.value);
   else if(target.dataset.road)c.roads=target.checked?[...c.roads,target.dataset.road]:c.roads.filter(k=>k!==target.dataset.road);
   else if(target.dataset.component&&a)a.components=target.checked?[...a.components,target.dataset.component]:a.components.filter(k=>k!==target.dataset.component);
   else return;
   const r=apply(c);if(r.ok)message='配置已修改，正在随方案保存；运行需重新开始。';render();
  });
  host.addEventListener('click',async event=>{
   const button=event.target.closest('button');if(!button)return;
   if(busy&&button.dataset.do!=='close')return;
   if(button.dataset.step){drawingArea=false;overlay.cancelPick();if(!captureForm().ok)return;step=button.dataset.step;tab=step==='run'?'run':'config';message=step==='facilities'?'先选地图对象，再用底部卡片设功能。':message;render();return;}
   if(button.dataset.connectionFocus||button.dataset.connectionEntry){
    if(!captureForm().ok)return;const key=button.dataset.connectionFocus||button.dataset.connectionEntry;
    if(!byKey.has(key))return;
    const facility=report?.scene?.buildings.find(b=>b.sourceKey===key),point=facility&&report.projection.toDegrees(facility.entrance);
    if(button.dataset.connectionFocus){overlay.focus(point?{geometry:{type:'Point',coordinates:point}}:byKey.get(key));return;}
    chosen=key;tab='config';session.pause();overlay.pick(key);message='请在该设施实际门口外侧点选入口，须在边界4米以内；道路较远时应补画巷道。';render();return;
   }
   if(button.dataset.removeKey!==undefined){if(!captureForm().ok)return;const c=session.state().config;c.assignments=c.assignments.filter(a=>a.key!==button.dataset.removeKey);if(apply(c).ok)message='已移除失效的功能配置；源建筑和模型不受影响。';render();return;}
   if(button.dataset.category){if(!captureForm().ok){render();return;}category=button.dataset.category;render();return;}
   if(button.dataset.type!==undefined){if(!byKey.has(chosen)||!captureForm().ok)return;const c=session.state().config,old=c.assignments.find(a=>a.key===chosen);c.assignments=c.assignments.filter(a=>a.key!==chosen);if(button.dataset.type)c.assignments.push(old?.type===button.dataset.type?old:Adapter.assignment(chosen,button.dataset.type));const r=apply(c);if(r.ok)message=button.dataset.type?'已设置 '+byKey.get(chosen).name+' 为'+Scene.TYPES[button.dataset.type].label+'，可继续调整下方参数。':'已取消功能定义；原模型保留。';render();return;}
   if(button.dataset.tab){drawingArea=false;overlay.cancelPick();if(captureForm().ok){tab=button.dataset.tab;if(tab==='run')step='run';else if(tab==='config'&&step==='run')step='facilities';}render();return;}
   const action=button.dataset.do;if(!action)return;
   if(action==='close'){dispose();options.onClose?.();return;}
   if(busy)return;
   try{
    const captured=captureForm();if(!captured.ok){message=statusText(captured);render();return;}
    if((action==='start'||action==='check-run')&&!session.state().config.area){tab='config';step='area';message='请先划定模拟范围，或采用整个村庄边界；已有设施和道路配置保留。';render();return;}
    if(action==='draw-area'){session.pause();step='area';drawingArea=true;overlay.pick('area');message='依次点击整片模拟区边界，右键或双击完成；此操作不会改变公园范围。';render();return;}
    if(action==='finish-area'){overlay.finishArea?.();return;}
    if(action==='cancel-area'){drawingArea=false;overlay.cancelPick();message='已取消绘制，保留原模拟范围。';render();return;}
    if(action==='village-area'){const c=session.state().config;c.area=options.context.villageBoundary;c.entryMode='auto';if(apply(c).ok){step='roads';message='已采用村庄边界，接下来核对道路与对外口。';}render();return;}
    if(action==='auto-entry'){const c=session.state().config;if(!c.area){step='area';message='请先划定模拟范围，才能自动识别边界道路交点。';}else{c.entryMode='auto';if(apply(c).ok)message='已启用自动对外口；请检查范围内路网。';}render();return;}
    if(action==='suggest-population'){const c=session.state().config;c.settings.population=Math.min(180,c.assignments.filter(a=>a.type==='home'&&byKey.has(a.key)&&Adapter.areaContains(c.area,byKey.get(a.key).geometry)).reduce((n,a)=>n+a.capacity,0));if(apply(c).ok)message='人数按范围内已配置住宅总容量建议；可自行减少，检查时仍会校核家庭大小。';render();return;}
    if(action==='draw-road'){
     if(options.onEditRoad){dispose();options.onClose?.();options.onEditRoad();}
     else{message='请返回场景设计，点击“道路与步道”补路。';render();}return;
    }
    if(action==='add-paths'){
     const c=session.state().config;c.roads=[...new Set([...c.roads,...items.filter(i=>i.kind==='road'&&i.key.startsWith('object:')).map(i=>i.key)])];
     if(apply(c).ok)message='已加入当前方案的未选设计步道，请重新检查连通。';render();return;
    }
    if(action==='toggle-guide'){guideOpen=!guideOpen;render();return;}
    if(action==='scenario'||action==='roads'){render();const section=host.querySelector('[data-setup-section="'+action+'"]');if(section){section.open=true;section.scrollIntoView?.({block:'nearest'});}return;}
    if(action==='boundary-select'||action==='boundary-park'){
     step='facilities';
     if(!byKey.has(Adapter.BOUNDARY_KEY))return;chosen=Adapter.BOUNDARY_KEY;category='public';
     if(action==='boundary-park'){const c=session.state().config,old=c.assignments.find(a=>a.key===chosen);if(old?.type!=='park'){c.assignments=c.assignments.filter(a=>a.key!==chosen);c.assignments.push(Adapter.assignment(chosen,'park'));if(!apply(c).ok){render();return;}}message='这片设计范围已作为一处公园／公共休憩设施；可调整容量、开放时段和入口。';}
     else message='已选中整体设计范围，可在下方赋予功能；也可继续作为单纯设计边界。';
     render();host.querySelector('.village-sim-selected')?.scrollIntoView?.({block:'nearest'});return;
    }
    if(action==='select'){
overlay.pick('source');message='请点击地图上的建筑、设计模型或设施面域。';render();return;}
    if(action==='focus'){overlay.focus(byKey.get(chosen));return;}
    if(action==='entry-focus'){const entry=session.state().config.entry;if(entry)overlay.focus({geometry:{type:'Point',coordinates:entry}});return;}
    if(action==='entry'||action==='entrance'){if(action==='entrance'&&!session.state().config.assignments.some(a=>a.key===chosen))return;session.pause();overlay.pick(action==='entry'?'entry':chosen);message='请在原三维场景的道路旁地面单击'+(action==='entry'?'村口':'该设施边界入口')+'。';render();return;}
    if(action==='check'||action==='check-run'){report=session.check();message=report.ok?'检查完成，已显示入口与连接；可保存并开始模拟。':statusText(report);if(report.ok&&action==='check-run'){tab='run';step='run';}else tab='config';render();return;}
    if(action==='pause'){const s=session.state();s.playing?session.pause():session.resume();return;}
    busy=true;overlay.cancelPick();refreshLive();let result;
    if(action==='save')result=await session.save();
    if(action==='start'){result=await session.start();if(result.ok)tab='run';else report=result;}
    if(action==='finish'){result=await session.finish();if(result.ok)tab='results';}
    if(closed)return;message=statusText(result);if(action==='start'&&result.ok)message='已保存输入并开始运行；可以拖动视角、点击人物或设施。';
   }catch(e){if(!closed)message='操作未完成：'+e.message;}
   finally{busy=false;if(!closed)render();}
  });
  function frame(time){if(closed)return;const dt=Math.min(.2,(time-lastTime)/1000||0);lastTime=time;try{session.tick(dt*speed);if(time-lastPaint>80){session.paint();refreshLive();lastPaint=time;}}catch(e){session.pause();message=e.message;render();}frameId=requestAnimationFrame(frame);}
  function dispose(){if(closed)return;closed=true;cancelAnimationFrame(frameId);session.dispose();host.remove();}
  render();frameId=requestAnimationFrame(frame);return {dispose,session};
 }
 return {open,escape,facilityForm,startupGuide,connectionReport,roadActions,workflow,palette};
});
