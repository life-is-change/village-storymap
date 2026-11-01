(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../../3D_scenes_edit/domain/geometry-rules'):root.SceneGeometryRulesModule);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageMarketLayout=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(G){
 'use strict';
 const VERSION='market-layout-1',copy=v=>JSON.parse(JSON.stringify(v)),distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 const pointGeometry=p=>({type:'Point',coordinates:p}),lineGeometry=(a,b)=>({type:'LineString',coordinates:[a,b]});
 function project(p,a,b){const d=b.map((v,i)=>v-a[i]),len=d[0]**2+d[1]**2,t=len?Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/len)):0;return a.map((v,i)=>v+t*d[i]);}
 function inside(p,poly){return G.containsGeometry(poly,pointGeometry(p));}
 function edgeDistance(p,ring){return Math.min(...ring.slice(1).map((b,i)=>distance(p,project(p,ring[i],b))));}
 function clearPoint(layout,p){return inside(p,layout.field)&&!layout.obstacles.some(ring=>inside(p,{type:'Polygon',coordinates:[ring]})||edgeDistance(p,ring)<.27);}
 function segmentClear(layout,a,b){
  if(!G.containsGeometry(layout.field,lineGeometry(a,b)))return false;
  const steps=Math.max(1,Math.ceil(distance(a,b)/.2));
  for(let i=0;i<=steps;i++)if(!clearPoint(layout,a.map((v,k)=>v+(b[k]-v)*i/steps)))return false;
  // Exact intersection catches thin obstacles between samples.
  return !G.intersectsAny(lineGeometry(a,b),layout.obstacles.map(ring=>({type:'Polygon',coordinates:[ring]})));
 }
 function route(layout,from,to){
  if(!Array.isArray(from)||!Array.isArray(to)||!clearPoint(layout,from)||!clearPoint(layout,to))return null;
  if(segmentClear(layout,from,to))return {points:[copy(from),copy(to)],distance:distance(from,to)};
  const nodes=[...layout.nodes,from,to],start=nodes.length-2,end=nodes.length-1,edges=layout.edges.map(row=>row.map(e=>e.slice()));edges.push([],[]);
  for(const index of [start,end]){
   const nearest=layout.nodes.map((p,i)=>({i,d:distance(nodes[index],p)})).filter(x=>x.d<=2.2).sort((a,b)=>a.d-b.d);
   for(const {i,d} of nearest)if(segmentClear(layout,nodes[index],nodes[i])){edges[index].push([i,d]);edges[i].push([index,d]);}
  }
  const costs=new Map([[start,0]]),previous=new Map(),pending=new Set([start]),visited=new Set();
  while(pending.size){let at=null;for(const n of pending)if(at===null||costs.get(n)<costs.get(at))at=n;pending.delete(at);if(at===end)break;visited.add(at);for(const [next,length] of edges[at])if(!visited.has(next)){const cost=costs.get(at)+length;if(!costs.has(next)||cost<costs.get(next)){costs.set(next,cost);previous.set(next,at);pending.add(next);}}}
  if(!costs.has(end))return null;const ids=[end];while(ids[0]!==start){const prev=previous.get(ids[0]);if(prev===undefined)return null;ids.unshift(prev);}
  // Remove grid zigzags only when the actual segment is safe.
  const points=[copy(from)];let index=0;while(index<ids.length-1){let next=ids.length-1;while(next>index+1&&!segmentClear(layout,nodes[ids[index]],nodes[ids[next]]))next--;points.push(copy(nodes[ids[next]]));index=next;}
  return {points,distance:points.slice(1).reduce((n,p,i)=>n+distance(points[i],p),0)};
 }
 function compileMarketLayout({field,stalls=[],aisles=[],obstacles=[],gate}={}){
  const errors=[],fail=m=>({ok:false,errors:[m]});
  if(field?.type!=='Polygon'||!Array.isArray(gate)||!gate.every(Number.isFinite))return fail('早市范围或入口无效');
  const ring=field.coordinates[0];if(!ring?.length||ring.some(p=>!p.every(Number.isFinite)))return fail('早市范围无效');
  const min=[0,1].map(i=>Math.min(...ring.map(p=>p[i]))),max=[0,1].map(i=>Math.max(...ring.map(p=>p[i])));
  if(max.some((v,i)=>v-min[i]>120))return fail('早市单边不得超过120米，请缩小教学场地');
  const layout={version:VERSION,field:copy(field),gate:copy(gate),aisles:copy(aisles),stalls:[],obstacles:copy(obstacles),nodes:[],edges:[]};
  const ids=new Set();
  for(const stall of stalls){
   if(!stall?.id||ids.has(stall.id)||!stall.center?.every(Number.isFinite)||!stall.footprint?.every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(stall.headingDeg)){errors.push('摊位尺寸、朝向或编号无效');continue;}ids.add(stall.id);
   const angle=-stall.headingDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),point=(x,y)=>[stall.center[0]+x*c-y*s,stall.center[1]+x*s+y*c],w=stall.footprint[0]/2,d=stall.footprint[1]/2;
   const footprint=[[-w,-d],[w,-d],[w,d],[-w,d],[-w,-d]].map(p=>point(...p));
   if(!G.containsGeometry(field,{type:'Polygon',coordinates:[footprint]}))errors.push(stall.id+'：摊位越出早市范围');
   layout.obstacles.push(footprint);
   layout.stalls.push({...copy(stall),footprint,service:point(0,-d-.6),vendor:point(0,d+.6),queue:[0,1,2].map(i=>point(0,-d-1.4-i*.8))});
  }
  for(const aisle of aisles)if(!aisle.points?.length||aisle.points.slice(1).some((b,i)=>!segmentClear(layout,aisle.points[i],b)))errors.push('早市通道越界或被摊位、障碍物阻挡');
  if(!clearPoint(layout,gate))errors.push('早市入口越界或被阻挡');
  if(errors.length)return {ok:false,errors};
  const grid=new Map(),step=.8;
  for(let y=min[1];y<=max[1]+1e-7;y+=step)for(let x=min[0];x<=max[0]+1e-7;x+=step){const p=[x,y];if(clearPoint(layout,p)){const id=layout.nodes.length;grid.set(Math.round((x-min[0])/step)+','+Math.round((y-min[1])/step),id);layout.nodes.push(p);layout.edges.push([]);}}
  for(const [key,i] of grid){const [x,y]=key.split(',').map(Number);for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){const j=grid.get((x+dx)+','+(y+dy));if(j!==undefined&&segmentClear(layout,layout.nodes[i],layout.nodes[j])){const d=distance(layout.nodes[i],layout.nodes[j]);layout.edges[i].push([j,d]);layout.edges[j].push([i,d]);}}}
  for(const stall of layout.stalls)for(const p of [stall.service,stall.vendor,...stall.queue])if(!route(layout,gate,p))errors.push(stall.id+'：入口无法通达服务、排队或摊主位置，请调整摊位及通道');
  return {ok:!errors.length,layout:errors.length?undefined:layout,errors};
 }
 return {VERSION,compileMarketLayout,route,segmentClear,contains:(layout,p)=>inside(p,layout.field)};
});
