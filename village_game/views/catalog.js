(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageCatalog=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const CATEGORIES=Object.freeze([
  {id:'living',label:'居住 · 住宿',color:'#567766',types:['home','inn']},
  {id:'economy',label:'生产 · 经营',color:'#a67543',types:['farm','workshop','food','shop','night']},
  {id:'care',label:'教育 · 照护',color:'#54878e',types:['kindergarten','school','care','clinic','meal']},
  {id:'public',label:'公共 · 文化',color:'#896784',types:['park','play','culture','ancestral']},
  {id:'visit',label:'旅游 · 游憩',color:'#6c84a4',types:['center','attraction']}
 ]);
 // Glyphs use one 32-unit grid, one stroke style, and no platform font.
 const GLYPHS={
  home:'M4 15 16 5 28 15 M7 13v14h18V13 M13 27v-9h6v9',
  inn:'M5 10v17 M5 23h23v4 M5 18h23v5 M9 18v-6h7v6 M17 18v-6h7a4 4 0 0 1 4 4v2',
  farm:'M16 28V13 M16 21C5 22 5 12 5 8c8 0 11 5 11 13 M16 17c0-8 6-11 12-12 1 8-2 12-12 12',
  workshop:'M6 6h9l3 5-5 4-5-3Z M13 15 24 27l4-4-11-11',
  food:'M6 5v9 M10 5v9 M14 5v9 M6 11h8v4l-4 3v10 M25 5c-7 0-7 13 0 13V5 M25 18v10',
  shop:'M5 12h22l-2 15H7Z M11 12V8a5 5 0 0 1 10 0v4 M11 19h10',
  night:'M5 18h22v10H5Z M3 18l3-5h20l3 5 M12 28v-6h8v6 M20 4a5 5 0 0 0 7 6 6 6 0 1 1-7-6',
  kindergarten:'M6 28V14l10-7 10 7v14Z M13 28v-8h6v8 M5 5h4 M7 3v4 M23 8c1-5 5-6 6-4 0 3-3 5-6 4',
  school:'M16 9C10 5 6 6 3 8v18c4-3 8-2 13 1 5-3 9-4 13-1V8c-4-2-8-2-13 1Z M16 9v18 M7 12l5 1 M21 13l4-1 M7 17l5 1 M21 18l4-1',
  care:'M6 20v8 M26 20v8 M6 22c5 0 5 5 10 5s6-5 10-5 M16 18C4 11 10 3 16 9c6-6 12 2 0 9',
  clinic:'M11 5h10v6h6v10h-6v6H11v-6H5V11h6Z',
  meal:'M4 17h24c-1 8-6 10-12 10S5 25 4 17Z M8 28h16 M10 4c-5 4 4 5 0 10 M17 4c-5 4 4 5 0 10 M24 4c-5 4 4 5 0 10',
  park:'M4 19h17 M4 23h17 M6 19v9 M19 19v9 M9 15h12 M25 15v13 M25 4c-9 8-9 12 0 12s9-4 0-12',
  play:'M4 27h24 M6 27V7h10v20 M6 12h10 M6 17h10 M6 22h10 M16 7l12 20',
  culture:'M4 27h24 M6 13v14 M26 13v14 M3 13 16 5l13 8Z M12 16h8v8h-8Z M16 16v8',
  ancestral:'M3 12 9 7l7 5 7-5 6 5 M3 15h26 M6 15v12 M26 15v12 M12 15v12 M20 15v12 M3 27h26 M9 7V4 M23 7V4',
  center:'M16 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24 M16 14v9 M16 9v1',
  attraction:'M3 27 12 12l7 15 M14 27 23 16l6 11 M8 19l4-3 4 3 M23 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6'
 };
 const MODELS={
  house:{wall:'#dec5a1',roof:'#687567'},commerce:{wall:'#dfbf9a',roof:'#9b6d50'},
  learning:{wall:'#e3d7ae',roof:'#718b78'},support:{wall:'#e0d8c6',roof:'#879a8b'},
  hall:{wall:'#ceb69c',roof:'#786b6a'},landscape:{wall:'#a9bf8e',roof:'#809c68'},
  field:{wall:'#c6c58a',roof:'#959b60'},visitor:{wall:'#b5c7cb',roof:'#698995'}
 };
 const registry={
  home:['house','居住位'],inn:['house','床位'],food:['commerce','餐位'],shop:['commerce','服务位'],night:['commerce','活动人数'],
  farm:['field','作业位'],workshop:['commerce','体验位'],kindergarten:['learning','学前名额'],school:['learning','学位'],
  care:['support','照料名额'],clinic:['support','服务名额'],meal:['support','餐位'],culture:['hall','活动人数'],ancestral:['hall','活动人数'],
  park:['landscape','舒适人数'],play:['landscape','活动人数'],center:['visitor','服务位'],attraction:['visitor','活动人数']
 };
 function info(type){
  const entry=registry[type],category=CATEGORIES.find(c=>c.types.includes(type));
  if(!entry||!category)throw new Error('未定义的设施表达：'+type);
  const form=type==='farm'?'field':type==='night'?'market':type==='attraction'?'platform':['park','play'].includes(type)?'open':'building';
  return {type,category:category.id,categoryLabel:category.label,color:category.color,model:entry[0],unit:entry[1],form,formLabel:({field:'生产田地',market:'临时摊位场',platform:'开放观景平台',open:'开放活动场',building:'固定建筑'})[form],useLabel:type==='night'?'按时开市':'按日程使用',...MODELS[entry[0]]};
 }
 // Parts are local to the facility footprint; both map renderers consume this structure.
 function structure(b){
  const t=info(b.type),parts=[],add=(role,x,y,z,w,d,h,fill)=>parts.push({role,x,y,z,w,d,h,fill});let body=t.form==='building'?{x:0,y:0,z:b.height/2+.2,w:b.width,d:b.depth,h:b.height,fill:t.wall}:null;
  if(body&&['ancestral','kindergarten'].includes(b.type)){body.d=b.depth*.58;body.y=-b.depth*.21;}
  if(t.form!=='building')add('base',0,0,.18,b.width,b.depth,.36,t.form==='platform'?'#c9b68f':t.wall);
  if(t.form==='field'){for(let i=0;i<6;i++)add('crop',-b.width*.4+i*b.width*.16,-b.depth*.1,.5,Math.max(.7,b.width*.045),b.depth*.7,.6,'#a5b66e');add('shade',b.width*.27,b.depth*.35,2.1,b.width*.32,b.depth*.2,.3,'#8b9f77');for(const x of [.13,.41])add('post',b.width*x,b.depth*.35,1, .5,.5,2,'#8e795c');}
  if(t.form==='open'&&b.type==='park')add('bench',0,b.depth*.3,.8,b.width*.35,2,1.2,'#b19774');
  if(b.type==='play'){add('play-tower',-b.width*.2,0,1.7,b.width*.13,b.depth*.25,3.4,'#8da9a2');add('slide',b.width*.12,0,.8,b.width*.5,b.depth*.16,1.6,'#d9b387');add('sand',0,b.depth*.3,.4,b.width*.55,b.depth*.22,.3,'#e2d4a6');}
  if(t.form==='platform'){for(const x of [-.43,.43])for(const y of [-.4,.4])add('rail-post',b.width*x,b.depth*y,1.1,.6,.6,1.7,'#927b59');for(const x of [-.43,.43])add('rail',b.width*x,0,1.8,.5,b.depth*.85,.3,'#ae9571');add('bench',0,-b.depth*.28,.9,b.width*.42,2,1.2,'#9e835f');}
  if(t.form==='market'){for(let i=0;i<4;i++){const x=(-.375+i*.25)*b.width;add('counter',x,0,.7,b.width*.2,b.depth*.35,1.2,i%2?'#b8ab89':'#c2a17f');add('awning',x,0,2.7,b.width*.23,b.depth*.5,.35,i%2?'#d7bd91':'#b78e87');for(const y of [-.2,.2])add('stall-post',x,b.depth*y,1.4,.35,.35,2.8,'#9c8265');}}
  if(b.type==='ancestral'){for(const x of [-.37,.37])add('gate',b.width*x,b.depth*.3,2.5,1.2,1.2,5,'#a96651');add('lintel',0,b.depth*.3,5,b.width*.85,2,.65,'#786b6a');add('plaque',0,b.depth*.33,4.6,b.width*.26,.5,1,'#594c3f');}
  if(b.type==='kindergarten'){for(let i=0;i<3;i++)add('activity',(-.27+i*.27)*b.width,b.depth*.28,.7,b.width*.15,b.depth*.2,1.4,['#ddad76','#96b8b7','#b7bd85'][i]);}
  return {form:t.form,body,parts};
 }
 function paths(type){if(!GLYPHS[type])throw new Error('未定义的功能图标：'+type);return '<path d="'+GLYPHS[type]+'"/>';}
 function svg(type){const t=info(type);return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="'+t.color+'" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">'+paths(type)+'</svg>';}
 const images=new Map(),drawPaths=new Map();
 function image(type,disconnected=false){
  const key=type+'|'+disconnected;if(!images.has(key)){const t=info(type),stroke=disconnected?'#c37747':t.color;
   const xml='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="1" y="1" width="38" height="38" rx="11" fill="#fffdf5" stroke="'+stroke+'" stroke-width="2"/><g transform="translate(5 5) scale(.9375)" fill="none" stroke="'+t.color+'" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'+paths(type)+'</g></svg>';
   images.set(key,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml));
  }return images.get(key);
 }
 function drawIcon(ctx,type,x,y,size,disconnected=false){
  const t=info(type);if(!drawPaths.has(type))drawPaths.set(type,new Path2D(GLYPHS[type]));
  ctx.save();ctx.translate(x-size/2,y-size/2);ctx.scale(size/40,size/40);ctx.fillStyle='#fffdf5';ctx.strokeStyle=disconnected?'#c37747':t.color;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(1,1,38,38,11);ctx.fill();ctx.stroke();ctx.translate(5,5);ctx.scale(.9375,.9375);ctx.strokeStyle=t.color;ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(drawPaths.get(type));ctx.restore();
 }
 const billboardImages=new Map();
 function billboardImage(type,disconnected=false){
  if(typeof document==='undefined'||typeof Path2D==='undefined')return image(type,disconnected);
  const key=type+'|'+disconnected;if(!billboardImages.has(key)){const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;drawIcon(canvas.getContext('2d'),type,40,40,78,disconnected);billboardImages.set(key,canvas);}return billboardImages.get(key);
 }
 function preview(type){
  const t=info(type);let shape;
  if(t.form==='market')shape='<path d="m9 38 34-17 34 17-34 16Z" fill="#d5c5a6"/>'+[17,35,53].map((x,i)=>'<path d="M'+x+' 27v15h13V27Z" fill="#c3a580"/><path d="m'+(x-2)+' 28 9-8 10 8Z" fill="'+(i%2?'#d7bd91':'#b78e87')+'"/>').join('');
  else if(t.form==='platform')shape='<path d="m9 40 34-16 35 15-35 17Z" fill="#c6b18c"/><path d="m14 38 29-14 29 14 M14 30v13m29-27v14m29 0v13" stroke="#927b59" stroke-width="3" fill="none"/>';
  else if(type==='play')shape='<path d="m9 40 34-16 35 15-35 17Z" fill="#b7c999"/><path d="M24 36V15h13v21 M24 20h13m-13 6h13m0-11 25 28" stroke="#9d8766" stroke-width="4" fill="none"/>';
  else if(t.model==='field')shape='<path d="m12 33 34-16 30 14-34 18Z" fill="'+t.wall+'"/><path d="m24 30 30 12m-19-17 30 12m-18-18 30 12" stroke="'+t.roof+'" stroke-width="2"/>';
  else if(t.model==='landscape')shape='<path d="m12 35 30-13 30 13-30 13Z" fill="'+t.wall+'"/><path d="M28 30v9m25-14v14" stroke="#8b765d" stroke-width="3"/><circle cx="28" cy="26" r="9" fill="'+t.roof+'"/><circle cx="53" cy="24" r="10" fill="#9aaf78"/>';
  else shape='<path d="m19 23 25-11 23 11v17L43 51 19 39Z" fill="'+t.wall+'"/><path d="m15 24 28-20 28 20-28 13Z" fill="'+t.roof+'"/><path d="m37 36 10-4v16l-10 4Z" fill="#9a7c5e"/><path d="m23 29 8 4v8l-8-4Z" fill="#f7f2da"/>';
  if(t.model==='commerce'&&t.form==='building')shape+='<path d="m18 35 25 12 26-12v5L43 52 18 40Z" fill="#f0debc"/>';
  if(type==='ancestral')shape+='<path d="M23 39v9m38-10v9" stroke="#a25f4b" stroke-width="3"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 86 58" aria-hidden="true">'+shape+'</svg>';
 }
 function layoutBadges(points,selectedId,spacing=32){
  const accepted=[],visible=new Set();
  const ranked=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).slice().sort((a,b)=>(a.id===selectedId?-100:a.type==='home'?10:0)-(b.id===selectedId?-100:b.type==='home'?10:0));
  for(const p of ranked){if(accepted.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=spacing)){accepted.push(p);visible.add(p.id);}}
  return visible;
 }
 function placeBadges(points,selectedId,spacing=32,bounds={}){
  const result=[],rank=p=>p.id===selectedId?-100:p.type==='home'?10:0,valid=p=>p.x>=15&&p.y>=15&&(!bounds.width||p.x<=bounds.width-15)&&(!bounds.height||p.y<=bounds.height-15),free=p=>valid(p)&&result.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=spacing);
  for(const p of points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).slice().sort((a,b)=>rank(a)-rank(b))){let q={...p,anchorX:p.x,anchorY:p.y};if(!free(q)){if(p.type==='home'&&p.id!==selectedId)continue;let found=null;for(let ring=1;ring<=12&&!found;ring++)for(let i=0;i<16;i++){const angle=i*Math.PI/8,candidate={...q,x:p.x+Math.cos(angle)*ring*spacing,y:p.y+Math.sin(angle)*ring*spacing};if(free(candidate)){found=candidate;break;}}if(found)q=found;else continue;}result.push(q);}
  return result;
 }
 return {CATEGORIES,info,structure,svg,image,billboardImage,drawIcon,preview,layoutBadges,placeBadges};
});
