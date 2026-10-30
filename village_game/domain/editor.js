(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./scene'):root.VillageScene,typeof module==='object'&&module.exports?require('./network'):root.VillageNetwork);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageEditor=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Scene,Network){
  'use strict';
  function corners(b){const a=b.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[b.x+x*b.width/2*c-y*b.depth/2*s,b.y+x*b.width/2*s+y*b.depth/2*c]);}
  function inside(p,polygon){let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
  function overlap(a,b){for(const poly of [a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],axis=[-(q[1]-p[1]),q[0]-p[0]],project=pts=>pts.map(v=>v[0]*axis[0]+v[1]*axis[1]),x=project(a),y=project(b);if(Math.max(...x)<=Math.min(...y)+0.01||Math.max(...y)<=Math.min(...x)+0.01)return false;}return true;}
  function crosses(a,b,c,d){const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;}
  function segmentHits(a,b,poly){return inside(a,poly)||inside(b,poly)||poly.some((p,i)=>crosses(a,b,p,poly[(i+1)%poly.length]));}
  function placement(scene,b){const poly=corners(b);if(poly.some(p=>p[0]<3||p[1]<3||p[0]>scene.size[0]-3||p[1]>scene.size[1]-3))return '建筑占地超出村庄范围';
    if(scene.buildings.some(other=>other.id!==b.id&&overlap(poly,corners(other))))return '这里与已有建筑重叠，请换一个位置';
    for(const road of scene.roads)for(let i=1;i<road.points.length;i++)if(segmentHits(road.points[i-1],road.points[i],poly))return '建筑占用了道路，请放在路旁';
    for(const z of scene.zones)if(z.kind==='water'&&(poly.some(p=>inside(p,z.points))||z.points.some(p=>inside(p,poly))||poly.some((p,i)=>segmentHits(p,poly[(i+1)%poly.length],z.points))))return '这里是水体，请在陆地上建设';
    return null;
  }
  function validateSpatial(scene){for(const b of scene.buildings){const error=placement(scene,b);if(error)return {ok:false,error:b.name+'：'+error};}for(const r of scene.roads){if(r.points.every(p=>p[0]===r.points[0][0]&&p[1]===r.points[0][1]))return {ok:false,error:'道路至少需要两个不同位置'};for(let i=1;i<r.points.length;i++){if(scene.zones.some(z=>z.kind==='water'&&segmentHits(r.points[i-1],r.points[i],z.points)))return {ok:false,error:'本版不支持在水面建设道路'};if(scene.buildings.some(b=>segmentHits(r.points[i-1],r.points[i],corners(b))))return {ok:false,error:'道路穿过了建筑'};}}return {ok:true};}
  function checkScene(scene){const valid=Scene.validate(scene);if(!valid.ok)throw new Error(valid.errors[0]);const spatial=validateSpatial(scene);if(!spatial.ok)throw new Error(spatial.error);Network.buildNetwork(scene);}
  function createEditor(initial){let current=Scene.clone(initial),past=[],future=[];checkScene(current);
    function commit(next){checkScene(next);past.push(Scene.clone(current));if(past.length>60)past.shift();future=[];next.revision=current.revision+1;current=next;return current;}
    function apply(action){const next=Scene.clone(current);
      if(action.type==='add-building'){const b=Scene.clone(action.building);const valid=Scene.validate({...next,buildings:[...next.buildings,b]});if(!valid.ok)throw new Error(valid.errors[0]);const error=placement(next,b);if(error)throw new Error(error);next.buildings.push(b);}
      else if(action.type==='update-building'){const b=next.buildings.find(b=>b.id===action.id);if(!b)throw new Error('未找到建筑');const old={...b};const allowed=['name','type','x','y','width','depth','height','rotation','capacity','open','close','entrance','residents','staff','schoolStage','attraction','level','upgrade'];for(const field of allowed)if(Object.hasOwn(action.patch,field))b[field]=action.patch[field];if(action.patch.type==='kindergarten'&&!Object.hasOwn(action.patch,'schoolStage'))b.schoolStage='preschool';
        if(b.entrance&&!Object.hasOwn(action.patch,'entrance')&&(b.x!==old.x||b.y!==old.y))b.entrance=[b.entrance[0]+b.x-old.x,b.entrance[1]+b.y-old.y];
        if(b.type!==old.type&&next.growth)delete next.growth.facilities[b.id];
        const valid=Scene.validate(next);if(!valid.ok)throw new Error(valid.errors[0]);const error=placement(next,b);if(error)throw new Error(error);}
      else if(action.type==='remove-building'){next.buildings=next.buildings.filter(b=>b.id!==action.id);if(next.growth)delete next.growth.facilities[action.id];}
      else if(action.type==='add-road'){const road=Scene.clone(action.road);const valid=Scene.validate({...next,roads:[...next.roads,road]});if(!valid.ok)throw new Error(valid.errors[0]);if(road.points.every(p=>p[0]===road.points[0][0]&&p[1]===road.points[0][1]))throw new Error('道路至少需要两个不同位置');for(let i=1;i<road.points.length;i++){if(next.zones.some(z=>z.kind==='water'&&segmentHits(road.points[i-1],road.points[i],z.points)))throw new Error('本版不支持在水面建设道路');if(next.buildings.some(b=>segmentHits(road.points[i-1],road.points[i],corners(b))))throw new Error('道路穿过了建筑，请绕开建筑占地');}next.roads.push(road);}
      else if(action.type==='remove-road')next.roads=next.roads.filter(r=>r.id!==action.id);
      else if(action.type==='set-scenario'){if(next.schemaVersion!==2||!action.patch||Object.keys(action.patch).some(k=>!['visitorsPerDay','visitorMix','days','startWeekday','adaptive','visitorMode','living'].includes(k)))throw new Error('不支持的情境修改');Object.assign(next.scenario,Scene.clone(action.patch));}
      else if(action.type==='set-growth'){if(next.schemaVersion!==2)throw new Error('旧版不支持生活成长');next.growth=Scene.clone(action.growth);}
      else if(action.type==='reset'||action.type==='replace'){const replacement=Scene.clone(action.scene||(current.schemaVersion===2?Scene.createIdealVillage():Scene.createVillage()));replacement.revision=current.revision;return commit(replacement);}
      else throw new Error('不支持的编辑操作');
      return commit(next);
    }
    function undo(){if(!past.length)return false;future.push(Scene.clone(current));const old=past.pop();old.revision=current.revision+1;current=old;return true;}
    function redo(){if(!future.length)return false;past.push(Scene.clone(current));const next=future.pop();next.revision=current.revision+1;current=next;return true;}
    return {get scene(){return current;},get canUndo(){return past.length>0;},get canRedo(){return future.length>0;},apply,undo,redo};
  }
  return {createEditor,corners,inside,placement,validateSpatial};
});
