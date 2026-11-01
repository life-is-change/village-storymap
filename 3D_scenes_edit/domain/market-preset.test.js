const test=require('node:test'),assert=require('node:assert/strict');
const G=require('./geometry-rules'),D=require('./scene-document'),C=require('./scene-commands'),E=require('../map_2d/scene-editor-controller');
const P=require('./market-preset');
const origin=[113,23],polygon=(w=20,h=16)=>({type:'Polygon',coordinates:[[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2],[-w/2,-h/2]].map(p=>G.fromLocalMeters(p,origin))]});
const field=()=>({id:'field',kind:'surface',category:'activity-field',geometry:polygon(),properties:{},layerId:'design',groupId:null,zIndex:0});
function controller(options={}){const d=D.create({projectId:"p",villageId:"v",groupId:"g",spaceId:"s"});d.objects=[field()];let n=0;return E.createSceneEditorController({adapter:{render(){}},geometryRules:G,idFactory:()=> 'm'+ ++n,history:C.createHistory(d),...options});}
test('one editable preset keeps the field, six stalls and aisles in one undo unit',()=>{
 const c=controller();c.select(['field']);const before=c.getState().document;
 const r=c.placeMorningMarket();assert.equal(r.ok,true,JSON.stringify(r));const d=c.getState().document;
 assert.equal(d.objects.filter(o=>o.category==='activity-field').length,1);
 const stalls=d.objects.filter(o=>o.category==='stall');assert.equal(stalls.length,6);assert.equal(new Set(stalls.map(o=>o.id)).size,6);
 assert.deepEqual(stalls.map(o=>o.properties.produceKind),['vegetables','vegetables','vegetables','vegetables','fruit','tofu']);
 assert.ok(d.objects.filter(o=>o.kind==='line').length>=2);assert.equal(d.assetRefs.length,3);
 assert.ok(d.objects.every(o=>o.properties.marketId===r.marketId));assert.ok(D.validate(d).ok,JSON.stringify(D.validate(d)));
 c.undo();assert.deepEqual(c.getState().document,before);c.redo();assert.deepEqual(c.getState().document,d);
 assert.equal(c.placeMorningMarket().ok,false);
});
test('invalid market placement writes nothing for small field, village boundary or existing building',()=>{
 for(const options of [{villageBoundary:polygon(10,10)},{baselineBuildings:[polygon(2,2)]}]){const c=controller(options);c.select(['field']);const before=JSON.stringify(c.getState().document);assert.equal(c.placeMorningMarket().ok,false);assert.equal(JSON.stringify(c.getState().document),before);}
 assert.equal(P.createMarketPreset({field:{...field(),geometry:polygon(8,8)},idPrefix:'small'}).ok,false);
});
test('preset command rejects duplicate IDs atomically without changing history',()=>{
 const d=D.create({});d.objects=[field()];const p=P.createMarketPreset({field:field(),idPrefix:'x'});assert.equal(p.ok,true);
 const h=C.execute(C.createHistory(d),p.command);assert.throws(()=>C.execute(h,p.command),/market|重复/i);assert.equal(h.past.length,1);
});
