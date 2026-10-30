(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../../3D_scenes_edit/domain/geometry-rules'):root.SceneGeometryRulesModule);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageExperimentArea=api;})(typeof globalThis!=='undefined'?globalThis:this,function(G){
 'use strict';
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
 function validate(area){
  const ring=area?.coordinates?.[0],errors=[];
  if(area?.type!=='Polygon'||area.coordinates.length!==1||!Array.isArray(ring)||ring.length<4||ring.length>41||ring.some(p=>!point(p))||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])return {ok:false,errors:['模拟范围须为3—40个点构成的闭合面域']};
  const local=ring.map(p=>G.toLocalMeters(p,ring[0])),spans=[0,1].map(i=>Math.max(...local.map(p=>p[i]))-Math.min(...local.map(p=>p[i])));
  if(G.isSelfIntersecting(area)||G.measureAreaM2(area)<4)errors.push('模拟范围不能自交，面积至少4平方米');
  if(spans.some(n=>n>2000+1e-6))errors.push('模拟范围东西、南北跨度各不超过2公里');
  return {ok:!errors.length,errors};
 }
 const near=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8;
 const mix=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*t);
 function cuts(a,b,ring){const ts=[0,1],dx=b[0]-a[0],dy=b[1]-a[1];
  for(let i=1;i<ring.length;i++){const c=ring[i-1],d=ring[i],ux=d[0]-c[0],uy=d[1]-c[1],cross=dx*uy-dy*ux;if(Math.abs(cross)<1e-18)continue;const t=((c[0]-a[0])*uy-(c[1]-a[1])*ux)/cross,s=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/cross;if(t>=-1e-9&&t<=1+1e-9&&s>=-1e-9&&s<=1+1e-9)ts.push(Math.max(0,Math.min(1,t)));}
  return [...new Set(ts.map(t=>Math.round(t*1e12)/1e12))].sort((a,b)=>a-b);
 }
 function onBoundary(p,ring){return ring.slice(1).some((b,i)=>{const a=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy);return t>=-1e-7&&t<=1+1e-7&&near(p,mix(a,b,Math.max(0,Math.min(1,t))));});}
 function clipRoads(roads,area){
  const output=[],entries=[],ring=area.coordinates[0];
  for(const road of roads){let chain=[];const pieces=[];
   const flush=()=>{if(chain.length>=2)pieces.push(chain);chain=[];};
   for(let i=1;i<road.geometry.coordinates.length;i++){const a=road.geometry.coordinates[i-1],b=road.geometry.coordinates[i],ts=cuts(a,b,ring);
    for(let j=1;j<ts.length;j++){const x=mix(a,b,ts[j-1]),y=mix(a,b,ts[j]);if(near(x,y))continue;
     if(G.containsGeometry(area,{type:'Point',coordinates:mix(x,y,.5)})){if(chain.length&&!near(chain.at(-1),x))flush();if(!chain.length)chain.push(x);chain.push(y);}else flush();
    }
   }flush();
   pieces.forEach((coordinates,index)=>{output.push({...road,key:road.key+'~'+index,sourceKey:road.key,geometry:{type:'LineString',coordinates}});for(const p of [coordinates[0],coordinates.at(-1)])if(onBoundary(p,ring)&&!entries.some(q=>near(p,q)))entries.push(p.slice());});
  }
  return {roads:output,entries};
 }
 function contains(area,geometry){if(!area)return true;if(geometry?.type==='Polygon')return geometry.coordinates.every(ring=>G.containsGeometry(area,{type:'LineString',coordinates:ring}));return G.containsGeometry(area,geometry);}
 return {validate,clipRoads,contains};
});
