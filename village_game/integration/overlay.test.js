const test=require('node:test'),assert=require('node:assert/strict'),Overlay=require('./overlay');
const Adapter=require('./plan-adapter'),{fixture}=require('./tests/fixtures');
test('map selection resolves original 3D buildings, native scene components and ground facility polygons before assignment',()=>{
 const f=fixture(),items=Adapter.catalog(f.document,f.context);items[0].properties.sourceCode='house-code';
 assert.equal(Adapter.pickSource({id:{__sourceCode:'house-code'}},null,items).key,'baseline:house');
 assert.equal(Adapter.pickSource({id:{properties:{sourceObjectId:{getValue:()=> 'bench'}}}},null,items).key,'object:bench');
 assert.equal(Adapter.pickSource(null,[113.0007,23.0003],items).key,'object:square');
 assert.equal(Adapter.pickSource(null,[113.002,23.002],items),null);
});
test('clicking the second part of a multipolygon building selects that part, not the first code match',()=>{
 const f=fixture(),g=f.context.baselineFeatures[0].geometry;
 f.context.baselineFeatures[0].geometry={type:'MultiPolygon',coordinates:[g.coordinates,g.coordinates.map(r=>r.map(p=>[p[0]+.0005,p[1]]))]};
 f.context.baselineFeatures[0].properties.sourceCode='shared-building';
 const items=Adapter.catalog(f.document,f.context),picked={id:{__sourceCode:'shared-building'}};
 assert.equal(Adapter.pickSource(picked,[113.00055,23.00015],items).key,'baseline:house:1');
});
test('platform overlay reuses the viewer, anchors feet to terrain, preserves indoor markers and cleans up on exit',()=>{
 const entities=[],events={};let destroyed=false;
 class Vector{constructor(x,y,z){Object.assign(this,{x,y,z});}}
 const C={Cartesian3:{fromDegrees:(...v)=>v,fromDegreesArray:v=>v},Cartesian2:Vector,Color:{fromCssColorString:s=>({s,withAlpha(){return this;}})},HeightReference:{CLAMP_TO_GROUND:3},VerticalOrigin:{BOTTOM:1},HorizontalOrigin:{CENTER:0},ScreenSpaceEventType:{LEFT_CLICK:0},ScreenSpaceEventHandler:class{setInputAction(fn,type){events[type]=fn;}destroy(){destroyed=true;}}};
 const viewer={scene:{canvas:{},requestRender(){},pick(){}},entities:{add:e=>(entities.push(e),e),remove(e){entities.splice(entities.indexOf(e),1);}}};
 let sourceRemoved=false;C.CustomDataSource=class{constructor(){this.entities=viewer.entities;}};viewer.dataSources={add:s=>s,remove(s,destroy){sourceRemoved=destroy;return true;}};
 const overlay=Overlay.create({Cesium:C,viewer,pickGround:()=>[113,23,0]}),plan={projection:{toDegrees:p=>p},scene:{buildings:[],roads:[],scenario:{entry:[113,23]}}};overlay.setPlan(plan);
 let entry=entities.find(e=>e.simulationEntry);assert.ok(entry,'the checked plan has a persistent village entry');
 assert.equal(entry.label.show,true);assert.equal(entry.label.disableDepthTestDistance,Infinity);
 overlay.setSources([],{assignments:[],entry:[113,23]},'');entry=entities.find(e=>e.simulationEntry);
 assert.ok(entry,'the entry remains visible in configuration even when compilation fails');assert.deepEqual(entry.position,[113,23]);
 overlay.setSources([],{assignments:[],entry:[113.001,23]},'');assert.equal(entities.filter(e=>e.simulationEntry).length,1);assert.deepEqual(entities.find(e=>e.simulationEntry).position,[113.001,23]);
 plan.scene.buildings=[{id:'f',sourceKey:'baseline:house',entrance:[113,23],type:'home',name:'家'}];
 plan.network={connected:{f:false},accessDiagnostics:{f:{reason:'too-far',point:[113,23],roadPoint:[113.001,23],distance:100}}};
 overlay.setPlan(plan);assert.ok(entities.some(e=>e.simulationConnection==='too-far'),'show the rejected connection as a diagnostic, not a network edge');
 assert.ok(entities.some(e=>e.simulationEntrance==='baseline:house'));
 const a={id:'a',name:'居民',kind:'resident',ageGroup:'child',state:'moving',x:113,y:23,indoor:false};overlay.render({agents:[a],minute:500,progress:0},plan);const actor=entities.find(e=>e.simulationPerson);assert.equal(actor.billboard.verticalOrigin,1);assert.equal(actor.billboard.pixelOffset.y,0);assert.equal(actor.billboard.heightReference,3);assert.equal(actor.billboard.disableDepthTestDistance,0);
 overlay.render({agents:[{...a,indoor:true}],minute:501,progress:0},plan);assert.equal(actor.billboard.show,false);assert.equal(actor.point.show,true);assert.equal(actor.point.disableDepthTestDistance,Infinity);
 overlay.dispose();assert.equal(entities.length,0);assert.equal(destroyed,true);assert.equal(sourceRemoved,true,'destroy the owned datasource so clamped graphics cannot survive the simulation');
});
