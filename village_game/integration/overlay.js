(function(root,factory){const c=typeof module==='object'&&module.exports,api=factory(c?require('../views/characters'):root.VillageCharacters,c?require('../views/catalog'):root.VillageCatalog,c?require('../views/observation'):root.VillageObservation,c?require('./plan-adapter'):root.VillagePlanAdapter);if(c)module.exports=api;if(root)root.VillagePlanOverlay=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Characters,Catalog,Observation,Adapter){
 function create({Cesium:C,viewer,onPick,onInspect,pickGround,onDrawProgress}){
  const actors=new Map(),decorations=[],areaPoints=[],areaPreview=[];let pendingPick=null,disposed=false,selected=null,sourceItems=[];
  const source=new C.CustomDataSource('village-simulation'),entities=source.entities;
  Promise.resolve(viewer.dataSources.add(source)).then(()=>{if(disposed)viewer.dataSources.remove(source,true);});
  const color=s=>C.Color.fromCssColorString(s);
  const handler=new C.ScreenSpaceEventHandler(viewer.scene.canvas);
  function clearActors(){for(const e of actors.values()){e.show=false;entities.remove(e);}actors.clear();viewer.scene.requestRender();}
  function clearPlan(){for(const e of decorations)entities.remove(e);decorations.length=0;}
  function clearAreaPreview(){while(areaPreview.length)entities.remove(areaPreview.pop());}
  function showArea(area){if(area?.type!=='Polygon')return;decorations.push(entities.add({polyline:{positions:C.Cartesian3.fromDegreesArray(area.coordinates[0].flat()),width:4,material:color('#8366b1'),clampToGround:true}}));}
  function finishArea(){if(pendingPick!=='area')return;if(areaPoints.length<3){onDrawProgress?.(areaPoints.length);return;}
   const geometry={type:'Polygon',coordinates:[[...areaPoints.map(p=>p.slice()),areaPoints[0].slice()]]};
   const result=onPick?.('area',geometry);if(result?.ok===false)return;pendingPick=null;areaPoints.length=0;clearAreaPreview();viewer.scene.requestRender();
  }
  function showEntry(p,label='村口 · 游客进出'){
   if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))return;
   const e=entities.add({position:C.Cartesian3.fromDegrees(...p),
    point:{pixelSize:16,color:color('#efad32'),outlineColor:color('#fffdf5'),outlineWidth:3,heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity},
    label:{text:label,show:true,font:'bold 14px sans-serif',fillColor:color('#503715'),showBackground:true,backgroundColor:color('#fff6da'),pixelOffset:new C.Cartesian2(0,-32),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity}});
   e.simulationEntry=true;decorations.push(e);
  }
  function showAccess(key,d,projection,chosen=false){
   if(!d?.point)return;
   const p=projection.toDegrees(d.point),shade=d.reason==='connected'?'#3c9467':d.reason==='unchecked'?'#c79030':'#bf5746';
   const e=entities.add({position:C.Cartesian3.fromDegrees(...p),point:{pixelSize:9,color:color(shade),outlineColor:color('#fffdf5'),outlineWidth:2,heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity},
    label:{text:'设施入口',show:chosen,font:'12px sans-serif',showBackground:true,pixelOffset:new C.Cartesian2(0,18),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity}});
   e.simulationKey=key;e.simulationEntrance=key;decorations.push(e);
   if(d.roadPoint&&d.distance>.1){
    const stroke=color(shade),material=d.reason!=='connected'&&C.PolylineDashMaterialProperty?new C.PolylineDashMaterialProperty({color:stroke,dashLength:12}):stroke;
    const line=entities.add({polyline:{positions:C.Cartesian3.fromDegreesArray([...p,...projection.toDegrees(d.roadPoint)]),width:3,material,clampToGround:true}});
    line.simulationKey=key;line.simulationConnection=d.reason;decorations.push(line);
   }
  }
  handler.setInputAction(e=>{
   if(pendingPick==='area'){const p=pickGround({Cesium:C,viewer,screenPosition:e.position,skipDepth:true});if(!p)return;const q=p.slice(0,2);if(areaPoints.at(-1)?.every((n,i)=>Math.abs(n-q[i])<1e-9))return;areaPoints.push(q);clearAreaPreview();for(const point of areaPoints)areaPreview.push(entities.add({position:C.Cartesian3.fromDegrees(...point),point:{pixelSize:11,color:color('#8366b1'),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity}}));if(areaPoints.length>1)areaPreview.push(entities.add({polyline:{positions:C.Cartesian3.fromDegreesArray([...areaPoints,...(areaPoints.length>2?[areaPoints[0]]:[])].flat()),width:4,material:color('#8366b1'),clampToGround:true}}));onDrawProgress?.(areaPoints.length);viewer.scene.requestRender();return;}
   if(pendingPick&&pendingPick!=='source'){const p=pickGround({Cesium:C,viewer,screenPosition:e.position,skipDepth:true});if(!p)return;const purpose=pendingPick;pendingPick=null;onPick?.(purpose,p.slice(0,2));return;}
   const picked=viewer.scene.pick(e.position),hit=picked?.id;
   if(hit?.simulationPerson){selected=hit.simulationPerson.id;onInspect?.({kind:'person',person:hit.simulationPerson});return;}
   if(hit?.simulationKey){pendingPick=null;onInspect?.({kind:'facility',key:hit.simulationKey});return;}
   const p=pickGround?.({Cesium:C,viewer,screenPosition:e.position,skipDepth:true});
   const item=Adapter.pickSource(picked,p?.slice(0,2),sourceItems);
   if(item){pendingPick=null;onInspect?.({kind:'facility',key:item.key});}

  },C.ScreenSpaceEventType.LEFT_CLICK);
  if(C.ScreenSpaceEventType.RIGHT_CLICK!==undefined)handler.setInputAction(finishArea,C.ScreenSpaceEventType.RIGHT_CLICK);
  if(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK!==undefined)handler.setInputAction(finishArea,C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  function setPlan(plan){
   clearActors();clearPlan();
   sourceItems=plan.items||sourceItems;showArea(plan.area);
   for(const b of plan.scene.buildings){const p=plan.projection.toDegrees(b.entrance),e=entities.add({position:C.Cartesian3.fromDegrees(...p),billboard:{image:Catalog.billboardImage(b.type,!plan.network.connected[b.id]),width:26,height:26,heightReference:C.HeightReference.CLAMP_TO_GROUND,pixelOffset:new C.Cartesian2(0,-8),verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:Infinity},label:{text:b.name,font:'12px sans-serif',show:false}});e.simulationKey=b.sourceKey;decorations.push(e);}
   for(const r of plan.scene.roads){const coords=r.points.flatMap(p=>plan.projection.toDegrees(p));decorations.push(entities.add({polyline:{positions:C.Cartesian3.fromDegreesArray(coords),width:2,material:color('#ddaa54').withAlpha(.7),clampToGround:true}}));}
   for(const b of plan.scene.buildings)showAccess(b.sourceKey,plan.network?.accessDiagnostics?.[b.id]||{point:b.entrance,reason:'unchecked'},plan.projection);
   const gates=plan.scene.scenario.entries||[plan.scene.scenario.entry];gates.forEach((p,i)=>showEntry(plan.projection.toDegrees(p),gates.length>1?'对外口 '+(i+1):'村口 · 游客进出'));
   viewer.scene.requestRender();
  }
  function setSources(items,config,key){
   sourceItems=items;clearActors();clearPlan();
   showArea(config.area);
   if(config.area&&config.entryMode!=='manual')Adapter.areaRoads(items.filter(i=>i.kind==='road'&&config.roads.includes(i.key)),config.area).entries.forEach((p,i)=>showEntry(p,'对外口 '+(i+1)));
   else showEntry(config.entry);
   for(const item of items){const a=config.assignments.find(a=>a.key===item.key);if(!a&&item.key!==key)continue;
    const g=item.geometry,ring=g.type==='Polygon'?g.coordinates[0].slice(0,-1):null;
    const p=ring?ring.reduce((sum,q)=>sum.map((n,i)=>n+q[i]/ring.length),[0,0]):g.coordinates;
    if(!p||Array.isArray(p[0]))continue;
    const e=entities.add({position:C.Cartesian3.fromDegrees(...p),
     ...(a?{billboard:{image:Catalog.billboardImage(a.type),width:item.key===key?36:26,height:item.key===key?36:26,heightReference:C.HeightReference.CLAMP_TO_GROUND,verticalOrigin:C.VerticalOrigin.BOTTOM,pixelOffset:new C.Cartesian2(0,-8),disableDepthTestDistance:Infinity}}:{point:{pixelSize:13,color:color('#e4a044'),outlineColor:color('#fffdf5'),outlineWidth:3,heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity}}),
     label:{text:item.name,show:item.key===key,font:'13px sans-serif',showBackground:true,pixelOffset:new C.Cartesian2(0,-52),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity}});
    e.simulationKey=item.key;decorations.push(e);
    if(a?.entrance)showAccess(item.key,{point:a.entrance,reason:'unchecked'},{toDegrees:p=>p},item.key===key);
   }
   viewer.scene.requestRender();
  }
  return {setPlan,setSources,clearActors,finishArea,clear(){clearActors();clearPlan();},pick(purpose){pendingPick=purpose;areaPoints.length=0;clearAreaPreview();},cancelPick(){pendingPick=null;areaPoints.length=0;clearAreaPreview();},
   focus(item){if(!item)return;let p=item.geometry.coordinates;while(Array.isArray(p[0]))p=p[0];viewer.camera.flyTo({destination:C.Cartesian3.fromDegrees(p[0],p[1],150),duration:.7});},
   render(s,plan){
    if(disposed)return;const ids=new Set();
    for(const a of s.agents){if(!Observation.visible(a))continue;ids.add(a.id);let e=actors.get(a.id);if(!e){e=entities.add({});actors.set(a.id,e);}
     const p=plan.projection.toDegrees([a.x,a.y]),height=selected===a.id?34:a.ageGroup==='child'?24:30;
     e.position=C.Cartesian3.fromDegrees(...p);e.simulationPerson=a;
     e.billboard={show:!a.indoor,image:Characters.image(a,(s.minute+s.progress)*4),height,width:height*Characters.width/Characters.height,verticalOrigin:C.VerticalOrigin.BOTTOM,horizontalOrigin:C.HorizontalOrigin.CENTER,pixelOffset:new C.Cartesian2(0,0),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:0};
     e.point={show:!!a.indoor,pixelSize:5,color:color('#66877c').withAlpha(.2),outlineColor:color('#66877c'),outlineWidth:1,heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity};
     e.label={show:selected===a.id||a.interaction?.status==='active',text:selected===a.id?a.name:'···',font:'12px sans-serif',fillColor:color('#314b42'),showBackground:true,pixelOffset:new C.Cartesian2(0,-height-12),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity};
    }
    for(const [id,e] of actors)if(!ids.has(id)){entities.remove(e);actors.delete(id);}viewer.scene.requestRender();
   },dispose(){if(disposed)return;disposed=true;pendingPick=null;handler.destroy();clearAreaPreview();clearActors();clearPlan();viewer.dataSources.remove(source,true);viewer.scene.requestRender();}};
 }
 return {create};
});
