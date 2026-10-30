const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Scene=require('../domain/scene'),Network=require('../domain/network'),Editor=require('../domain/editor');

// Substitute the GPU boundary; exercise the actual view's entity creation/cache.
function renderer(sync=false){
  const entities=[],handlers={};let pickStack=[];class Vector{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
  const C={Cartesian3:Vector,Cartesian2:Vector,VerticalOrigin:{BOTTOM:1},HorizontalOrigin:{CENTER:0},EllipsoidTerrainProvider:class{},Matrix4:class{},Plane:class{},HeadingPitchRoll:class{},HeadingPitchRange:class{},PolylineDashMaterialProperty:class{},ArcType:{NONE:0},ScreenSpaceEventType:{LEFT_CLICK:0,MOUSE_MOVE:1},ScreenSpaceEventHandler:class{setInputAction(fn,type){handlers[type]=fn;}destroy(){}}};
  C.Cartesian3.fromDegrees=()=>new Vector(6378137);C.Cartesian3.magnitude=()=>6378137;C.Cartesian3.normalize=p=>p;
  C.Matrix4.multiplyByPoint=(f,p,out)=>Object.assign(out,p);C.Matrix4.inverseTransformation=()=>({});C.Matrix4.IDENTITY={};
  C.Transforms={eastNorthUpToFixedFrame:()=>({}),headingPitchRollQuaternion:()=>({})};
  C.Color={fromCssColorString:()=>({withAlpha(){return this;}}),WHITE:{}};
  if(sync){for(const name of ['Primitive','GeometryInstance','CoplanarPolygonGeometry','PolygonHierarchy','PerInstanceColorAppearance'])C[name]=class{constructor(options){Object.assign(this,options);}};C.ColorGeometryInstanceAttribute={fromColor:c=>c};}
  C.Viewer=class{constructor(){this.entities={add(e){entities.push(e);return e;},remove(e){const i=entities.indexOf(e);if(i>=0)entities.splice(i,1);}};this.scene={pick:()=>({id:{gameKind:'agent',gameId:'resident-at-meal'}}),drillPick:()=>pickStack,primitives:{add(e){entities.push(e);return e;},remove(e){const i=entities.indexOf(e);if(i>=0)entities.splice(i,1);}},globe:{},screenSpaceCameraController:{},requestRender(){},canvas:{}};this.camera={lookAt(){},lookAtTransform(){}};}};
  const root={Cesium:C},context=vm.createContext({window:root,VillageCharacters:require('./characters'),VillageCatalog:require('./catalog'),VillageScene:Scene,VillageNetwork:Network,VillageEditor:Editor,VillageObservation:require('./observation')});
  vm.runInContext(fs.readFileSync(__dirname+'/scene3d.js','utf8'),context);return {create:root.VillageScene3D.create,entities,click:position=>handlers[0]({position}),setPickStack:items=>pickStack=items};
}
test('a different imported scene with the same revision rebuilds visible 3D entities',async()=>{
  const gpu=renderer(),view=await gpu.create({},{}),scene=Scene.createVillage(),ui={white:false,labels:true,selected:null};
  view.render(scene,null,ui,Network.buildNetwork(scene));assert.ok(gpu.entities.some(e=>e.label?.text==='溪田小食堂'));
  const imported=Scene.clone(scene);imported.buildings[14].name='另一份同版本方案';imported.buildings[14].x+=5;
  view.render(imported,null,ui,Network.buildNetwork(imported));
  assert.ok(gpu.entities.some(e=>e.label?.text==='另一份同版本方案'));
  assert.ok(!gpu.entities.some(e=>e.label?.text==='溪田小食堂'));
});

test('overview hides house labels while local focus and selection update labels without rebuilding the scene',async()=>{
 const gpu=renderer(),view=await gpu.create({},{}),scene=Scene.createVillage(),net=Network.buildNetwork(scene),ui={labels:true,white:false,selected:null};
 view.render(scene,null,ui,net);let home=gpu.entities.find(e=>e.label?.text==='溪畔民居 1');assert.equal(home.label.show,false);
 ui.selected={kind:'building',id:'home-1'};view.render(scene,null,ui,net);assert.equal(home.label.show,true);
 ui.selected=null;ui.focusPoint=[185,145];view.render(scene,null,ui,net);const far=gpu.entities.find(e=>e.label?.text==='溪边观景亭');assert.equal(far.label.show,false);
});

test('ground and road polygons use supported polygon arcs so Cesium can build their surfaces',async()=>{const gpu=renderer(),view=await gpu.create({},{}),s=Scene.createIdealVillage();view.render(s,null,{labels:true,white:false},Network.buildNetwork(s));const flat=gpu.entities.filter(e=>e.polygon&&e.polygon.perPositionHeight);assert.ok(flat.length>20);assert.ok(flat.every(e=>e.polygon.arcType!==0));});

test('local roads and roofs build without asynchronous geometry workers',async()=>{const gpu=renderer(true),view=await gpu.create({},{}),s=Scene.createIdealVillage();view.render(s,null,{labels:true,white:false},Network.buildNetwork(s));const surfaces=gpu.entities.filter(e=>e.geometryInstances);assert.ok(surfaces.some(e=>e.geometryInstances.id.gameKind==='road'));assert.ok(surfaces.some(e=>e.geometryInstances.id.gameKind==='building'));assert.ok(surfaces.every(e=>e.asynchronous===false));});

test('facility badges are selectable when labels are off and change immediately after repurposing',async()=>{const gpu=renderer(),view=await gpu.create({},{}),s=Scene.createIdealVillage(),ui={labels:false,icons:true,white:false};view.render(s,null,ui,Network.buildNetwork(s));const badge=gpu.entities.find(e=>e.gameId==='home-1'&&e.billboard);assert.ok(badge);assert.equal(badge.gameKind,'building');assert.match(badge.billboard.image,/svg/);const before=badge.billboard.image;const changed=Scene.clone(s);changed.buildings.find(b=>b.id==='home-1').type='food';changed.revision++;view.render(changed,null,ui,Network.buildNetwork(changed));assert.notEqual(gpu.entities.find(e=>e.gameId==='home-1'&&e.billboard).billboard.image,before);});

test('outdoor structures have no full height opaque block and market awnings follow opening time',async()=>{
 const gpu=renderer(),view=await gpu.create({},{}),s=Scene.createIdealVillage(),ui={labels:false,icons:true,white:false};view.render(s,{minute:360,agents:[],facilities:{}},ui,Network.buildNetwork(s));
 for(const b of s.buildings.filter(b=>['play','park','farm','attraction','night'].includes(b.type)))assert.ok(!gpu.entities.some(e=>e.gameId===b.id&&e.box&&e.box.dimensions.x===b.width&&e.box.dimensions.y===b.depth&&e.box.dimensions.z>=b.height&&e.box.dimensions.z>1));
 const market=gpu.entities.filter(e=>e.gameId==='night-market'&&e.spacePart==='awning');assert.equal(market.length,4);assert.ok(market.every(e=>e.show===false));view.render(s,{minute:1170,agents:[],facilities:{}},ui,Network.buildNetwork(s));assert.ok(market.every(e=>e.show===true));
});
test('clicking a projected facility badge selects the facility even when an indoor person overlaps it',async()=>{const gpu=renderer(),s=Scene.createIdealVillage();let selected;const view=await gpu.create({},{onSelect:item=>selected=item});view.render(s,null,{tool:'select',icons:true,labels:false},Network.buildNetwork(s));const meal=s.buildings.find(b=>b.id==='community-meal');gpu.click({x:meal.x,y:meal.y});assert.equal(selected.kind,'building');assert.equal(selected.id,meal.id);});
test('GPU badge under an indoor person remains selectable when cached screen coordinates are stale',async()=>{const gpu=renderer(),s=Scene.createIdealVillage();let selected;const view=await gpu.create({},{onSelect:item=>selected=item});view.render(s,null,{tool:'select',icons:true,labels:false},Network.buildNetwork(s));const badge=gpu.entities.find(e=>e.gameId==='community-meal'&&e.billboard);gpu.setPickStack([{id:{gameKind:'agent',gameId:'resident-at-meal'}},{id:badge}]);gpu.click({x:1,y:1});assert.equal(selected.kind,'building');assert.equal(selected.id,'community-meal');});
test('living 3D actors use the same original character as 2D and retain indoor location markers',async()=>{const gpu=renderer(),s=Scene.createLivingVillage(),view=await gpu.create({},{}),a={id:'test-person',kind:'visitor',profile:'day',state:'moving',x:40,y:40,indoor:false};view.render(s,{agents:[a],minute:600,progress:0,roadFlows:{},facilities:{}},{tool:'select',icons:true,labels:false},Network.buildNetwork(s));const entity=gpu.entities.find(e=>e.gameId===a.id);assert.equal(entity.point.show,false);assert.equal(entity.billboard.image,require('./characters').image(a,2400));view.render(s,{agents:[{...a,indoor:true,state:'serving'}],minute:610,progress:0,roadFlows:{},facilities:{}},{tool:'select'},Network.buildNetwork(s));assert.equal(entity.point.show,true);assert.equal(entity.billboard.show,false);});

test('outdoor character feet stay on the road when age, pose or selection changes',async()=>{
 const gpu=renderer(),s=Scene.createLivingVillage(),view=await gpu.create({},{}),net=Network.buildNetwork(s);
 for(const ageGroup of ['adult','child','senior'])for(const state of ['moving','resting','working'])for(const selected of [false,true]){
  const a={id:'grounded',kind:'resident',ageGroup,state,x:120,y:80,indoor:false};
  view.render(s,{agents:[a],minute:600,progress:0,roadFlows:{},facilities:{}},{selected:selected?{kind:'agent',id:a.id}:null},net);
  const e=gpu.entities.find(e=>e.gameId===a.id);
  assert.ok(e.position.z>=.4&&e.position.z<=.5,'feet must sit just above the 0.4m road surface');
  assert.equal(e.billboard.verticalOrigin,1,'anchor the foot rather than the image centre');
  assert.equal(e.billboard.horizontalOrigin,0);
  assert.equal(e.billboard.pixelOffset.y,0,'resizing must not move the foot point');
  assert.equal(e.billboard.disableDepthTestDistance,0,'buildings must be able to occlude a person behind them');
  assert.ok(e.label.pixelOffset.y < -e.billboard.height,'the name must sit above the head');
  const svg=decodeURIComponent(e.billboard.image.split(',')[1]),bounds=svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(Math.abs(e.billboard.width/e.billboard.height-Number(bounds[1])/Number(bounds[2]))<.001,'preserve the sprite aspect ratio');
 }
});
