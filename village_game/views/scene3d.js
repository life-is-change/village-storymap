(function(root){
  'use strict';
  const Catalog=VillageCatalog;
  async function create(container,callbacks){
    window.CESIUM_BASE_URL='../assets/vendor/cesium-1.118.0/';
    if(!window.Cesium)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=window.CESIUM_BASE_URL+'Cesium.js';script.onload=resolve;script.onerror=()=>reject(new Error('本地三维组件未能加载'));document.head.append(script);});
    const C=window.Cesium,origin=C.Cartesian3.fromDegrees(0,0,30),frame=C.Transforms.eastNorthUpToFixedFrame(origin),inverse=C.Matrix4.inverseTransformation(frame,new C.Matrix4());
    const plane=new C.Plane(C.Cartesian3.normalize(origin,new C.Cartesian3()),-C.Cartesian3.magnitude(origin));
    const viewer=new C.Viewer(container,{baseLayer:false,terrainProvider:new C.EllipsoidTerrainProvider(),baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,animation:false,timeline:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,requestRenderMode:true,maximumRenderTimeChange:Infinity,skyBox:false,skyAtmosphere:false});
    viewer.scene.globe.show=false;viewer.scene.backgroundColor=C.Color.fromCssColorString('#d7e1d0');viewer.scene.screenSpaceCameraController.minimumZoomDistance=35;viewer.scene.screenSpaceCameraController.maximumZoomDistance=1800;
    let scene,snapshot,ui,network,signature='',staticEntities=[],surfaces=[],agents=new Map(),ghost=null,selectedId=null,routeEntity=null,routeKey='',badgePositions=[];
    const point=(x,y,z=0)=>C.Matrix4.multiplyByPoint(frame,new C.Cartesian3(x-(scene?.size[0]||480)/2,y-(scene?.size[1]||360)/2,z),new C.Cartesian3());
    const color=(value,alpha=1)=>C.Color.fromCssColorString(value).withAlpha(alpha);
    function entity(options,kind,id){const e=viewer.entities.add(options);e.gameKind=kind;e.gameId=id;return e;}
    // Flat local geometry is built synchronously: portable to browsers without worker geometry support.
    function polygon(points,fill,z=0,kind,id){const positions=points.map(p=>p.length===3?point(...p):point(p[0],p[1],z)),pick={gameKind:kind,gameId:id};if(!C.CoplanarPolygonGeometry){const e=entity({polygon:{hierarchy:positions,perPositionHeight:true,material:color(fill),outline:false}},kind,id);staticEntities.push(e);return e;}const primitive=viewer.scene.primitives.add(new C.Primitive({geometryInstances:new C.GeometryInstance({geometry:new C.CoplanarPolygonGeometry({polygonHierarchy:new C.PolygonHierarchy(positions),vertexFormat:C.PerInstanceColorAppearance.VERTEX_FORMAT}),attributes:{color:C.ColorGeometryInstanceAttribute.fromColor(color(fill))},id:pick}),appearance:new C.PerInstanceColorAppearance({flat:true,translucent:false,closed:false}),asynchronous:false}));surfaces.push({primitive,pick,fill});return primitive;}
    function box(b,x,y,z,w,d,h,fill,kind='building'){const orientation=C.Transforms.headingPitchRollQuaternion(point(x,y,z),new C.HeadingPitchRoll(-b.rotation*Math.PI/180,0,0));const e=entity({position:point(x,y,z),orientation,box:{dimensions:new C.Cartesian3(w,d,h),material:color(fill),outline:false}},kind,b.id);staticEntities.push(e);return e;}
    function tree(x,y,size=1){const a=entity({position:point(x,y,2*size),cylinder:{length:4*size,topRadius:.5*size,bottomRadius:.6*size,material:color('#95806b')}});const b=entity({position:point(x,y,6*size),ellipsoid:{radii:new C.Cartesian3(3.4*size,3.4*size,4.2*size),material:color(ui.white?'#eef2e7':'#91aa74')}});staticEntities.push(a,b);}
    function rebuild(){for(const e of staticEntities)viewer.entities.remove(e);staticEntities=[];for(const s of surfaces)viewer.scene.primitives.remove(s.primitive);surfaces=[];selectedId=null;
      polygon([[0,0],[scene.size[0],0],scene.size,[0,scene.size[1]]],'#9faa84',-.1);
      for(const zone of scene.zones){polygon(zone.points,({field:'#c3cf99',forest:'#b0c18e',water:'#9fc5ca',reserve:'#d3dbb4'})[zone.kind]||'#d4dcc1',0);if(zone.kind==='field'){const xs=zone.points.map(p=>p[0]),ys=zone.points.map(p=>p[1]);for(let x=Math.min(...xs)+5;x<Math.max(...xs)-3;x+=8)polygon([[x,Math.min(...ys)+3],[x+2,Math.min(...ys)+3],[x+2,Math.max(...ys)-3],[x,Math.max(...ys)-3]],'#aebd7a',.08);}}
      for(const z of scene.zones.filter(z=>z.kind==='forest')){const xs=z.points.map(p=>p[0]),ys=z.points.map(p=>p[1]);for(let x=Math.min(...xs)+5;x<Math.max(...xs)-4;x+=12)for(let y=Math.min(...ys)+5;y<Math.max(...ys)-4;y+=12)tree(x,y,.8);}
      (scene.schemaVersion===1?[[28,80],[30,170],[50,186],[390,135],[401,224],[370,68],[245,50],[320,58],[98,184],[288,263]]:[]).forEach(p=>tree(...p));
      for(const road of scene.roads)for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],len=VillageNetwork.distance(a,b);if(len<.01)continue;const nx=-(b[1]-a[1])/len*(road.width/2),ny=(b[0]-a[0])/len*(road.width/2);polygon([[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]],'#9d8b71',.4,'road',road.id);}
      for(const road of scene.roads){const e=entity({polyline:{positions:road.points.map(p=>point(...p,.65)),width:Math.max(3,road.width),material:color('#a18e73'),clampToGround:false}},'road',road.id);staticEntities.push(e);}
      for(const link of network.links)if(link.id!=='entry'){const e=entity({polyline:{positions:link.points.map(p=>point(...p,.19)),width:1.2,material:new C.PolylineDashMaterialProperty({color:color('#9da982'),dashLength:8})}});staticEntities.push(e);}
      for(const b of scene.buildings){const t=Catalog.info(b.type),body=ui.white?'#f8f8ee':t.wall,roof=ui.white?'#e9ece0':t.roof;
        const shape=Catalog.structure(b),angle=b.rotation*Math.PI/180,local=(x,y,z)=>[b.x+x*Math.cos(angle)-y*Math.sin(angle),b.y+x*Math.sin(angle)+y*Math.cos(angle),z];
        if(shape.body){const q=shape.body;box(b,...local(q.x,q.y,q.z),q.w,q.d,q.h,body);
          const z=q.h+.2,corners=[local(q.x-q.w/2-1,q.y-q.d/2-1,z),local(q.x+q.w/2+1,q.y-q.d/2-1,z),local(q.x+q.w/2+1,q.y+q.d/2+1,z),local(q.x-q.w/2-1,q.y+q.d/2+1,z)],ridge=[local(q.x,q.y-q.d/2-1,z+3),local(q.x,q.y+q.d/2+1,z+3)];
          for(const pts of [[corners[0],corners[3],ridge[1],ridge[0]],[ridge[0],ridge[1],corners[2],corners[1]],[corners[0],ridge[0],corners[1]],[corners[3],corners[2],ridge[1]]])polygon(pts,roof,0,'building',b.id);
          const e=VillageScene.entrance(b);if(!['ancestral','kindergarten'].includes(b.type))box(b,e[0],e[1],1.8,2.6,1,3.3,ui.white?'#d8ded0':'#796e58');
          const center=local(q.x,q.y,0);decorate({...b,x:center[0],y:center[1],width:q.w,depth:q.d},t);
        }
        for(const q of shape.parts){const part=box(b,...local(q.x,q.y,q.z),q.w,q.d,q.h,ui.white?'#edf0e5':q.fill);part.spacePart=q.role;}
        if(b.type==='park'){tree(b.x-b.width/4,b.y,1);tree(b.x+b.width/4,b.y,.8);}
        const entrance=VillageScene.entrance(b);const e=entity({position:point(b.x,b.y,b.height+8),billboard:{image:Catalog.billboardImage(b.type,!network.connected[b.id]),color:C.Color.WHITE,width:b.type==='home'?20:28,height:b.type==='home'?20:28,disableDepthTestDistance:Infinity,show:ui.icons!==false},label:{text:b.name,font:'14px "Microsoft YaHei"',fillColor:color('#304c37'),showBackground:true,backgroundColor:color('#fffdf1',.94),backgroundPadding:new C.Cartesian2(7,5),pixelOffset:new C.Cartesian2(0,-28),disableDepthTestDistance:Infinity,show:VillageObservation.labelVisible(b,ui)}},'building',b.id);staticEntities.push(e);const door=entity({position:point(...entrance,.5),point:{pixelSize:6,color:color(network.connected[b.id]?'#a4b46a':'#c27450'),outlineColor:C.Color.WHITE,outlineWidth:1,show:false}},'entrance',b.id);staticEntities.push(door);
      }
      const marker=entity({position:point(...scene.scenario.entry,1),label:{text:'村口',font:'12px "Microsoft YaHei"',fillColor:color('#49643e'),showBackground:true,backgroundColor:color('#fff9e8',.9),pixelOffset:new C.Cartesian2(-14,-18),disableDepthTestDistance:Infinity,show:ui.labels},point:{pixelSize:8,color:color('#608156'),outlineColor:C.Color.WHITE,outlineWidth:2}});staticEntities.push(marker);
    }
    function decorate(b,t){
      const angle=b.rotation*Math.PI/180,local=(x,y,z)=>[b.x+x*Math.cos(angle)-y*Math.sin(angle),b.y+x*Math.sin(angle)+y*Math.cos(angle),z];
      if(['house','learning','support','hall','visitor'].includes(t.model))for(const x of [-b.width*.27,b.width*.27]){const p=local(x,b.depth/2+.1,b.height*.55);box(b,...p,Math.min(3,b.width*.15),.45,1.7,ui.white?'#dfe4d8':'#efe9d0');}
      if(t.model==='commerce'){const p=local(0,b.depth/2+1,b.height*.55);box(b,...p,b.width*.9,3,.6,ui.white?'#e5e9df':'#ecd7b7');}

    }
    function overview(){if(!scene)return;viewer.camera.lookAt(point(scene.size[0]/2,scene.size[1]/2-18-(ui.mode==='design'?165:0),0),new C.HeadingPitchRange(-.2,-.92,Math.max(scene.size[0],scene.size[1])*1.12*Math.max(ui.mode==='design'?1.42:1,(viewer.scene.canvas.clientHeight||500)/(viewer.scene.canvas.clientWidth||700)*1.15)));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();}
    function ground(position){const ray=viewer.camera.getPickRay(position);if(!ray)return null;const hit=C.IntersectionTests.rayPlane(ray,plane);if(!hit)return null;const local=C.Matrix4.multiplyByPoint(inverse,hit,new C.Cartesian3());return [local.x+scene.size[0]/2,local.y+scene.size[1]/2];}
    const handler=new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(e=>{if(!ui)return;if(ui.tool!=='select'){const p=ground(e.position);if(p)callbacks.onPoint(p);}else{const stackedBadge=ui.icons!==false?(viewer.scene.drillPick?.(e.position,12)||[]).map(p=>p.id).find(ent=>ent?.gameKind==='building'&&ent.billboard):null;if(stackedBadge){callbacks.onSelect({kind:'building',id:stackedBadge.gameId});return;}const badge=ui.icons!==false?badgePositions.filter(p=>Math.hypot(p.x-e.position.x,p.y-e.position.y)<15).sort((a,b)=>Math.hypot(a.x-e.position.x,a.y-e.position.y)-Math.hypot(b.x-e.position.x,b.y-e.position.y))[0]:null;if(badge){callbacks.onSelect({kind:'building',id:badge.id});return;}const pick=viewer.scene.pick(e.position),ent=pick?.id;callbacks.onSelect(ent?.gameKind?{kind:ent.gameKind==='entrance'?'building':ent.gameKind,id:ent.gameId}:null);}},C.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(e=>{if(ui&&ui.tool!=='select')callbacks.onHover(ground(e.endPosition));},C.ScreenSpaceEventType.MOUSE_MOVE);
    return {render(s,snap,state,net){const first=!scene,changed=scene!==s;scene=s;snapshot=snap;ui=state;network=net;const next=scene.revision+'|'+ui.white+'|'+ui.labels;if(changed||signature!==next){signature=next;rebuild();}if(first)overview();
        for(const e of staticEntities)if(e.gameKind==='road'&&e.polygon)e.polygon.material=color(ui.traffic&&snapshot?.roadFlows?.[e.gameId]?'#bc702b':'#9d8b71');for(const e of staticEntities)if(e.gameKind==='road'&&e.polyline)e.polyline.material=color(ui.traffic&&snapshot?.roadFlows?.[e.gameId]?'#bc702b':'#a18e73');
        for(const e of staticEntities)if(e.gameKind==='building'&&e.label){const b=scene.buildings.find(b=>b.id===e.gameId);e.label.show=VillageObservation.labelVisible(b,ui);const f=snapshot?.facilities[b.id],wait=snapshot?.agents.filter(a=>a.target===b.id&&a.state==='waiting').length||0;e.label.text=b.name+(b.id===ui.focusId&&f?'\n'+f.occupancy+'/'+f.capacity+' 使用 · '+wait+' 等候':'');}
        const badgeEntities=staticEntities.filter(e=>e.gameKind==='building'&&e.billboard),projected=[];
        for(const e of badgeEntities){const b=scene.buildings.find(b=>b.id===e.gameId);let p;if(C.SceneTransforms?.worldToWindowCoordinates)p=C.SceneTransforms.worldToWindowCoordinates(viewer.scene,point(b.x,b.y,b.height+8));else p={x:b.x,y:b.y};if(p&&p.x>=0&&p.y>=0&&(!viewer.scene.canvas.clientWidth||p.x<=viewer.scene.canvas.clientWidth)&&(!viewer.scene.canvas.clientHeight||p.y<=viewer.scene.canvas.clientHeight))projected.push({id:b.id,type:b.type,x:p.x,y:p.y});}
        const placed=Catalog.placeBadges(projected,ui.selected?.kind==='building'?ui.selected.id:null,32,{width:viewer.scene.canvas.clientWidth,height:viewer.scene.canvas.clientHeight}),byId=new Map(placed.map(p=>[p.id,p]));badgePositions=placed;
        for(const e of badgeEntities){const p=byId.get(e.gameId);e.billboard.show=ui.icons!==false&&!!p;if(p)e.billboard.pixelOffset=new C.Cartesian2(p.x-p.anchorX,p.y-p.anchorY);}
        for(const e of staticEntities)if(e.spacePart==='awning'){const b=scene.buildings.find(b=>b.id===e.gameId),at=snapshot?.minute??360;e.show=at>=b.open*60&&at<b.close*60;}
        for(const e of staticEntities)if(e.gameKind==='entrance')e.point.show=ui.mode==='design'&&(ui.selected?.kind==='building'&&ui.selected.id===e.gameId||ui.tool==='entrance');
        const person=snapshot?.agents.find(a=>ui.selected?.kind==='agent'&&a.id===ui.selected.id),route=person?.displayRoute||person?.route,key=person?.id+'|'+JSON.stringify(route);if(key!==routeKey){routeKey=key;if(routeEntity)viewer.entities.remove(routeEntity);routeEntity=route?.length>1?entity({polyline:{positions:route.map(p=>point(...p,.9)),width:5,material:new C.PolylineDashMaterialProperty({color:color('#b6642c'),dashLength:16}),clampToGround:false}}):null;}
        for(const s of surfaces)if(s.pick.gameKind==='road'&&s.primitive.ready){const attributes=s.primitive.getGeometryInstanceAttributes(s.pick);attributes.color=C.ColorGeometryInstanceAttribute.toValue(color(ui.traffic&&snapshot?.roadFlows?.[s.pick.gameId]?'#bc702b':s.fill));}
        const ids=new Set();
        for(const a of snapshot?.agents||[]){
          if(!VillageObservation.visible(a))continue;
          ids.add(a.id);
          // The road surface is at 0.4m. Place the sprite's shoe row just above it.
          const z=scene.scenario.living&&!a.indoor?.45:2;
          let ent=agents.get(a.id);
          if(!ent){
            ent=entity({position:point(a.x,a.y,z),point:{pixelSize:9,color:color('#3c806a'),outlineColor:C.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Infinity},label:{text:a.name,font:'14px "Microsoft YaHei"',pixelOffset:new C.Cartesian2(0,-23),fillColor:color('#304c37'),showBackground:true,backgroundColor:color('#fffbea',.95),disableDepthTestDistance:Infinity,show:false}},'agent',a.id);
            agents.set(a.id,ent);
          }
          ent.position=point(a.x,a.y,z);
          const selected=ui.selected?.kind==='agent'&&ui.selected.id===a.id,relevant=VillageObservation.relevant(a,ui);
          ent.label.show=selected;
          ent.point.pixelSize=selected?15:relevant?(a.indoor?6:a.state==='waiting'?12:10):5;
          ent.point.outlineColor=color(a.state==='waiting'&&relevant?'#bc702b':a.indoor?VillageObservation.personColor(a):'#ffffff',relevant?1:.25);
          ent.point.outlineWidth=a.state==='waiting'?3:2;
          ent.point.color=color(VillageObservation.personColor(a),a.indoor?.12:relevant?1:.15);
          ent.point.show=!scene.scenario.living||a.indoor;
          if(scene.scenario.living){
            const height=selected?34:a.ageGroup==='child'?23:28;
            ent.billboard={image:VillageCharacters.image(a,(snapshot.minute+snapshot.progress)*4),width:height*VillageCharacters.width/VillageCharacters.height,height,verticalOrigin:C.VerticalOrigin.BOTTOM,horizontalOrigin:C.HorizontalOrigin.CENTER,pixelOffset:new C.Cartesian2(0,0),color:color('#ffffff',relevant?1:.2),disableDepthTestDistance:0,show:!a.indoor};
            ent.label.pixelOffset=new C.Cartesian2(0,a.indoor?-23:-height-12);
          }else if(ent.billboard)ent.billboard.show=false;
        }
        for(const a of snapshot?.agents||[]){const ent=agents.get(a.id);if(!ent)continue;const selected=ui.selected?.kind==='agent'&&ui.selected.id===a.id,chatting=VillageObservation.isChatting(a,snapshot)&&a.id<a.interaction.otherId&&VillageObservation.relevant(a,ui);ent.label.show=selected||chatting;ent.label.text=selected?a.name:'···';}
        for(const [id,ent] of agents)if(!ids.has(id)){viewer.entities.remove(ent);agents.delete(id);}
        if(ghost){viewer.entities.remove(ghost);ghost=null;}if(ui.ghost){const b=ui.ghost;ghost=entity({position:point(b.x,b.y,b.height/2),orientation:C.Transforms.headingPitchRollQuaternion(point(b.x,b.y),new C.HeadingPitchRoll(-b.rotation*Math.PI/180,0,0)),box:{dimensions:new C.Cartesian3(b.width,b.depth,b.height),material:color(VillageEditor.placement(scene,b)?'#c57755':'#78a46b',.45),outline:true,outlineColor:C.Color.WHITE}});}
        const selected=ui.selected?.kind==='building'?ui.selected.id:null;if(selected!==selectedId){selectedId=selected;for(const e of staticEntities)if(e.box){e.box.outline=e.gameId===selected;e.box.outlineColor=color('#487753');}}
        viewer.scene.requestRender();},overview,focus(p){viewer.camera.lookAt(point(p[0],p[1],0),new C.HeadingPitchRange(-.15,-1.03,165));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();},destroy(){handler.destroy();viewer.destroy();}};
  }
  root.VillageScene3D={create};
})(window);
