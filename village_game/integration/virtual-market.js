(function(root,factory){const c=typeof module==='object'&&module.exports,api=factory(c?require('./plan-adapter'):null,c?require('../../3D_scenes_edit/domain/geometry-rules'):root.SceneGeometryRulesModule,c?require('../../3D_scenes_edit/domain/market-preset'):root.SceneMarketPreset,c?require('../../3D_scenes_edit/domain/scene-document'):root.SceneDocumentModule,c?require('../domain/scene'):root.VillageScene);if(c)module.exports=api;if(root)root.VillageVirtualMarket=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Adapter,G,P,D,Scene){
 'use strict';
 const templates=new Map(),KEY='village-virtual-morning-market-v1:',adapter=()=>Adapter||globalThis.VillagePlanAdapter;
 function build(scene){
  const A=adapter(),half=scene.size.map(n=>n/2),geo=p=>G.fromLocalMeters(p.map((n,i)=>n-half[i]),[0,0]);
  const polygon=points=>({type:'Polygon',coordinates:[points.map(geo)]});
  const boundary=polygon([[0,0],[scene.size[0],0],scene.size,[0,scene.size[1]],[0,0]]);
  function footprint(b){if(b.footprint)return polygon(b.footprint);const a=(b.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return polygon([[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x,y])=>[b.x+x*b.width/2*c-y*b.depth/2*s,b.y+x*b.width/2*s+y*b.depth/2*c]));}
  const homes=scene.buildings.filter(b=>b.type==='home'),available=homes.reduce((n,b)=>n+Math.min(12,Scene.capacity(b)),0);
  if(available<18)return {ok:false,errors:['早市教学情境需要至少18人的已定义住宅容量；原虚拟村庄设计保留，请先补充住宅。']};
  const context={userId:'local-teaching',role:'admin',scopeKind:'admin_sandbox',ownerId:'local-teaching',teachingProjectId:'virtual-teaching',courseId:'virtual-teaching',villageId:'virtual-village',spaceId:'virtual-local',groupId:null,baselineRevision:scene.revision,villageBoundary:boundary,baselineFeatures:[
   ...scene.buildings.map(b=>({id:b.id,layerKey:'building',geometry:footprint(b),properties:{name:b.name}})),
   ...scene.roads.map(r=>({id:r.id,layerKey:'road',geometry:{type:'LineString',coordinates:r.points.map(geo)},properties:{name:r.name,widthM:r.width}})),
   ...scene.zones.filter(z=>z.kind==='water').map(z=>({id:z.id,layerKey:'water',geometry:polygon([...z.points,z.points[0]]),properties:{name:z.name}}))
  ]};
  const obstacles=context.baselineFeatures.filter(f=>f.layerKey!=='road').map(f=>f.geometry);
  const document=D.create({...context,projectId:'virtual-morning-market'}),config=A.createConfig(document,context);
  config.settings={population:18,visitorsPerDay:0,days:1,seed:scene.scenario.seed,startWeekday:scene.scenario.startWeekday||0};config.area=boundary;config.entryMode='manual';config.entry=geo(scene.scenario.entry);
  config.assignments=homes.map(b=>({...A.assignment('baseline:'+b.id,'home'),capacity:Math.min(12,Scene.capacity(b)),entrance:geo(Scene.entrance(b))}));
  config.morningMarket={marketKey:'object:virtual-market',vendorCount:6,customerCount:12,startMinute:360,openMinute:390,lastEntryMinute:570,endMinute:600};
  let attempted=0;
  for(const road of scene.roads)for(let i=1;i<road.points.length;i++){
   const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<20)continue;
   for(const t of [.5,.25,.75])for(const offset of [17,-17,24,-24,32,-32]){
    const center=[a[0]+dx*t-dy/length*offset,a[1]+dy*t+dx/length*offset],field={id:'virtual-market',kind:'surface',category:'activity-field',geometry:G.rotatedFootprint(geo(center),{widthM:20,depthM:16},0),properties:{displayName:'溪田早市 · 教学情境'},layerId:'design',groupId:null,zIndex:0};
    if(!G.containsGeometry(boundary,field.geometry)||G.intersectsAny(field.geometry,obstacles))continue;
    const preset=P.createMarketPreset({field,idPrefix:'virtual-market'});if(!preset.ok)continue;document.objects=preset.command.objects;document.assetRefs=preset.command.assetRefs;
    const market={...A.assignment('object:'+field.id,'market'),staff:0,capacity:18,open:6,close:10};config.assignments=config.assignments.filter(a=>a.type==='home');config.assignments.push(market);
    for(const gate of [null,[-9.8,-5],[9.8,-5],[-9.8,5],[9.8,5],[0,7.8]]){
     if(gate)market.entrance=geo([center[0]+gate[0],center[1]+gate[1]]);else delete market.entrance;
     const compiled=A.compile(document,context,config);attempted++;
     if(compiled.ok){document.metadata={...document.metadata,simulation:config,teachingAssumption:'虚构村庄中的一次早市，18位成年合成人物；不覆盖原全日村庄设计。'};return {ok:true,document,context,config,center};}
    }
    if(attempted>300)return {ok:false,errors:['未找到接通村路且避开建筑、水体的早市空地；请在原村庄中留出约20×16米场地。']};
   }
  }
  return {ok:false,errors:['当前村庄没有合适的早市空地；原设计未修改。']};
 }
 async function open({scene,environment,storage=globalThis.localStorage,onClose}){
  await globalThis.loadVillageSimulation();const A=adapter(),sourceDigest=await A.digest({preset:P.VERSION,rule:A.RULE_VERSION,size:scene.size,buildings:scene.buildings,roads:scene.roads,zones:scene.zones,seed:scene.scenario.seed});
  if(!templates.has(sourceDigest)){const result=build(scene);if(result.ok){if(templates.size>=4)templates.delete(templates.keys().next().value);templates.set(sourceDigest,result);}else throw Error(result.errors.join('；'));}
  const built=JSON.parse(JSON.stringify(templates.get(sourceDigest)));if(!built.ok)throw Error(built.errors.join('；'));let document=built.document;
  const key=KEY+sourceDigest;try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved&&A.validateConfig(saved.metadata?.simulation).ok&&D.validate(saved).ok){const valid=A.compile(saved,built.context,saved.metadata.simulation);if(valid.ok)document=saved;}}catch{/* A damaged teaching draft never replaces the full-day design. */}
  const C=environment.Cesium,viewer=environment.viewer,half=scene.size.map(n=>n/2),project=environment.project;
  class LocalCartesian3 extends C.Cartesian3{
   static fromDegrees(lon,lat,height=0){const local=G.toLocalMeters([lon,lat],[0,0]);return project(local[0]+half[0],local[1]+half[1],height);}
   static fromDegreesArray(values){const points=[];for(let i=0;i<values.length;i+=2)points.push(this.fromDegrees(values[i],values[i+1]));return points;}
  }
  const localC={...C,Cartesian3:LocalCartesian3,HeightReference:{...C.HeightReference,CLAMP_TO_GROUND:C.HeightReference.NONE}},source=new C.CustomDataSource('virtual-morning-market-models');let disposed=false,workspace;
  const originalZoom=viewer.scene.screenSpaceCameraController.minimumZoomDistance,camera={position:C.Cartesian3.clone(viewer.camera.positionWC),direction:C.Cartesian3.clone(viewer.camera.directionWC),up:C.Cartesian3.clone(viewer.camera.upWC)};
  viewer.scene.screenSpaceCameraController.minimumZoomDistance=5;
  Promise.resolve(viewer.dataSources.add(source)).then(()=>{if(disposed)viewer.dataSources.remove(source,true);});
  for(const object of document.objects){
   if(object.category==='stall'){
    const position=LocalCartesian3.fromDegrees(...object.geometry.coordinates,object.transform.heightOffsetM||0),kind=object.properties.produceKind;
    source.entities.add({position,orientation:C.Transforms.headingPitchRollQuaternion(position,new C.HeadingPitchRoll((object.transform.headingDeg||0)*Math.PI/180,0,0)),model:{uri:'../3D_scenes_edit/assets/models/market-'+kind+'.glb?v=20261101-market1',scale:1}});
   }else if(object.kind==='surface')source.entities.add({polygon:{hierarchy:new C.PolygonHierarchy(LocalCartesian3.fromDegreesArray(object.geometry.coordinates[0].flat())),perPositionHeight:true,material:C.Color.fromCssColorString('#daceb2')}});
  }
  function dispose(){if(disposed)return;disposed=true;workspace?.dispose();viewer.dataSources.remove(source,true);viewer.scene.screenSpaceCameraController.minimumZoomDistance=originalZoom;viewer.camera.setView({destination:camera.position,orientation:{direction:camera.direction,up:camera.up}});viewer.scene.requestRender();onClose?.();}
  try{workspace=globalThis.VillageSimulationWorkspace.open({teachingVirtual:true,readDocument:()=>document,context:built.context,environment:{Cesium:localC,viewer,clampToGround:false},pickGround:({screenPosition})=>{const local=environment.pickGround?.(screenPosition);return local?G.fromLocalMeters(local.map((n,i)=>n-half[i]),[0,0]):null;},
   writeConfig(config){document.metadata.simulation=config;},save:async()=>{try{const valid=D.validate(document);if(!valid.ok)return {ok:false,errors:valid.errors};document.revision++;storage.setItem(key,JSON.stringify(document));return {ok:true};}catch{return {ok:false,code:'LOCAL_STORAGE_UNAVAILABLE',errors:['本地保存不可用，早市尚未启动；原村庄设计保留。']};}},onClose:dispose});
   if(C.BoundingSphere&&C.HeadingPitchRange&&viewer.camera.flyToBoundingSphere){const field=document.objects.find(o=>o.properties?.marketRole==='market'),ring=field.geometry.coordinates[0].slice(0,-1),center=ring.reduce((p,q)=>p.map((n,i)=>n+q[i]/ring.length),[0,0]);viewer.camera.flyToBoundingSphere(new C.BoundingSphere(LocalCartesian3.fromDegrees(...center,1.5),12),{offset:new C.HeadingPitchRange(0,-.25,24),duration:.8});}
   return {dispose,session:workspace.session,key,document:()=>document};}
  catch(error){dispose();throw error;}
 }
 return {KEY,build,open};
});
