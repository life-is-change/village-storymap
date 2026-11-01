(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./geometry-rules'):root.SceneGeometryRulesModule);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SceneMarketPreset=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(G){
 'use strict';
 const VERSION='morning-market-1';
 function createMarketPreset({field,idPrefix,assets=[]}={}){
  const errors=[],fail=message=>({ok:false,errors:[message]});
  if(field?.kind!=='surface'||field.category!=='activity-field'||field.geometry?.type!=='Polygon')return fail('请选择一个活动场地');
  if(field.properties?.marketId)return fail('该场地已经布置早市');
  if(!idPrefix||!field.geometry.coordinates[0]?.length)return fail('市场编号或范围无效');
  const ring=field.geometry.coordinates[0],origin=ring[0],points=ring.map(p=>G.toLocalMeters(p,origin));
  const center=[(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2];
  const geo=([x,y])=>G.fromLocalMeters([center[0]+x,center[1]+y],origin),marketId=field.id;
  // A conservative rectangular envelope leaves walking and queue clearance.
  const envelope={type:'Polygon',coordinates:[[[-8.5,-7],[8.5,-7],[8.5,7],[-8.5,7],[-8.5,-7]].map(geo)]};
  if(!G.containsGeometry(field.geometry,envelope))return fail('早市需要场地内连续约17×14米的空地，请扩大或调整范围');
  const properties={marketId,presetVersion:VERSION};
  const parent={...JSON.parse(JSON.stringify(field)),properties:{...field.properties,...properties,marketRole:'market',displayName:field.properties?.displayName||'村庄早市',marketGate:geo([0,-7])}};
  const objects=[parent],assetRefs=[];
  ['vegetables','vegetables','vegetables','vegetables','fruit','tofu'].forEach((kind,i)=>{
   const assetId='seed:stall:morning-'+kind,asset=assets.find(a=>a.id===assetId);
   if(assets.length&&!asset)errors.push('缺少早市素材：'+kind);
   if(!assetRefs.includes(assetId))assetRefs.push(assetId);
   objects.push({id:idPrefix+'-stall-'+(i+1),kind:'structure',category:'stall',geometry:{type:'Point',coordinates:geo([(i%3-1)*5,i<3?4:-4])},transform:{headingDeg:i<3?0:180,pitchDeg:0,rollDeg:0,scale:[1,1,1],heightOffsetM:0},layerId:field.layerId,groupId:null,zIndex:field.zIndex+i+1,
    properties:{...properties,marketRole:'stall',sceneRole:'site-component',produceKind:kind,assetRef:assetId,footprintM:[3.4,2.6],heightM:2.9,displayName:(i+1)+'号 · '+({vegetables:'时蔬',fruit:'鲜果',tofu:'豆品干货'}[kind])}});
  });
  [[[0,-7],[0,0]],[[-7.5,0],[7.5,0]]].forEach((line,i)=>objects.push({id:idPrefix+'-aisle-'+i,kind:'line',category:'path',geometry:{type:'LineString',coordinates:line.map(geo)},properties:{...properties,marketRole:'aisle',sceneRole:'site-component',widthM:2,displayName:'早市通道'},layerId:field.layerId,groupId:null,zIndex:field.zIndex+7+i}));
  return {ok:!errors.length,errors,marketId,command:{type:'addMarketPreset',fieldId:field.id,objects,assetRefs}};
 }
 return {VERSION,createMarketPreset};
});
