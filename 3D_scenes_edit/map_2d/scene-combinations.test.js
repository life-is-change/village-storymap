const test=require('node:test'),assert=require('node:assert/strict');
const Doc=require('../domain/scene-document'),Commands=require('../domain/scene-commands'),G=require('../domain/geometry-rules'),Editor=require('./scene-editor-controller');
const catalog=require('../assets/curated/catalog.json').assets;
const origin=[113.5,23.1];
function square(m){return {type:'Polygon',coordinates:[[[-m,-m],[m,-m],[m,m],[-m,m],[-m,-m]].map(p=>G.fromLocalMeters(p,origin))]};}
function setup(){let n=0;const d=Doc.create({projectId:'p',villageId:'v',groupId:'g',spaceId:'s'});d.selectionBoundary=square(100);return Editor.createSceneEditorController({history:Commands.createHistory(d),adapter:{render(){}},geometryRules:G,idFactory:()=>`o-${++n}`,villageBoundary:square(200)});}
const combo=catalog.find(a=>a.kind==='group');
test('combination creates editable children and a group with one undo, redo and JSON reload',()=>{
 const c=setup(),r=c.createComponent(combo,origin,catalog);assert.equal(r.ok,true);
 let d=c.getState().document;assert.equal(d.objects.length,combo.children.length);assert.equal(d.groups.length,1);assert.equal(Doc.validate(d).ok,true);
 assert.equal(Doc.validate(JSON.parse(JSON.stringify(d))).ok,true);
 c.undo();assert.equal(c.getState().document.objects.length,0);c.redo();assert.equal(c.getState().document.objects.length,combo.children.length);
 c.selectGroup(d.groups[0].id);c.ungroupSelection();assert.equal(c.getState().document.groups.length,0);assert.ok(c.getState().document.objects.every(o=>!o.groupId));
});
test('out of bounds or locked group placement is atomic including child footprints',()=>{
 const c=setup();assert.equal(c.createComponent(combo,G.fromLocalMeters([199,0],origin),catalog).ok,false);assert.equal(c.getState().document.objects.length,0);
 c.setLayerLocked('design',true);assert.equal(c.createComponent(combo,origin,catalog).code,'LAYER_LOCKED');assert.equal(c.getState().document.objects.length,0);
});
test('group selection moves and rotates around its center, duplicate retains new group and single-child editing stays independent',()=>{
 const c=setup();c.createComponent(combo,origin,catalog);let d=c.getState().document,first=d.objects[0];c.selectGroup(d.groups[0].id);
 const before=d.objects.map(o=>o.geometry.coordinates);assert.equal(c.moveObject(first.id,G.fromLocalMeters([3,4],before[0])).ok,true);
 d=c.getState().document;for(let i=0;i<before.length;i++){const delta=G.toLocalMeters(d.objects[i].geometry.coordinates,before[i]);assert.ok(Math.abs(delta[0]-3)<.01&&Math.abs(delta[1]-4)<.01);}
 assert.equal(c.rotateSelection(90).ok,true);c.duplicateSelection();d=c.getState().document;assert.equal(d.groups.length,2);assert.equal(d.objects.length,combo.children.length*2);assert.notEqual(d.groups[0].id,d.groups[1].id);
 const child=d.objects[0];c.select([child.id]);c.moveObject(child.id,origin);assert.equal(c.getState().selectedIds.length,1);
});
test('placing stalls in a market inherits ownership while cart remains decorative',()=>{
 const c=setup(),field=c.createObject({kind:'surface',category:'activity-field',geometry:square(50),properties:{displayName:'早市'}}).object;
 c.select([field.id]);c.updateSelection({properties:{marketId:field.id}});c.setPlacementSite(field.id);
 const t=catalog.find(a=>a.id==='seed:curated:combo-small-market');assert.equal(c.createComponent(t,origin,catalog).ok,true);
 const items=c.getState().document.objects.filter(o=>o.id!==field.id);assert.ok(items.every(o=>o.properties.siteId===field.id));assert.ok(items.some(o=>o.category==='stall'&&o.properties.marketId===field.id));assert.ok(items.filter(o=>o.category!=='stall').every(o=>o.properties.marketRole!=='stall'));
});
test('combination document passes the real Aliyun save contract without enabling arbitrary asset URLs',async()=>{
 const c=setup();c.createComponent(combo,origin,catalog);const d=structuredClone(c.getState().document);
 d.projectId='10000000-0000-4000-8000-000000000001';d.villageId='20000000-0000-4000-8000-000000000001';
 const {validateDocument}=await import('../../business-api/scene/contracts.mjs');
 assert.doesNotThrow(()=>validateDocument(d));
});
test('locked child prevents ungrouping and preserves the original group',()=>{
 const c=setup();c.createComponent(combo,origin,catalog);const d=c.getState().document;
 c.selectGroup(d.groups[0].id);c.setLayerLocked('design',true);
 assert.equal(c.ungroupSelection().code,'LAYER_LOCKED');assert.equal(c.getState().document.groups.length,1);
});
test('individual child move and scale cannot escape its assigned site footprint',()=>{
 const c=setup(),site=c.createObject({kind:'surface',category:'activity-field',geometry:square(25)}).object;c.setPlacementSite(site.id);c.createComponent(combo,origin,catalog);
 const item=c.getState().document.objects.find(o=>o.category==='table');c.select([item.id]);
 const before=JSON.stringify(c.getState().document);
 assert.equal(c.moveObject(item.id,G.fromLocalMeters([24.99,0],origin)).code,'OUTSIDE_SITE');
 assert.equal(JSON.stringify(c.getState().document),before);
 assert.equal(c.updateSelection({transform:{scale:[200,200,200]}}).code,'OUTSIDE_SITE');
 assert.equal(JSON.stringify(c.getState().document),before);
});
test('2D footprint uses the same clockwise heading as the curated GLB and its top view',()=>{
 const c=setup();c.createComponent(combo,origin,catalog);const d=structuredClone(c.getState().document),o=d.objects[0];o.transform.headingDeg=35;
 const {buildFeatureDescriptors}=require('./scene-layer-adapter');
 const actual=buildFeatureDescriptors(d,{}).find(f=>f.role==='footprint'&&f.objectId===o.id).geometry;
 assert.deepEqual(actual,G.rotatedFootprint(o.geometry.coordinates,{widthM:o.properties.footprintM[0],depthM:o.properties.footprintM[1]},-35));
});
