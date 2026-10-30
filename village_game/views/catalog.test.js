const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('../domain/scene');
let Catalog;try{Catalog=require('./catalog');}catch{}
test('each facility has exactly one construction category and a semantic vector badge',()=>{
 assert.ok(Catalog,'shared catalog is missing');const seen=[];
 for(const c of Catalog.CATEGORIES){assert.ok(c.label&&c.color);seen.push(...c.types);}
 assert.equal(seen.length,new Set(seen).size);
 for(const type of Object.keys(Scene.TYPES)){assert.equal(seen.filter(t=>t===type).length,1);const info=Catalog.info(type);assert.ok(info.category&&info.model);assert.match(Catalog.svg(type),/<svg/);assert.match(Catalog.image(type),/^data:image\/svg\+xml/);}
 assert.notEqual(Catalog.image('home'),Catalog.image('food'));assert.notEqual(Catalog.image('home'),Catalog.image('home',true));
});
test('same-function facilities use the same badge/model family and construction cards have previews',()=>{
 assert.ok(Catalog);assert.equal(Catalog.info('home').model,Catalog.info('inn').model);
 for(const type of ['home','food','farm','park','school','kindergarten','ancestral']){assert.match(Catalog.preview(type),/<svg/);assert.ok(Catalog.info(type).unit);}
});
test('dense projected badges keep selected facilities without overlapping or changing world data',()=>{
 assert.ok(Catalog);const positions=[{id:'a',type:'home',x:20,y:20},{id:'b',type:'food',x:25,y:22},{id:'c',type:'school',x:150,y:100},{id:'d',type:'park',x:NaN,y:50}];const old=JSON.stringify(positions);
 const ids=Catalog.layoutBadges(positions,'a',32);assert.ok(ids.has('a'));assert.ok(!ids.has('b'));assert.ok(ids.has('c'));assert.ok(!ids.has('d'));assert.equal(JSON.stringify(positions),old);
 assert.ok(Catalog.layoutBadges(positions,null,32).has('b'));
});

test('browser billboards use an already painted canvas rather than an SVG texture placeholder',()=>{const fs=require('fs'),vm=require('vm'),calls=[];const ctx=new Proxy({},{get:(o,k)=>()=>calls.push(k)}),canvas={getContext:()=>ctx};const root={document:{createElement:()=>canvas},Path2D:class{},globalThis:null};root.globalThis=root;vm.runInNewContext(fs.readFileSync(__dirname+'/catalog.js','utf8'),root);assert.equal(typeof root.VillageCatalog.billboardImage,'function');const image=root.VillageCatalog.billboardImage('school');assert.equal(image,canvas);assert.equal(canvas.width,80);assert.equal(canvas.height,80);assert.ok(calls.includes('stroke'));});

test('space structures distinguish outdoor places, temporary stalls and hall forecourts',()=>{
 assert.equal(typeof Catalog.structure,'function');for(const type of ['park','play','farm','attraction','night']){const b=Scene.createBuilding(type,0,0,'test'),s=Catalog.structure(b);assert.equal(s.body,null,type+' must not be a tall opaque house');assert.ok(s.parts.length);assert.ok(Catalog.info(type).formLabel);}
 const hall=Catalog.structure(Scene.createBuilding('ancestral',0,0,'hall'));assert.ok(hall.body.d<20);assert.ok(hall.parts.some(p=>p.role==='gate'));const k=Catalog.structure(Scene.createBuilding('kindergarten',0,0,'k'));const activity=k.parts.find(p=>p.role==='activity');assert.ok(activity.y-activity.d/2>=k.body.y+k.body.d/2);
 const market=Catalog.structure(Scene.createBuilding('night',0,0,'m'));assert.equal(market.parts.filter(p=>p.role==='awning').length,4);assert.notEqual(Catalog.preview('night'),Catalog.preview('shop'));assert.notEqual(Catalog.preview('play'),Catalog.preview('park'));
});
test('all public badges survive dense layouts with displaced positions while homes remain lower priority',()=>{
 assert.equal(typeof Catalog.placeBadges,'function');const points=[{id:'farm',type:'farm',x:100,y:100},{id:'meal',type:'meal',x:101,y:100},{id:'night',type:'night',x:102,y:100},{id:'home',type:'home',x:100,y:100}];const copy=JSON.stringify(points),placed=Catalog.placeBadges(points,null,32,{width:300,height:240});for(const p of points.filter(p=>p.type!=='home'))assert.ok(placed.some(q=>q.id===p.id));for(const [i,p] of placed.entries())for(const q of placed.slice(i+1))assert.ok(Math.hypot(p.x-q.x,p.y-q.y)>=32);assert.equal(JSON.stringify(points),copy);assert.ok(Catalog.placeBadges(points,'home',32,{width:300,height:240}).some(p=>p.id==='home'));
});
