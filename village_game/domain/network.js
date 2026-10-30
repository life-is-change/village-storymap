(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./scene'):root.VillageScene);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageNetwork=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Scene){
  'use strict';
  const ACCESS_DISTANCE=26;
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  function project(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],sq=dx*dx+dy*dy;const t=sq?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/sq)):0;return {point:[a[0]+t*dx,a[1]+t*dy],t};}
  function intersection(a,b,c,d){const x=b[0]-a[0],y=b[1]-a[1],u=d[0]-c[0],v=d[1]-c[1],cross=x*v-y*u;if(Math.abs(cross)<1e-8)return null;const t=((c[0]-a[0])*v-(c[1]-a[1])*u)/cross,s=((c[0]-a[0])*y-(c[1]-a[1])*x)/cross;return t>=-1e-8&&t<=1+1e-8&&s>=-1e-8&&s<=1+1e-8?[a[0]+t*x,a[1]+t*y]:null;}
  function inside(p,poly){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
  function blocked(a,b,polygons){if(distance(a,b)<.01)return false;return polygons.some(poly=>{if(inside(a,poly)||inside(b,poly))return true;return poly.some((p,i)=>{const hit=intersection(a,b,p,poly[(i+1)%poly.length]);return hit&&distance(hit,a)>.01&&distance(hit,b)>.01;});});}
  function withinBoundary(a,b,poly){if(!poly)return true;const contains=p=>inside(p,poly)||poly.some((q,i)=>distance(p,project(p,q,poly[(i+1)%poly.length]).point)<.001);if(!contains(a)||!contains(b))return false;
    const ts=[0,1];poly.forEach((p,i)=>{const hit=intersection(a,b,p,poly[(i+1)%poly.length]);if(hit)ts.push(project(hit,a,b).t);});ts.sort((x,y)=>x-y);return ts.slice(1).every((t,i)=>{const u=(t+ts[i])/2;return contains([a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u]);});
  }
  function buildNetwork(scene){
    const segments=[];for(const road of scene.roads)for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i];if(distance(a,b)>0.01)segments.push({a,b,cuts:[a,b]});}
    const limit=Scene.roadSegmentLimit(scene);if(segments.length>limit)throw new Error('路网过于复杂，请简化到 '+limit+' 段以内');let intersections=0;
    for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
      const a=segments[i],b=segments[j],hit=intersection(a.a,a.b,b.a,b.b);if(hit){if(++intersections>2000)throw new Error('道路交点过于复杂，请简化道路交叉');a.cuts.push(hit);b.cuts.push(hit);}else{
        for(const p of [a.a,a.b])if(distance(project(p,b.a,b.b).point,p)<0.01)b.cuts.push(p);
        for(const p of [b.a,b.b])if(distance(project(p,a.a,a.b).point,p)<0.01)a.cuts.push(p);
      }
    }
    const gatePoints=scene.scenario.entries?.length?scene.scenario.entries:[scene.scenario.entry];
    const gateIds=gatePoints.map((_,i)=>i?'entry:'+i:'entry');
    const connections=[];const inputs=[...gatePoints.map((point,i)=>({id:gateIds[i],point})),...scene.buildings.map(b=>({id:b.id,point:Scene.entrance(b)}))];
    const obstacles=[...(scene.obstacles||[]),...(scene.zones||[]).filter(z=>z.kind==='water').map(z=>z.points),...scene.buildings.filter(b=>!b.passable&&Number.isFinite(b.x)&&Number.isFinite(b.width)).map(b=>{if(b.footprint)return b.footprint;const a=(b.rotation||0)*Math.PI/180;return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[b.x+x*b.width/2*Math.cos(a)-y*b.depth/2*Math.sin(a),b.y+x*b.width/2*Math.sin(a)+y*b.depth/2*Math.cos(a)]);})];
    for(const input of inputs){let best=null,nearest=null;for(const s of segments){const p=project(input.point,s.a,s.b),gap=distance(input.point,p.point);if(!nearest||gap<nearest.gap)nearest={point:p.point,gap};if(gap<=ACCESS_DISTANCE&&(!best||gap<best.gap)&&!blocked(input.point,p.point,obstacles)&&withinBoundary(input.point,p.point,scene.walkBoundary))best={segment:s,point:p.point,gap};}
      if(best){best.segment.cuts.push(best.point);connections.push({...input,roadPoint:best.point,gap:best.gap});}else connections.push({...input,roadPoint:null,nearest});}
    const nodes={},edges={},access={},links=[];const key=p=>p.map(n=>Math.round(n*100)/100).join(',');
    let nodeCount=0;const node=p=>{const id=key(p);if(!nodes[id]){if(++nodeCount>5000)throw new Error('路网节点过于复杂，请简化道路');nodes[id]=p;edges[id]=[];}return id;};
    const connect=(a,b)=>{const i=node(a),j=node(b);if(i===j)return;const len=distance(a,b);if(!edges[i].some(e=>e.id===j)){edges[i].push({id:j,distance:len});edges[j].push({id:i,distance:len});}};
    for(const s of segments){s.cuts.sort((p,q)=>project(p,s.a,s.b).t-project(q,s.a,s.b).t);for(let i=1;i<s.cuts.length;i++)connect(s.cuts[i-1],s.cuts[i]);}
    for(const c of connections){if(c.roadPoint){access[c.id]=node(c.point);connect(c.point,c.roadPoint);links.push({id:c.id,points:[c.point,c.roadPoint]});}else access[c.id]=null;}
    const visited=new Set(),pending=gateIds.map(id=>access[id]).filter(Boolean);while(pending.length){const id=pending.pop();if(visited.has(id))continue;visited.add(id);for(const e of edges[id])if(!visited.has(e.id))pending.push(e.id);}
    const connected={};for(const [id,key] of Object.entries(access))connected[id]=!!key&&visited.has(key);
    const accessDiagnostics=Object.fromEntries(connections.map(c=>[c.id,{
      reason:connected[c.id]?'connected':c.roadPoint?'disconnected':!c.nearest?'no-roads':c.nearest.gap>ACCESS_DISTANCE?'too-far':'blocked',
      point:c.point.slice(),roadPoint:(c.roadPoint||c.nearest?.point)?.slice()||null,distance:c.gap??c.nearest?.gap??null
    }]));
    return {nodes,edges,access,links,connected,accessDiagnostics,gateIds};
  }
  function routeOne(net,from,to){
    if(!from||!to||!net.nodes[from]||!net.nodes[to])return null;
    const costs={[from]:0},previous={},pending=new Set([from]),visited=new Set();
    while(pending.size){let current=null;for(const id of pending)if(current===null||costs[id]<costs[current])current=id;pending.delete(current);if(current===to)break;visited.add(current);
      for(const edge of net.edges[current]){if(visited.has(edge.id))continue;const next=costs[current]+edge.distance;if(costs[edge.id]===undefined||next<costs[edge.id]){costs[edge.id]=next;previous[edge.id]=current;pending.add(edge.id);}}
    }
    if(costs[to]===undefined)return null;const ids=[to];while(ids[0]!==from){if(!previous[ids[0]])return null;ids.unshift(previous[ids[0]]);}return {points:ids.map(id=>net.nodes[id]),distance:costs[to]};
  }
  function routeToEntry(net,from){
    if(net.gateIds?.length>1){let best=null;for(const id of net.gateIds){const p=routeOne(net,from,net.access[id]);if(p&&(!best||p.distance<best.distance))best={...p,entryId:id};}return best;}
    return routeOne(net,from,net.access.entry);
  }
  function nearestRoad(scene,p,max=12){let best=null;for(const road of scene.roads)for(let i=1;i<road.points.length;i++){const q=project(p,road.points[i-1],road.points[i]).point,d=distance(q,p);if(d<=max&&(!best||d<best.distance))best={point:q,distance:d,roadId:road.id};}return best;}
  return {ACCESS_DISTANCE,distance,project,buildNetwork,route:routeOne,routeToEntry,nearestRoad};
});
