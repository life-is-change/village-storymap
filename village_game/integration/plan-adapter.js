(function(root,factory){const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('../domain/scene'):root.VillageScene,common?require('../domain/population'):root.VillagePopulation,common?require('../domain/network'):root.VillageNetwork,common?require('../../3D_scenes_edit/domain/geometry-rules'):root.SceneGeometryRulesModule,common?require('../domain/schedule'):root.VillageSchedule,common?require('./experiment-area'):root.VillageExperimentArea,common?require('../domain/market-layout'):root.VillageMarketLayout);
 if(common)module.exports=api;if(root)root.VillagePlanAdapter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Scene,Population,Network,Geometry,Schedule,Area,MarketLayout){
 'use strict';
 const RULE_VERSION='platform-village-7-studio-market',BOUNDARY_KEY='boundary:selection',copy=v=>JSON.parse(JSON.stringify(v));
 const capLimit=type=>Scene.TYPES[type]?.limit||({home:12,inn:32,food:60,park:80,attraction:60})[type]||40;
 const coordinate=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
 function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
 function shortId(text){let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(16);}
 async function digest(value){const bytes=new TextEncoder().encode(stable(value)),hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');}
 function assignment(key,type='home'){
  const t=Scene.TYPES[type];return {key,type,capacity:t?.defaultCapacity||4,staff:type==='market'?3:['home','farm','park','attraction','play','ancestral'].includes(type)?0:1,open:type==='market'?6.5:type==='inn'?0:6,close:type==='market'?10:22,attraction:50,components:[]};
 }
 function catalog(document,context){
  const items=[],seen=new Set();
  function add(key,geometry,kind,name,category,properties={},aliases=[]){
   if(!geometry||!['Polygon','LineString','Point'].includes(geometry.type))return;
   if(seen.has(key))throw Error('源对象编号重复：'+key);seen.add(key);
   items.push({key,geometry:copy(geometry),kind,name:String(name||key).slice(0,60),category,properties,aliases});
  }
  for(const f of context.baselineFeatures||[]){
   const layer=f.layerKey||f.properties?.layerKey,rootId=f.id??f.properties?.id??f.properties?.feature_id??f.properties?.building_id;
   const id=rootId===undefined?'geometry-'+shortId(stable(f.geometry)):String(rootId),key='baseline:'+id;
   const kind=['building','buildings'].includes(layer)?'building':['road','roads','path'].includes(layer)?'road':layer==='water'?'water':null;
   if(!kind)continue;
   const g=f.geometry;
   const aliases=[...new Set([...(f.identityAliases||[]),f.legacyId??f.properties?.id??f.properties?.osm_id??rootId,'geometry-'+shortId(stable(g))].filter(x=>x!=null).map(x=>'baseline:'+x))];
   if(g?.type==='MultiLineString')g.coordinates.forEach((c,i)=>add(key+':'+i,{type:'LineString',coordinates:c},kind,f.properties?.name||'现状道路',layer,f.properties,aliases.map(k=>k+':'+i)));
   else if(g?.type==='MultiPolygon')g.coordinates.forEach((c,i)=>add(key+':'+i,{type:'Polygon',coordinates:c},kind,f.properties?.name||'现状建筑',layer,f.properties,aliases.map(k=>k+':'+i)));
   else add(key,g,kind,f.properties?.displayName||f.properties?.name||f.properties?.building_name||(['building','buildings'].includes(layer)?'建筑 '+id:'现状道路 '+id),layer,f.properties,aliases);
  }
  for(const o of document.objects||[])add('object:'+o.id,o.geometry,o.kind==='line'&&o.category==='path'&&o.properties?.sceneRole!=='site-component'?'road':o.kind==='surface'?'area':'component',o.properties?.displayName||o.id,o.category,o.properties);
  if(document.selectionBoundary?.type==='Polygon'){
   add(BOUNDARY_KEY,document.selectionBoundary,'area','整体设计范围','activity-field');
   items[items.length-1].origin='selection-boundary';
  }
  return items;
 }
 function solidComponentRings(object,toLocal){
  const geometry=object.geometry,properties=object.properties||{};
  if(geometry?.type==='Point'&&['asset','structure'].includes(object.kind)){
   const center=toLocal(geometry.coordinates),size=(properties.footprintM||[1,1]).map((n,i)=>Number(n)*(object.transform?.scale?.[i]||1)),angle=-(object.transform?.headingDeg||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
   if(size.length!==2||size.some(n=>!Number.isFinite(n)||n<=0))throw Error('组件占地无效：'+object.id);
   return [[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x,y])=>[center[0]+x*size[0]/2*c-y*size[1]/2*s,center[1]+x*size[0]/2*s+y*size[1]/2*c])];
  }
  if(geometry?.type==='Polygon'&&(['water','planter','planting'].includes(object.category)||Number(properties.extrusionHeightM)>.2))return [geometry.coordinates[0].map(toLocal)];
  if(geometry?.type==='LineString'&&['fence','low-wall','hedge'].includes(object.category)){
   const points=geometry.coordinates.map(toLocal),radius=Math.max(.05,Number(properties.widthM)||.4)/2,rings=[];
   for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)continue;const ux=dx/length,uy=dy/length;const corner=(p,t,k)=>[p[0]+t*radius*ux-k*radius*uy,p[1]+t*radius*uy+k*radius*ux];const ring=[corner(a,-1,-1),corner(b,1,-1),corner(b,1,1),corner(a,-1,1)];ring.push(ring[0].slice());rings.push(ring);}
   return rings;
  }
  return [];
 }
 function setup(config,items,checked=null){
  const byKey=new Map(items.map(i=>[i.key,i])),facilities=config.assignments.filter(a=>byKey.has(a.key)&&Area.contains(config.area,byKey.get(a.key).geometry));
  const auto=config.area&&config.entryMode!=='manual',gates=auto?Area.clipRoads(items.filter(i=>i.kind==='road'&&config.roads.includes(i.key)),config.area).entries:[];
  const homes=facilities.filter(a=>a.type==='home').map(a=>({...a,id:a.key,modelVersion:2,capacityMode:'configured'}));
  const households=Population.generate(homes,config.settings.population,{preset:config.morningMarket?.mode==='legacy'?'morning-market':'lingnan'}).households;
  const boundHomes=Schedule.bindHousing({buildings:homes,households});
  const shortage=households.filter(h=>!boundHomes[h.id]).length,roads=config.roads.filter(k=>byKey.get(k)?.kind==='road');
  const disconnected=(checked?.scene?.buildings||[]).filter(b=>!checked.network?.connected?.[b.id]);
  const rows=[
   {id:'facilities',title:'定义设施',status:facilities.length?'ready':'missing',detail:facilities.length+'处已定义；设计范围可直接设为公园，不必先摆组件。',action:items.some(i=>i.key===BOUNDARY_KEY)?'boundary-select':'select'},
   {id:'residents',title:'人口与住宅',status:config.settings.population===0?'ready':!homes.length?'missing':shortage?'warning':'ready',detail:config.settings.population+'位居民 · '+households.length+'户家庭 · '+homes.length+'处住宅'+(shortage?'；'+shortage+'户无法按家庭人数入住。可增加住宅容量、增加住宅或减少人口。':''),action:'scenario'},
   {id:'roads',title:'选择道路',status:roads.length&&roads.length===config.roads.length?'ready':'missing',detail:'已选'+roads.length+'条有效路径；先用现状道路即可，无需先重画全村。',action:'roads'},
   {id:'entry',title:'对外出入口',status:auto?(gates.length?'ready':'missing'):coordinate(config.entry)?'ready':'missing',detail:auto?'按边界道路交点识别'+gates.length+'处对外口；请检查连通。':config.entry?'已手动指定村口；须检查是否接上道路。':'先划范围自动识别，或在道路旁手动设置村口。',action:auto?'roads':'entry'},
   {id:'connections',title:'检查入口与连通',status:!checked?'pending':!checked.ok?'missing':disconnected.length?'warning':'ready',detail:!checked?'尚未检查。设施入口可先自动建议，再人工核对。':!checked.ok?'检查未通过，请按下方具体原因修正。':disconnected.length?disconnected.length+'处设施未连通村口；可重设设施入口或补路径。':'村口与设施已连通；仍请核对道路是否真正可步行。',action:'check'}
  ];
  return {rows,completed:rows.filter(r=>r.status==='ready').length,householdCount:households.length,housingShortage:shortage,disconnectedKeys:disconnected.map(b=>b.sourceKey)};
 }
 function createConfig(document,context){return {version:1,settings:{population:24,visitorsPerDay:48,seed:20261022,days:3,startWeekday:4},entry:null,roads:catalog(document,context).filter(x=>x.kind==='road').map(x=>x.key),assignments:[],runs:[]};}
 function reconcileConfig(config,items){
  const c=copy(config),keys=new Set(items.map(i=>i.key)),aliases=new Map();
  for(const item of items)for(const alias of item.aliases||[]){if(!aliases.has(alias))aliases.set(alias,new Set());aliases.get(alias).add(item.key);}
  // Never guess when an old ID occurs in more than one layer. Keep unresolved
  // references visible for explicit correction; do not delete saved choices.
  const resolve=key=>keys.has(key)?key:aliases.get(key)?.size===1?[...aliases.get(key)][0]:key;
  if(!Array.isArray(c.roads)||!Array.isArray(c.assignments))return c;
  c.roads=[...new Set(c.roads.map(resolve))];
  c.assignments=c.assignments.map(a=>({...a,key:resolve(a.key),components:Array.isArray(a.components)?a.components.map(resolve):a.components}));
  return c;
 }
 function pickSource(picked,point,items){
  const sources=items.filter(i=>['building','area','component'].includes(i.kind));
  const entity=picked?.id||picked?.primitive?.id;
  const property=entity?.properties?.sourceObjectId,value=typeof property?.getValue==='function'?property.getValue():property;
  const objectId=value??(String(entity?.id||'').startsWith('scene-edit:')?String(entity.id).slice(11):null);
  if(objectId){const item=sources.find(i=>i.key==='object:'+objectId);if(item)return item;}
  const code=entity?.__sourceCode||picked?.primitive?.__sourceCode;
  if(code){const matches=sources.filter(i=>i.kind==='building'&&String(i.properties?.sourceCode??'')===String(code));if(matches.length===1)return matches[0];if(matches.length>1&&point){const item=matches.find(i=>i.geometry.type==='Polygon'&&Geometry.containsGeometry(i.geometry,{type:'Point',coordinates:point}));if(item)return item;}}
  if(!point)return null;
  // Test the real footprint (including holes), never a rectangular proxy.
  return sources.filter(i=>i.geometry.type==='Polygon'&&Geometry.containsGeometry(i.geometry,{type:'Point',coordinates:point})).sort((a,b)=>
   (a.kind==='area'?1:0)-(b.kind==='area'?1:0)||Geometry.measureAreaM2(a.geometry)-Geometry.measureAreaM2(b.geometry))[0]||null;
 }
 function validateConfig(c){
  const errors=[],fail=m=>errors.push(m),number=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi,integer=(v,lo,hi)=>Number.isInteger(v)&&number(v,lo,hi);
  if(!c||c.version!==1||!c.settings||!Array.isArray(c.assignments)||!Array.isArray(c.roads)||!Array.isArray(c.runs))return {ok:false,errors:['模拟配置格式无效']};
  if(Object.keys(c).some(k=>!['version','settings','entry','roads','assignments','runs','area','entryMode','morningMarket'].includes(k)))fail('模拟配置包含未知字段');
  if(c.morningMarket!==undefined){const m=c.morningMarket,fields=['marketKey','vendorCount','customerCount','startMinute','openMinute','lastEntryMinute','endMinute'];
   if(!m||typeof m!=='object'||Object.keys(m).some(k=>!fields.includes(k)&&k!=='mode')||m.mode!==undefined&&!['daily','legacy'].includes(m.mode)||typeof m.marketKey!=='string'||!m.marketKey.startsWith('object:')||!integer(m.vendorCount,1,6)||!integer(m.customerCount,1,60)||!fields.slice(3).every(k=>integer(m[k],360,720))||!(m.startMinute<m.openMinute&&m.openMinute<m.lastEntryMinute&&m.lastEntryMinute<m.endMinute)||m.endMinute-m.startMinute>360)fail('早市配置无效：检查人数、市场和营业时段');
  }
  if(c.area!=null){const valid=Area.validate(c.area);if(!valid.ok)errors.push(...valid.errors);}
  if(c.entryMode!==undefined&&!['auto','manual'].includes(c.entryMode))fail('对外出入口模式无效');
  const s=c.settings;
  if(!integer(s.population,0,180)||!integer(s.visitorsPerDay,0,80)||!integer(s.seed,0,2147483647)||!integer(s.days,1,7)||!integer(s.startWeekday,0,6))fail('人口0—180、日潜在客源0—80、周期1—7天；种子与星期须有效');
  if(c.entry!==null&&!coordinate(c.entry))fail('村口坐标无效');
  if(c.assignments.length>240||c.roads.length>800||c.runs.length>5||JSON.stringify(c).length>180000)fail('配置或结果超过首版规模上限');
  const keys=new Set(),validKey=k=>typeof k==='string'&&(k===BOUNDARY_KEY||/^(baseline|object):/.test(k))&&k.length<=240&&!/[\x00-\x1f]/.test(k);
  if(new Set(c.roads).size!==c.roads.length||c.roads.some(k=>!validKey(k)))fail('道路选择无效或重复');
  for(const a of c.assignments){
   if(!a||!validKey(a.key)||keys.has(a.key)){fail('设施源对象编号无效或重复');continue;}keys.add(a.key);
   if(!Object.hasOwn(Scene.TYPES,a.type)||!integer(a.capacity,1,capLimit(a.type))||!integer(a.staff,0,8)||!number(a.open,0,23)||!number(a.close,1,24)||a.open>=a.close||!number(a.attraction,0,100))fail('设施用途、容量、人员、开放时段或吸引力无效：'+a.key);
   if(a.entrance!==undefined&&a.entrance!==null&&!coordinate(a.entrance))fail('设施入口坐标无效');
   if(!Array.isArray(a.components)||a.components.length>100||a.components.some(k=>!validKey(k)))fail('设施配套无效');
  }
  for(const r of c.runs){
   if(!r||!/^([0-9a-f]{64})$/.test(r.inputDigest)||!/^([0-9a-f]{64})$/.test(r.comparisonDigest)||!r.result||!r.source||!Number.isInteger(r.revision)||!Number.isFinite(Date.parse(r.completedAt))){fail('历史运行摘要无效');continue;}
   const v=r.result;
   if(['arrivals','averageWalkMinutes','housingShortage','satisfaction','encounters'].some(k=>!number(v[k],0,1e9))||!v.resident||!v.visitor||!v.failures||[v.resident.total,v.resident.completed,v.visitor.total,v.visitor.completed,...Object.values(v.failures)].some(n=>!number(n,0,1e9)))fail('历史运行数值无效');
  }
  return {ok:!errors.length,errors};
 }
 function compile(document,context,config){
  const checked=validateConfig(config);if(!checked.ok)return checked;
  const errors=[],warnings=[],items=catalog(document,context),byKey=new Map(items.map(i=>[i.key,i]));
  if(document.villageId!==context.villageId)errors.push('方案与当前村庄不匹配');
  const autoEntry=!!config.area&&config.entryMode!=='manual';
  if(!config.entry&&!autoEntry)errors.push('请在地图上设置村口');
  let roads=config.roads.map(k=>byKey.get(k));
  if(!roads.length)errors.push('请选择现状道路或先在场景设计中绘制路径');
  if(roads.some(r=>!r||r.kind!=='road'||r.geometry.type!=='LineString'))errors.push('选中的道路已删除或类型改变，请重新确认');
  let selected=config.assignments.map(a=>({a,item:byKey.get(a.key)}));
  if(selected.some(x=>!x.item||!['Polygon','Point'].includes(x.item.geometry.type)))errors.push('配置中的设施已删除或类型改变，请重新确认');
  if(config.settings.population>0&&!selected.some(x=>x.a.type==='home'))errors.push('常住人口大于零时，至少需要配置一处住宅');
  const componentOwners=new Set();
  for(const {a} of selected)for(const key of a.components){const item=byKey.get(key);if(!item||item.kind!=='component'||componentOwners.has(key)||config.assignments.some(x=>x.key===key))errors.push('配套已移除、重复归属或被单独设为设施：'+key);componentOwners.add(key);}
  if(errors.length)return {ok:false,errors,warnings};
  let entries=config.entry?[config.entry]:[];
  if(config.area){
   if(context.villageBoundary&&!Area.contains(context.villageBoundary,config.area))errors.push('模拟范围须位于当前村庄边界内');
   const clipped=Area.clipRoads(roads,config.area);roads=clipped.roads;
   if(autoEntry)entries=clipped.entries;
   const outside=selected.filter(x=>!Area.contains(config.area,x.item.geometry));
   for(const x of outside)warnings.push(x.item.name+'：位于模拟范围外或跨越边界，本次不参与；原功能配置保留');
   selected=selected.filter(x=>Area.contains(config.area,x.item.geometry));
   if(!roads.length)errors.push('模拟范围内没有选中道路，请调整范围或选择道路');
   if(!entries.length)errors.push('范围边界没有道路穿过，无法识别对外口；请扩大范围到道路交界，或手动设置对外口');
   if(config.settings.population>0&&!selected.some(x=>x.a.type==='home'))errors.push('模拟范围内至少需要一处住宅，或将常住人口设为0');
   if(config.entryMode==='manual'&&config.entry&&!Area.contains(config.area,{type:'Point',coordinates:config.entry}))errors.push('手动对外口须位于模拟范围内或边界上');
  }
  if(errors.length)return {ok:false,errors,warnings};
  const coords=[...entries,...(config.area?.coordinates[0]||[]),...roads.flatMap(r=>r.geometry.coordinates),...selected.flatMap(x=>x.item.geometry.type==='Polygon'?x.item.geometry.coordinates[0]:[x.item.geometry.coordinates])];
  if(coords.some(p=>!coordinate(p.slice(0,2))))return {ok:false,errors:['输入坐标无效或超出首版纬度范围']};
  const origin=[Math.min(...coords.map(p=>p[0])),Math.min(...coords.map(p=>p[1]))],margin=Scene.PLATFORM_EDGE_MARGIN;
  const toLocal=p=>Geometry.toLocalMeters(p,origin).map(n=>n+margin),toDegrees=p=>Geometry.fromLocalMeters(p.map(n=>n-margin),origin);
  const local=coords.map(toLocal),size=[0,1].map(i=>Math.max(100,Math.max(...local.map(p=>p[i]))+margin));
  const span=[0,1].map(i=>Math.max(...local.map(p=>p[i]))-margin),extent={widthM:span[0],heightM:span[1]};
  if(span.some(n=>n>Scene.PLATFORM_MAX_SPAN+1e-6))return {ok:false,extent,errors:['当前所选道路、设施与村口的范围约 '+Math.round(span[0])+' × '+Math.round(span[1])+' 米；实际东西、南北跨度各不超过2公里（不含边缘留白）。请取消远处道路或核对村口、设施位置']};
  for(let i=0;i<2;i++)size[i]=Math.min(size[i],Scene.PLATFORM_MAX_SPAN+2*margin);
  const scene={schemaVersion:2,name:'方案生活模拟',revision:document.revision,size,source:{kind:'platform',projectId:document.projectId,villageId:document.villageId,spaceId:document.baselineRef.spaceId,baselineRevision:document.baselineRef.revision,ruleVersion:RULE_VERSION},buildings:[],roads:roads.map(r=>({id:'r-'+shortId(r.key),sourceKey:r.sourceKey||r.key,name:r.name,kind:'path',width:Math.min(12,Math.max(1,Number(r.properties?.widthM)||4)),points:r.geometry.coordinates.map(toLocal)})),zones:[],obstacles:[],scenario:{...copy(config.settings),startMinute:360,endMinute:1440,entry:toLocal(entries[0]),...(config.area?{entries:entries.map(toLocal)}:{}),visitorMix:[50,25,25],adaptive:true,living:true,visitorMode:'attraction'}};
  if(config.area)scene.walkBoundary=config.area.coordinates[0].map(toLocal);
  const segments=scene.roads.flatMap(r=>r.points.slice(1).map((b,i)=>[r.points[i],b]));
  if(segments.length>Scene.roadSegmentLimit(scene))return {ok:false,errors:['选中的道路超过'+Scene.roadSegmentLimit(scene)+'段，请减少实验道路；系统未自动截断路网']};
  const distanceToRing=(p,ring)=>Math.min(...ring.slice(1).map((b,i)=>Network.distance(Network.project(p,ring[i],b).point,p)));
  for(const {a,item} of selected){
   const polygon=item.geometry.type==='Polygon'?item.geometry.coordinates[0].map(toLocal):null,center=polygon?polygon.slice(0,-1).reduce((p,q)=>[p[0]+q[0]/(polygon.length-1),p[1]+q[1]/(polygon.length-1)],[0,0]):toLocal(item.geometry.coordinates);
   let entrance=a.entrance?toLocal(a.entrance):a.type==='market'&&config.morningMarket?.marketKey===a.key&&item.properties.marketGate?toLocal(item.properties.marketGate):null;
   if(!entrance){
    let best=null;
    for(const [r,s] of segments){const roadPoint=Network.project(center,r,s).point;
     if(polygon)for(let i=1;i<polygon.length;i++){const q=Network.project(roadPoint,polygon[i-1],polygon[i]).point,d=Network.distance(q,roadPoint);if(!best||d<best.d){const len=d||1;best={d,p:[q[0]+(roadPoint[0]-q[0])/len*.2,q[1]+(roadPoint[1]-q[1])/len*.2]};}}
     else{const d=Network.distance(center,roadPoint);if(!best||d<best.d)best={d,p:roadPoint};}
    }entrance=best?.p||center;
    warnings.push(item.name+'：入口按最近道路建议，建议地面点选核对');
   }
   if(polygon&&distanceToRing(entrance,polygon)>4)errors.push(item.name+'：入口须位于实际边界4米以内');
   if(config.area&&!Area.contains(config.area,{type:'Point',coordinates:toDegrees(entrance)}))errors.push(item.name+'：设施入口超出模拟范围，请调整入口或范围边界');
   const b=Scene.createBuilding(a.type,center[0],center[1],'f-'+shortId(a.key),2);
   Object.assign(b,{modelVersion:2,capacityMode:'configured',sourceKey:a.key,name:item.name,width:4,depth:4,height:1,rotation:0,entrance,capacity:a.capacity,residents:0,staff:a.staff,open:a.open,close:a.close,attraction:a.attraction,schoolStage:a.type==='kindergarten'?'preschool':'both',componentCount:a.components.length});
   if(polygon){b.footprint=polygon;b.areaM2=Geometry.measureAreaM2(item.geometry);b.passable=item.kind==='area';}
   else{b.x=entrance[0];b.y=entrance[1]-2;b.entrance=entrance;b.passable=true;}
   if(a.components.length){
    for(const key of a.components){const part=byKey.get(key);if(part?.geometry.type!=='Point'||!polygon||!Geometry.containsGeometry(item.geometry,part.geometry))errors.push(item.name+'：配套须位于该设施范围内');}
    b.attraction=Math.min(100,a.attraction+Math.min(10,new Set(a.components.map(k=>byKey.get(k)?.category)).size*2));
   }
   scene.buildings.push(b);
  }
  // Unconfigured buildings remain visible background and also block access shortcuts.
  for(const item of items.filter(i=>i.kind==='water'||i.kind==='building'&&!config.assignments.some(a=>a.key===i.key))){const points=item.geometry.type==='Polygon'?item.geometry.coordinates[0].map(toLocal):null;if(points&&points.every(p=>p.every((v,i)=>v>=0&&v<=size[i])))scene.obstacles.push(points);}
  Object.assign(scene,Population.generate(scene.buildings,scene.scenario.population,{preset:config.morningMarket?.mode==='legacy'?'morning-market':'lingnan'}));
  // Scale synthetic employment to this plan; the demonstration village's fixed
  // first-twelve-farmers rule would leave a small real plan without any staff.
  const adults=scene.people.filter(p=>p.ageGroup==='adult'),slots=scene.buildings.reduce((n,b)=>n+b.staff,0),hasFarm=scene.buildings.some(b=>b.type==='farm');
  adults.forEach((p,i)=>{p.job=i<Math.min(slots,adults.length)?'service':hasFarm&&i%2===0?'farm':i%10===9?'external':'flex';});
  const validation=Scene.validate(scene);errors.push(...validation.errors);
  if(errors.length)return {ok:false,errors,warnings};
  let network;try{network=Network.buildNetwork(scene);}catch(e){return {ok:false,errors:[e.message],warnings};}
  for(const b of scene.buildings)if(!network.connected[b.id])warnings.push(b.name+'：入口未连通村口，运行中将无法正常到访');
  if(!network.connected.entry)errors.push('村口未接通选中的道路，请在道路上重新设置');
  const homes=Schedule.bindHousing(scene),housingShortage=scene.households.filter(h=>!homes[h.id]).length;
  if(housingShortage)warnings.push(housingShortage+'户家庭无法按人数分配住宅；请增加可容纳该家庭的住宅容量、增加住宅或减少人口');
  const marketConfigs=config.morningMarket?.mode==='legacy'?[config.morningMarket]:config.assignments.filter(a=>a.type==='market').map(a=>config.morningMarket?.marketKey===a.key?config.morningMarket:{marketKey:a.key,vendorCount:a.staff,customerCount:12,startMinute:360,openMinute:a.open*60,lastEntryMinute:a.close*60-30,endMinute:a.close*60});
  scene.marketLayouts={};
  for(const m of marketConfigs){
   const market=scene.buildings.find(b=>b.sourceKey===m.marketKey&&b.type==='market'),field=byKey.get(m.marketKey),marketObject=document.objects.find(o=>'object:'+o.id===m.marketKey);
   if(!market||!marketObject?.properties?.marketId||field?.geometry.type!=='Polygon')errors.push('请将已布置早市的活动场地定义为村庄早市');
   else{
    const children=document.objects.filter(o=>o.id!==marketObject.id&&o.properties?.marketId===marketObject.id);
    const stalls=children.filter(o=>o.properties.marketRole==='stall').map(o=>({id:o.id,name:o.properties.displayName||o.id,center:toLocal(o.geometry.coordinates),headingDeg:o.transform?.headingDeg||0,footprint:(o.properties.footprintM||[3.4,2.6]).map((n,i)=>n*(o.transform?.scale?.[i]||1)),produceKind:o.properties.produceKind}));
    if(m.mode==='legacy'&&stalls.length<m.vendorCount)errors.push('早市摊位不足，请补齐摊位或减少摊主人数');
    const localField={type:'Polygon',coordinates:field.geometry.coordinates.map(r=>r.map(toLocal))},components=[];
    const intersectsField=ring=>Geometry.intersectsAny(localField,[{type:'Polygon',coordinates:[ring]}]);
    try{for(const object of document.objects){if(object.id===marketObject.id||object.properties?.marketId===marketObject.id&&['stall','aisle'].includes(object.properties?.marketRole))continue;components.push(...solidComponentRings(object,toLocal).filter(intersectsField));}}catch(error){errors.push(error.message);}
    const localObstacles=[...scene.obstacles,...scene.buildings.filter(b=>b.id!==market.id&&!b.passable&&b.footprint).map(b=>b.footprint),...components].filter(intersectsField);
    const layout=MarketLayout.compileMarketLayout({field:localField,stalls,aisles:children.filter(o=>o.properties.marketRole==='aisle').map(o=>({id:o.id,points:o.geometry.coordinates.map(toLocal),width:o.properties.widthM})),obstacles:localObstacles,gate:market.entrance});
    if(!layout.ok)errors.push(...layout.errors);
    const eligible=scene.people.filter(p=>p.age>=18&&homes[p.householdId]).sort((a,b)=>shortId(scene.scenario.seed+':'+a.id).localeCompare(shortId(scene.scenario.seed+':'+b.id))||a.id.localeCompare(b.id));
    if(m.mode==='legacy'&&(eligible.length<m.vendorCount+m.customerCount||housingShortage))errors.push('早市角色或住宅容量不足');else if(housingShortage)warnings.push('部分家庭缺少住宅，市场与其他日常活动将受到影响');
    const roles=eligible.slice(0,m.vendorCount+m.customerCount).map((p,i)=>({personId:p.id,homeId:homes[p.householdId],marketRole:i<m.vendorCount?'vendor':'customer',...(i<m.vendorCount?{stallId:stalls[i]?.id}:{})}));
    if(layout.ok){const marketObstacles=[...layout.layout.stalls.map(s=>s.footprint),...components];
     for(const road of scene.roads)if(Geometry.intersectsAny({type:'LineString',coordinates:road.points},marketObstacles.map(ring=>({type:'Polygon',coordinates:[ring]}))))errors.push('早市实体占用了已选道路：'+road.name+'；请移动摊位/组件或重新选择道路');
     scene.obstacles.push(...marketObstacles);network=Network.buildNetwork(scene);
    }
    if(m.mode==='legacy')for(const role of roles)if(!Network.route(network,network.access[role.homeId],network.access[market.id]))errors.push('早市人物住宅未接通市场入口：'+role.homeId);
    market.marketStartMinute=m.startMinute;market.marketLastEntryMinute=m.lastEntryMinute;market.staff=m.vendorCount;market.open=m.openMinute/60;market.close=m.endMinute/60;scene.dailyMarketMode=m.mode!=='legacy';
    if(!network.connected[market.id])warnings.push('市场入口未接通村路，运行时无法到访');
    if(layout.ok){scene.marketLayouts[market.id]=layout.layout;scene.morningMarket= {version:'morning-market-1',marketId:market.id,layout:layout.layout,roles,times:{startMinute:m.startMinute,openMinute:m.openMinute,lastEntryMinute:m.lastEntryMinute,endMinute:m.endMinute}};}
   }
  }
  const payload={source:scene.source,scene,config:{settings:config.settings,entry:config.entry,roads:config.roads,assignments:config.assignments,...(config.morningMarket?{morningMarket:config.morningMarket}:{}),...(config.area?{area:config.area,entryMode:config.entryMode||'auto'}:{})}};
  return {ok:!errors.length,errors,warnings,extent,scene,network,items,area:config.area||null,entries,projection:{toLocal,toDegrees},payload};
 }
 return {RULE_VERSION,BOUNDARY_KEY,assignment,capLimit,catalog,createConfig,reconcileConfig,validateConfig,compile,digest,stable,pickSource,setup,areaContains:Area.contains,areaRoads:Area.clipRoads};
});
