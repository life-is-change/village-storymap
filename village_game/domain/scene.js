(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./population'):root.VillagePopulation,typeof module==='object'&&module.exports?require('./growth'):root.VillageGrowth);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageScene=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Population,Growth){
  'use strict';
  const roadSegmentLimit=scene=>scene?.source?.kind==='platform'?800:180;
  const PLATFORM_MAX_SPAN=2000,PLATFORM_EDGE_MARGIN=40;
  const TYPES = Object.freeze({
    home:{label:'村民住宅',color:'#d2b38e',roof:'#626d60',need:null,minutes:0,area:30,defaultCapacity:4,description:'居民的出发点与归宿，产生工作、购物和休憩需求。'},
    inn:{label:'民宿',color:'#d89c65',roof:'#835d46',need:'stay',minutes:60,area:28,defaultCapacity:4,description:'为过夜游客提供床位；入住后占用到次日早晨。'},
    food:{label:'乡村餐饮',color:'#e3a886',roof:'#a4664b',need:'food',minutes:40,area:8,defaultCapacity:4,description:'居民与游客共享就餐位，服务时间较长，易产生等候。'},
    shop:{label:'生活商店',color:'#ccbc89',roof:'#777050',need:'shop',minutes:20,area:10,defaultCapacity:3,description:'居民日常购物；沿生活路线设置可以缩短出行。'},
    workshop:{label:'手作工坊',color:'#b69ed0',roof:'#766483',need:'craft',minutes:60,area:15,defaultCapacity:2,description:'游客参与手作体验，也承担一部分居民工作。'},
    center:{label:'游客服务',color:'#82b5b9',roof:'#527e81',need:'info',minutes:15,area:10,defaultCapacity:4,description:'提供问询与路线了解，不凭空增加外部游客。'},
    park:{label:'公共休憩',color:'#a4bd83',roof:'#748957',need:'rest',minutes:30,area:8,defaultCapacity:6,description:'居民与游客休息、停留的共享公共空间。'},
    attraction:{label:'景观体验',color:'#88a4c7',roof:'#61728a',need:'view',minutes:45,area:12,defaultCapacity:4,description:'游客的观景与游览目的地，需要可达的路线。'},
    kindergarten:{label:'村庄幼儿园',color:'#e3d7ae',roof:'#718b78',need:'school',minutes:120,area:6,defaultCapacity:12,unit:'学前名额',limit:40,staffed:true,perStaff:12,description:'3—5岁幼儿的工作日保教与在园用餐，需要教师到岗和家庭送接；不接收小学、中学学生。'},
    ancestral:{label:'宗祠／村史堂',color:'#ceb69c',roof:'#786b6a',need:'social',minutes:40,area:6,defaultCapacity:24,unit:'活动人数',limit:60,description:'本村林氏宗祠的村史展示与公共文化空间，供邻里活动与游客参访；本版不模拟祭祀仪式。'},
    school:{label:'乡村教学点',color:'#ccbe83',roof:'#728d69',need:'school',minutes:120,area:4,defaultCapacity:24,unit:'学位',limit:80,staffed:true,perStaff:24,description:'工作日教学与学校午餐；学位和教师到岗共同决定服务。'},
    care:{label:'日间照料',color:'#d0bbaa',roof:'#98786a',need:'care',minutes:90,area:10,defaultCapacity:8,unit:'照料名额',limit:24,staffed:true,perStaff:8,description:'供需要支持的居民使用，老人按能力和意愿选择。'},
    clinic:{label:'卫生服务点',color:'#e0d5c3',roof:'#798e87',need:'health',minutes:20,area:12,defaultCapacity:4,unit:'服务名额',limit:12,staffed:true,perStaff:4,description:'预置日常健康支持，不模拟疾病诊断。'},
    culture:{label:'文化活动室',color:'#d3b395',roof:'#886c61',need:'social',minutes:45,area:5,defaultCapacity:16,unit:'活动人数',limit:60,staffed:true,perStaff:20,description:'居民与游客按开放时段共享的文化活动。'},
    play:{label:'儿童活动场',color:'#b5c692',roof:'#829a61',need:'play',minutes:45,area:5,defaultCapacity:12,unit:'活动人数',limit:40,description:'课后与周末活动，亲子游客也可使用。'},
    meal:{label:'社区助餐',color:'#c7a987',roof:'#927253',need:'food',minutes:30,area:8,defaultCapacity:8,unit:'餐位',limit:40,staffed:true,perStaff:10,description:'提供居民备选助餐，游客使用旅游餐饮。'},
    night:{label:'晚间集市',color:'#c79baf',roof:'#886478',need:'night',minutes:40,area:6,defaultCapacity:16,unit:'活动人数',limit:60,staffed:true,perStaff:20,description:'指定晚间时段开放，邻近住宅的安静也需要考虑。'},
    farm:{label:'生产农田',color:'#c6c380',roof:'#969756',need:'work',minutes:100,area:8,defaultCapacity:12,description:'为居民提供工作目的地，保持村庄的生产生活。'}
  });
  const NEEDS = Object.freeze({school:'上学',cook:'准备家中餐食',escort:'家庭陪同/接送',care:'日间支持',health:'日常健康支持',social:'交流活动',play:'玩耍',night:'晚间活动',home:'返家/居住',breakfast:'早餐',lunch:'午餐',dinner:'晚餐',checkout:'退房',sleep:'夜间休息',external:'村外活动',work:'工作',shop:'购物',rest:'休憩',food:'就餐',craft:'手作体验',info:'问询',view:'观景',stay:'住宿'});
  const clone = value => JSON.parse(JSON.stringify(value));
  function entrance(b){if(Array.isArray(b.entrance))return [...b.entrance];const angle=(b.rotation||0)*Math.PI/180;return [b.x-Math.sin(angle)*(b.depth/2+1),b.y+Math.cos(angle)*(b.depth/2+1)];}
  function maximumCapacity(b){const type=Object.hasOwn(TYPES,b.type)?TYPES[b.type]:null;if(!type)return 0;if(b.capacityMode==='configured')return type.limit||({home:12,inn:32,food:60,shop:40,workshop:24,park:80,attraction:60,farm:40,center:40})[b.type]||40;const floors=['home','inn'].includes(b.type)?Math.max(1,Math.floor(b.height/3.5)):1;return Math.max(1,Math.min(b.modelVersion===2?(type.limit||({home:12,inn:32,food:60,shop:40,workshop:24,park:80,attraction:60,farm:40,center:40})[b.type]||40):40,Math.floor(b.width*b.depth*floors/type.area)));}
  function capacity(b){return Math.max(1,Math.min(maximumCapacity(b),Math.floor((b.capacity||TYPES[b.type]?.defaultCapacity||1)*(1+.15*((b.level||1)-1)))));}
  function createBuilding(type,x,y,id,modelVersion=1){const t=Object.hasOwn(TYPES,type)?TYPES[type]:null;if(!t)throw new Error('未知设施用途');return {...(modelVersion===2?{modelVersion:2,staff:['home','farm','park','attraction','play','ancestral'].includes(type)?0:1,schoolStage:type==='kindergarten'?'preschool':'primary',overviewLabel:false}:{}),id:id||'b-'+Date.now(),name:t.label,type,x,y,width:type==='farm'?35:22,depth:type==='farm'?24:20,height:['park','farm','play','attraction'].includes(type)?1:type==='night'?3:7,rotation:0,capacity:t.defaultCapacity,open:7,close:21,residents:type==='home'?3:0};}
  function createVillage(){
    const buildings=[];let index=0;
    for(const y of [82,242])for(const x of [65,100,190,225,260,295]){const b=createBuilding('home',x,y,'home-'+(++index));Object.assign(b,{name:['溪畔','田边'][y===82?0:1]+'民居 '+(index>6?index-6:index),width:20,depth:20,height:index%3===0?10:7,rotation:y===242?180:0,residents:index%2===0?3:2});buildings.push(b);}
    const presets=[['center',55,142,'村口问询站',180,4],['shop',120,145,'老街杂货铺',180,3],['food',185,145,'溪田小食堂',180,3],['inn',285,145,'田间客舍',180,4],['workshop',185,180,'竹编工坊',0,2],['park',250,183,'榕树广场',0,5],['attraction',365,242,'溪边观景亭',180,3],['farm',75,320,'西田生产点',180,12],['farm',230,320,'东田生产点',180,12]];
    presets.forEach(([type,x,y,name,rotation,cap],i)=>{const b=createBuilding(type,x,y,'service-'+i);Object.assign(b,{name,rotation,capacity:cap});if(type==='park'){b.width=30;b.depth=25;}if(type==='farm')b.width=40;buildings.push(b);});
    return {schemaVersion:1,revision:0,name:'溪田村',size:[480,360],source:{kind:'fictional',coordinateSystem:'local-meters',geographicAnchor:null,assumptions:'教学体验预设'},
      buildings,roads:[
        {id:'road-main',name:'村口主街',kind:'road',width:7,points:[[25,110],[420,110]]},
        {id:'road-west',name:'田间村路',kind:'road',width:5,points:[[150,40],[150,295]]},
        {id:'road-middle',name:'生活街巷',kind:'path',width:4,points:[[40,210],[390,210]]},
        {id:'road-east',name:'溪边支路',kind:'path',width:3,points:[[330,110],[330,295]]},
        {id:'road-farm',name:'生产路',kind:'path',width:3,points:[[40,295],[375,295]]}
      ],zones:[
        {id:'field-west',kind:'field',name:'西侧农田',points:[[20,308],[145,308],[145,345],[20,345]]},
        {id:'field-east',kind:'field',name:'东侧农田',points:[[170,308],[290,308],[290,345],[170,345]]},
        {id:'forest',kind:'forest',name:'村后林地',points:[[305,305],[390,305],[390,348],[305,348]]},
        {id:'water',kind:'water',name:'溪流',points:[[440,5],[470,5],[470,355],[420,355],[415,275],[435,190],[420,100]]},
        {id:'reserve',kind:'reserve',name:'待设计用地',points:[[40,28],[130,28],[130,60],[40,60]]}
      ],scenario:{seed:20261010,days:3,population:30,startMinute:420,endMinute:1260,visitorsPerDay:24,entry:[25,110]}};
  }
  function createPreviousVillage(){
    const base=createVillage();base.schemaVersion=2;base.name='溪田村 · 完整生活';base.size=[600,460];base.source.baseline='ideal';base.buildings=[];
    let index=0;for(const y of [70,170,270,370])for(const x of [70,125,235,290,400,455]){const b=createBuilding('home',x,y,'home-'+(++index));Object.assign(b,{modelVersion:2,name:(y<250?'溪畔':'田边')+'人家 '+index,width:24,depth:22,capacity:4,residents:3,open:0,close:24,staff:0,schoolStage:'primary',overviewLabel:false});base.buildings.push(b);}
    const rows=[['center',70,125,'service-0','村口服务站',6,8,19,1],['shop',125,125,'service-1','生活杂货店',8,7,20,1],['food',235,125,'service-2','溪田餐馆',12,10,21,2],['inn',400,125,'service-3','溪畔民宿',10,0,24,1],['workshop',290,125,'service-4','竹编工坊',6,9,18,1],['park',455,125,'service-5','河畔休憩地',20,6,22,0],['attraction',455,325,'service-6','溪边观景',12,7,21,0],['farm',70,435,'service-7','西田生产点',18,6,19,0],['farm',235,435,'service-8','东田生产点',18,6,19,0],['school',235,225,'school','乡村教学点',24,7,17,1],['care',70,225,'care','邻里照料站',8,8,18,1],['clinic',125,225,'clinic','村卫生服务点',4,8,18,1],['culture',290,225,'culture','村民文化室',16,9,21,1],['play',400,225,'play','儿童活动场',12,7,20,0],['park',455,225,'park-east','榕树广场',20,6,22,0],['shop',70,325,'shop-north','田边小店',8,7,20,1],['food',125,325,'food-north','田边农家餐馆',8,10,21,1],['inn',400,325,'inn-north','田园客舍',10,0,24,1],['workshop',290,325,'craft-north','农产手作坊',6,9,18,1],['park',235,325,'park-north','邻里口袋广场',14,6,21,0],['night',455,405,'night-market','溪岸晚间集市',16,18,22,1],['meal',70,405,'community-meal','邻里助餐点',8,11,19,1]];
    for(const [type,x,y,id,name,cap,open,close,staff] of rows){const b=createBuilding(type,x,y,id);Object.assign(b,{modelVersion:2,name,capacity:cap,open,close,staff,schoolStage:'primary',rotation:180,residents:0,overviewLabel:['center','school','care','farm'].includes(type)||id==='park-east'});if(y===405){b.depth=16;b.width=20;}if(type==='park'){b.width=28;b.depth=24;}base.buildings.push(b);}
    base.roads=[...([95,195,295,395,420].map((y,i)=>({id:'lane-'+i,name:['村口生活街','南北生活巷','田边生活街','生产与居住联系','田间生产路'][i],kind:i===0?'road':'path',width:i===0?6:4,points:[[20,y],[550,y]]}))),...([180,345,520].map((x,i)=>({id:'cross-'+i,name:'联系村路 '+(i+1),kind:'path',width:4,points:[[x,25],[x,445]]})))];
    base.zones=[{id:'field',kind:'field',name:'村后田地',points:[[20,424],[320,424],[320,454],[20,454]]},{id:'forest',kind:'forest',name:'村后林地',points:[[350,424],[530,424],[530,454],[350,454]]},{id:'water',kind:'water',name:'溪流',points:[[575,5],[595,5],[595,455],[575,455]]},{id:'reserve',kind:'reserve',name:'可设计的留白',points:[[25,10],[150,10],[150,35],[25,35]]}];
    base.scenario={seed:20261010,days:3,population:72,startMinute:360,endMinute:1440,startWeekday:4,visitorsPerDay:24,visitorMix:[50,25,25],entry:[20,95]};Object.assign(base,Population.generate(base.buildings,72));return base;
  }
  function createLingnanVillageV4(){
    const base=createPreviousVillage();base.source={...base.source,presetVersion:4,region:'岭南／华南虚构村庄',assumptions:'主姓聚居与祠塘空间为地域教学假设，非所有村庄通则'};
    const byId=id=>base.buildings.find(b=>b.id===id);
    Object.assign(byId('home-1'),{x:550,y:170});Object.assign(byId('home-2'),{x:550,y:270});Object.assign(byId('service-0'),{x:550,y:70,rotation:0});
    Object.assign(byId('school'),{type:'kindergarten',name:'溪田幼儿园',capacity:12,schoolStage:'preschool'});
    const hall=createBuilding('ancestral',70,70,'ancestral-hall',2);Object.assign(hall,{name:'林氏宗祠 · 村史堂',width:36,depth:24,height:7,capacity:24,open:8,close:20,staff:0});base.buildings.push(hall);
    const garden=createBuilding('park',70,146,'pond-garden',2);Object.assign(garden,{name:'半月塘边公共空间',width:24,depth:10,height:1,rotation:180,capacity:12,open:6,close:21,staff:0});base.buildings.push(garden);
    base.zones.push({id:'moon-pond',kind:'water',name:'村前半月塘',points:[[45,103],[95,103],[95,118],[90,126],[70,132],[50,126],[45,118]]});
    base.roads.push({id:'pond-path',name:'半月塘边步道',kind:'path',width:3,points:[[100,95],[100,137],[70,137]]});
    Object.assign(base,Population.generate(base.buildings,72,{preset:'lingnan'}));for(const h of base.households){const home=byId(h.homeId);home.residents=h.members.length;home.capacity=Math.max(3,h.members.length+1);}
    return base;
  }
  function createIdealVillage(){
    const base=createLingnanVillageV4(),byId=id=>base.buildings.find(b=>b.id===id);base.source.presetVersion=5;
    Object.assign(byId('service-6'),{x:550,y:325,width:28,depth:36,height:1,rotation:90,name:'溪岸观景平台'});
    Object.assign(byId('community-meal'),{x:125,y:70,rotation:0,name:'邻里助餐点'});
    Object.assign(byId('night-market'),{x:455,y:310,width:42,depth:16,height:3,rotation:180,name:'生活街晚间摊位'});
    byId('service-5').name='东巷休憩地';
    return base;
  }
  function upgradeLegacy(input){const s=clone(input);s.schemaVersion=2;s.source={...(s.source||{}),baseline:'legacy',assumptions:'旧方案显式升级；需按新规则补充生活服务'};for(const b of s.buildings)Object.assign(b,{modelVersion:2,staff:['home','farm','park','attraction','play','ancestral'].includes(b.type)?0:1,schoolStage:b.type==='kindergarten'?'preschool':'primary',overviewLabel:b.type!=='home'});s.scenario={...s.scenario,startMinute:360,endMinute:1440,startWeekday:4,visitorMix:[50,25,25]};Object.assign(s,Population.generate(s.buildings,s.scenario.population));return s;}
  const UPGRADES={comfort:{label:'舒适休憩',types:['park','play','inn','attraction','ancestral','culture','care','home']},culture:{label:'文化特色',types:['ancestral','culture','workshop','attraction','food','inn','night']},family:{label:'亲子友好',types:['play','park','inn','food','workshop','attraction']},service:{label:'服务效率',types:['food','meal','shop','inn','center','workshop','care','clinic','school','kindergarten','night']}};
  function createAdaptiveVillage(){const s=createIdealVillage();s.source.presetVersion=6;s.scenario={...s.scenario,adaptive:true,visitorMode:'attraction',visitorsPerDay:48};return s;}
  function createLivingVillage(){const s=createAdaptiveVillage();s.source.presetVersion=7;s.scenario.living=true;return s;}
  function referenceVillage(scene){const s=scene.schemaVersion===1?createVillage():scene.source?.baseline==='legacy'?upgradeLegacy(createVillage()):scene.source?.presetVersion>=7?createLivingVillage():scene.source?.presetVersion>=6?createAdaptiveVillage():scene.source?.presetVersion>=5?createIdealVillage():scene.source?.presetVersion>=4?createLingnanVillageV4():createPreviousVillage();s.scenario=clone(scene.scenario);if(scene.schemaVersion===2){s.people=clone(scene.people);s.households=clone(scene.households);if(scene.growth){s.growth=clone(scene.growth);s.growth.facilities=Object.fromEntries(Object.entries(s.growth.facilities).filter(([id,f])=>s.buildings.some(b=>b.id===id&&b.type===f.type)));}}return s;}
  function validate(scene){
    const errors=[];const finite=Number.isFinite;const bounded=(n,a,b)=>finite(n)&&n>=a&&n<=b;
    if(!scene||typeof scene!=='object')return {ok:false,errors:['场景不是有效对象']};
    if(![1,2].includes(scene.schemaVersion))errors.push('不支持的场景版本');
    if(typeof scene.name!=='string'||scene.name.length>60)errors.push('村庄名称无效');
    if(!Number.isInteger(scene.revision)||scene.revision<0)errors.push('方案版本无效');
    const size=scene.size,sizeLimit=scene.source?.kind==='platform'?PLATFORM_MAX_SPAN+2*PLATFORM_EDGE_MARGIN:2000;
    if(!Array.isArray(size)||size.length!==2||size.some(n=>!bounded(n,100,sizeLimit)))errors.push('场地尺寸须在 100—'+sizeLimit+' 米之间');
    const point=p=>Array.isArray(p)&&p.length===2&&bounded(p[0],0,size?.[0]||0)&&bounded(p[1],0,size?.[1]||0);
    const ids=new Set();const checkID=o=>{if(!o||typeof o.id!=='string'||!o.id||o.id.length>80||['entry','__proto__','prototype','constructor'].includes(o.id)||ids.has(o.id))errors.push('对象编号无效或重复');else ids.add(o.id);};
    if(!Array.isArray(scene.buildings)||scene.buildings.length>240)errors.push('建筑列表无效或超过 240 个');
    else for(const b of scene.buildings){checkID(b);if(!b)continue;
      if(!Object.hasOwn(TYPES,b.type))errors.push('未知建筑用途');
      if(typeof b.name!=='string'||b.name.length>60)errors.push('建筑名称无效');
      if(b.attraction!==undefined&&!bounded(b.attraction,0,100)||b.level!==undefined&&(!Number.isInteger(b.level)||!bounded(b.level,1,3))||b.upgrade!==undefined&&(typeof b.upgrade!=='string'||b.upgrade!==''&&(!Object.hasOwn(UPGRADES,b.upgrade)||!UPGRADES[b.upgrade].types.includes(b.type))))errors.push('设施吸引力或升级方向无效');
      if(!point([b.x,b.y]))errors.push('建筑坐标越界');
      if(!bounded(b.width,4,65)||!bounded(b.depth,4,65)||!bounded(b.height,1,18)||!bounded(b.rotation,-360,360))errors.push('建筑尺寸或角度无效');
      if(!Number.isInteger(b.capacity)||!bounded(b.capacity,1,scene.schemaVersion===2?(TYPES[b.type]?.limit||({home:12,inn:32,food:60,park:80,attraction:60})[b.type]||40):40))errors.push('接待位数无效');
      if(!Number.isInteger(b.residents)||!bounded(b.residents,0,10))errors.push('居民数无效');
      if(!bounded(b.open,0,23)||!bounded(b.close,1,24)||b.open>=b.close)errors.push('开放时间无效');
      if(scene.schemaVersion===2&&(!Number.isInteger(b.staff)||!bounded(b.staff,0,8)||b.modelVersion!==2||!['preschool','primary','secondary','both'].includes(b.schoolStage)||b.type==='kindergarten'&&b.schoolStage!=='preschool'))errors.push('运营人员或学段配置无效');
      if(b.entrance&&!point(b.entrance))errors.push('入口坐标无效');
      else if(b.entrance&&!b.footprint){const a=-b.rotation*Math.PI/180,dx=b.entrance[0]-b.x,dy=b.entrance[1]-b.y,x=Math.abs(dx*Math.cos(a)-dy*Math.sin(a)),y=Math.abs(dx*Math.sin(a)+dy*Math.cos(a));const gap=(x<=b.width/2&&y<=b.depth/2)?Math.min(b.width/2-x,b.depth/2-y):Math.hypot(Math.max(0,x-b.width/2),Math.max(0,y-b.depth/2));if(gap>3)errors.push('自定义入口须位于建筑边缘 3 米内');}
      if(b.footprint&&(!Array.isArray(b.footprint)||b.footprint.length<4||b.footprint.length>1000||b.footprint.some(p=>!point(p))))errors.push('真实设施边界无效');
    }
    if(!Array.isArray(scene.roads)||scene.roads.length>200)errors.push('道路列表无效');
    else for(const r of scene.roads){checkID(r);if(!r)continue;if(!['road','path'].includes(r.kind)||!bounded(r.width,1,12))errors.push('道路类型或宽度无效');if(!Array.isArray(r.points)||r.points.length<2||r.points.length>(scene.source?.kind==='platform'?801:80)||r.points.some(p=>!point(p)))errors.push('道路节点无效');}
    if(Array.isArray(scene.roads)&&scene.roads.reduce((n,r)=>n+Math.max(0,(r?.points?.length||0)-1),0)>roadSegmentLimit(scene))errors.push('道路过于复杂，请将总线段数简化到 '+roadSegmentLimit(scene)+' 段以内');
    if(!Array.isArray(scene.zones)||scene.zones.length>40)errors.push('区域列表无效');
    else for(const z of scene.zones){checkID(z);if(!z)continue;if(!['field','forest','water','reserve'].includes(z.kind)||!Array.isArray(z.points)||z.points.length<3||z.points.length>40||z.points.some(p=>!point(p)))errors.push('区域无效');}
    const s=scene.scenario;if(!s||!Number.isInteger(s.days)||!bounded(s.days,1,7)||!Number.isInteger(s.population)||!bounded(s.population,0,180)||!Number.isInteger(s.seed)||!bounded(s.visitorsPerDay,0,80)||!Number.isInteger(s.visitorsPerDay)||s.startMinute!==(scene.schemaVersion===2?360:420)||s.endMinute!==(scene.schemaVersion===2?1440:1260)||!point(s.entry))errors.push('运营情境无效');
    if(s&&(s.adaptive!==undefined&&typeof s.adaptive!=='boolean'||s.living!==undefined&&typeof s.living!=='boolean'||s.visitorMode!==undefined&&!['fixed','attraction'].includes(s.visitorMode)))errors.push('动态行为或来访模式无效');
    if(scene.growth!==undefined&&Array.isArray(scene.buildings)&&Array.isArray(scene.people))errors.push(...Growth.validate(scene.growth,scene));
    if(scene.schemaVersion===2){if(!s||!Number.isInteger(s.startWeekday)||!bounded(s.startWeekday,0,6)||!Array.isArray(s.visitorMix)||s.visitorMix.length!==3||s.visitorMix.some(n=>!Number.isInteger(n)||!bounded(n,0,100))||s.visitorMix.reduce((a,b)=>a+b,0)!==100)errors.push('来访构成或日历无效');errors.push(...Population.validate(scene));}
    if(Array.isArray(scene.buildings)&&scene.buildings.reduce((n,b)=>n+(Number(b?.residents)||0),0)>180)errors.push('居民总数超过体验版上限');
    return {ok:errors.length===0,errors};
  }
  return {PLATFORM_MAX_SPAN,PLATFORM_EDGE_MARGIN,roadSegmentLimit,TYPES,NEEDS,UPGRADES,clone,entrance,maximumCapacity,capacity,createBuilding,createVillage,createIdealVillage,createAdaptiveVillage,createLivingVillage,createLingnanVillageV4,createPreviousVillage,upgradeLegacy,referenceVillage,validate};
});
