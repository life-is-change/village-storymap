(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./geometry-rules'):root.SceneGeometryRulesModule,typeof module==='object'&&module.exports?require('../../village_game/domain/market-design'):root.VillageMarketDesign);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SceneMarketPreset=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(G,Design){
 'use strict';
 const VERSION='daily-market-preset-2';
 function createMarketPreset({field,idPrefix,assets=[]}={}){
  const errors=[],fail=message=>({ok:false,errors:[message]});
  if(field?.kind!=='surface'||field.category!=='activity-field'||field.geometry?.type!=='Polygon')return fail('请选择一个活动场地');
  if(field.properties?.marketId)return fail('该场地已经布置早市');
  if(!idPrefix||!field.geometry.coordinates[0]?.length)return fail('市场编号或范围无效');
  const ring=field.geometry.coordinates[0],origin=ring[0],points=ring.map(p=>G.toLocalMeters(p,origin));
  const center=[(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2];
  const geo=([x,y])=>G.fromLocalMeters([center[0]+x,center[1]+y],origin),marketId=field.id;
  const properties={marketId,siteId:field.id,presetVersion:VERSION};
  const width=Math.min(60,Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]))),depth=Math.min(40,Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1])));
  const layout=Design.stalls(width,depth);
  if(!layout.length)return fail('早市需要至少9×10米的连续空间');
  for(const stall of layout){const envelope={type:'Polygon',coordinates:[[[-stall.width/2,-stall.depth/2],[stall.width/2,-stall.depth/2],[stall.width/2,stall.depth/2],[-stall.width/2,stall.depth/2],[-stall.width/2,-stall.depth/2]].map(p=>geo([p[0]+stall.x,p[1]+stall.y]))]};if(!G.containsGeometry(field.geometry,envelope))return fail('当前凹形场地无法容纳完整摊位，请调整场地或手动布置');}
  const parent={...JSON.parse(JSON.stringify(field)),properties:{...field.properties,...properties,siteId:null,marketRole:'market',displayName:field.properties?.displayName||'村庄早市',marketGate:geo([width/2-.6,-depth/2+.4])}};
  const objects=[parent],assetRefs=[];
  layout.forEach((stall,i)=>{const kind=stall.produceKind;
   const assetId='seed:stall:morning-'+kind+(stall.style==='canopy'?'':'-'+stall.style),asset=assets.find(a=>a.id===assetId);
   if(assets.length&&!asset)errors.push('缺少早市素材：'+kind);
   if(!assetRefs.includes(assetId))assetRefs.push(assetId);
   objects.push({id:idPrefix+'-stall-'+(i+1),kind:'structure',category:'stall',geometry:{type:'Point',coordinates:geo([stall.x,stall.y])},transform:{headingDeg:stall.headingDeg,pitchDeg:0,rollDeg:0,scale:[stall.width/3.4,stall.depth/2.6,stall.height/(stall.style==='canopy'?2.9:stall.style==='table'?1.6:.4)],heightOffsetM:0},layerId:field.layerId,groupId:null,zIndex:field.zIndex+i+1,
    properties:{...properties,marketRole:'stall',sceneRole:'site-component',produceKind:kind,stallStyle:stall.style,assetRef:assetId,footprintM:[3.4,2.6],heightM:stall.style==='canopy'?2.9:stall.style==='table'?1.6:.4,displayName:(i+1)+'号 · '+({vegetables:'时蔬',fruit:'鲜果',tofu:'豆品干货'}[kind])}});
  });
  [[[-width/2+1,0],[width/2-.6,0]],[[width/2-.6,-depth/2+.4],[width/2-.6,0]]].forEach((line,i)=>objects.push({id:idPrefix+'-aisle-'+i,kind:'line',category:'path',geometry:{type:'LineString',coordinates:line.map(geo)},properties:{...properties,marketRole:'aisle',sceneRole:'site-component',widthM:2,displayName:'早市通道'},layerId:field.layerId,groupId:null,zIndex:field.zIndex+layout.length+1+i}));
  return {ok:!errors.length,errors,marketId,command:{type:'addMarketPreset',fieldId:field.id,objects,assetRefs}};
 }
 return {VERSION,createMarketPreset};
});
