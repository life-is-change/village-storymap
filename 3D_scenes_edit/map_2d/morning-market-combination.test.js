const test=require('node:test'),assert=require('node:assert/strict');
const Doc=require('../domain/scene-document'),Commands=require('../domain/scene-commands'),G=require('../domain/geometry-rules'),Editor=require('./scene-editor-controller');
const assets=[...require('../assets/seed/catalog.json').assets,...require('../assets/curated/catalog.json').assets];
const origin=[113.5,23.1],template=assets.find(a=>a.id==='seed:combo:morning-market');
const polygon=m=>({type:'Polygon',coordinates:[[[-m,-m],[m,-m],[m,m],[-m,m],[-m,-m]].map(p=>G.fromLocalMeters(p,origin))]});
function setup(){let i=0;return Editor.createSceneEditorController({history:Commands.createHistory(Doc.create({projectId:'p',villageId:'v',groupId:'g',spaceId:'s'})),adapter:{render(){}},geometryRules:G,idFactory:()=>`item-${++i}`,villageBoundary:polygon(100)});}
test('morning market drops directly onto village map with six editable stalls, aisles and simulation ownership',()=>{
 assert.ok(template);const c=setup(),r=c.createComponent(template,origin,assets);assert.equal(r.ok,true);
 const d=c.getState().document,field=d.objects.find(o=>o.category==='activity-field'),stalls=d.objects.filter(o=>o.category==='stall'),aisles=d.objects.filter(o=>o.category==='path');
 assert.equal(d.selectionBoundary,null);assert.equal(stalls.length,6);assert.equal(aisles.length,2);assert.equal(field.properties.marketId,field.id);assert.ok(field.properties.marketGate);
 assert.ok(stalls.concat(aisles).every(o=>o.properties.marketId===field.id&&o.properties.siteId===field.id));assert.equal(new Set(stalls.map(o=>o.properties.stallStyle)).size,3);
 assert.equal(d.groups.length,1);assert.equal(d.groups[0].objectIds.length,9);assert.equal(Doc.validate(JSON.parse(JSON.stringify(d))).ok,true);
 c.undo();assert.equal(c.getState().document.objects.length,0);c.redo();assert.equal(c.getState().document.objects.length,9);
});
test('mixed geometry market moves, rotates, duplicates and ungroups while preserving internal ownership',()=>{
 const c=setup();assert.equal(c.createComponent(template,origin,assets).ok,true);let d=c.getState().document;
 c.selectGroup(d.groups[0].id);const stall=d.objects.find(o=>o.category==='stall');assert.equal(c.moveObject(stall.id,G.fromLocalMeters([8,3],stall.geometry.coordinates)).ok,true);assert.equal(c.rotateSelection(45).ok,true);
 c.duplicateSelection();d=c.getState().document;assert.equal(d.groups.length,2);
 for(const group of d.groups){const objects=d.objects.filter(o=>o.groupId===group.id),field=objects.find(o=>o.category==='activity-field');assert.equal(field.properties.marketId,field.id);assert.ok(objects.filter(o=>o!==field).every(o=>o.properties.siteId===field.id&&o.properties.marketId===field.id&&G.containsGeometry(field.geometry,o.geometry)));}
 c.ungroupSelection();assert.equal(c.getState().document.groups.length,1);
});
test('market direct placement respects village boundary, optional chosen site and locked site atomically',()=>{
 const c=setup();assert.equal(c.createComponent(template,G.fromLocalMeters([99,0],origin),assets).ok,false);assert.equal(c.getState().document.objects.length,0);
 const site=c.createObject({kind:'surface',category:'activity-field',geometry:polygon(15)}).object;c.setPlacementSite(site.id);
 assert.equal(c.createComponent(template,G.fromLocalMeters([14,0],origin),assets).code,'OUTSIDE_SITE');assert.equal(c.getState().document.objects.length,1);
 assert.equal(c.createComponent(template,origin,assets).ok,true);
 c.setLayerLocked('design',true);assert.equal(c.createComponent(template,origin,assets).code,'LAYER_LOCKED');assert.equal(c.getState().document.objects.length,10);
});
test('market combination passes the persistent document contract',async()=>{
 const c=setup();c.createComponent(template,origin,assets);const d=structuredClone(c.getState().document);
 d.projectId='10000000-0000-4000-8000-000000000001';d.villageId='20000000-0000-4000-8000-000000000001';
 const {validateDocument}=await import('../../business-api/scene/contracts.mjs');assert.doesNotThrow(()=>validateDocument(d));
});
test('refreshing an auto-created market retains a valid editable group and undoes as one step',()=>{
 const c=setup();c.createComponent(template,origin,assets);const before=JSON.stringify(c.getState().document),field=c.getState().document.objects.find(o=>o.category==='activity-field');
 c.select([field.id]);assert.equal(c.placeMorningMarket(assets,{replace:true}).ok,true);
 const d=c.getState().document;assert.equal(Doc.validate(d).ok,true);assert.ok(d.objects.every(o=>o.groupId===d.groups[0].id));
 assert.deepEqual(new Set(d.groups[0].objectIds),new Set(d.objects.map(o=>o.id)));c.undo();assert.equal(JSON.stringify(c.getState().document),before);
});
test('regular combinations also place without a drawn selection boundary',()=>{
 const c=setup();assert.equal(c.createComponent(assets.find(a=>a.id==='seed:curated:combo-small-market'),origin,assets).ok,true);
});
