(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../domain/scene'):root.VillageScene);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageObservation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Scene){
 'use strict';
 const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 function interpolate(previous,current,alpha){
  if(!current)return null;
  if(!previous||previous.day!==current.day||current.minute-previous.minute!==1||current.done)return current;
  const before=new Map(previous.agents.map(a=>[a.id,a]));alpha=Math.max(0,Math.min(1,alpha));
  return {...current,agents:current.agents.map(a=>{
   const old=before.get(a.id);if(!old||old.state!=='moving'||!old.route||old.target!==a.target&&a.state==='moving')return {...a};
   const end=a.route&&a.target===old.target?a.pathIndex:a.node===old.target?old.route.length:old.pathIndex;
   const points=[[old.x,old.y],...old.route.slice(old.pathIndex,Math.max(old.pathIndex,end)),[a.x,a.y]];
   let total=0;for(let i=1;i<points.length;i++)total+=distance(points[i-1],points[i]);let left=total*alpha,position=points.at(-1);
   for(let i=1;i<points.length;i++){const len=distance(points[i-1],points[i]);if(left<=len&&len>0){position=points[i-1].map((n,j)=>n+(points[i][j]-n)*left/len);break;}left-=len;}
   return {...a,x:position[0],y:position[1],inTransit:alpha<1,displayRoute:old.route};
  })};
 }
 function location(scene,a){const b=scene.buildings.find(b=>b.id===(a.state==='moving'?a.target:a.node||a.target||a.home)),indoor=a.interaction?.status!=='active'&&!a.inTransit&&!['moving','outside','planned','departed'].includes(a.state)&&b&&!['farm','park','play','attraction','night'].includes(b.type);return {name:a.state==='outside'?'村外学习／工作':a.state==='planned'?'尚未到村':a.state==='departed'?'已经离村':a.state==='moving'?'道路上，前往'+(b?.name||'村口'):b?.name||'村口',indoor:!!indoor};}
 function layout(scene,snapshot){
  if(!snapshot)return null;
  return {...snapshot,agents:snapshot.agents.map(a=>{let hash=0;for(const c of a.id)hash=(hash*31+c.charCodeAt(0))>>>0;const x=(hash%5-2)*1.4,y=(Math.floor(hash/5)%3-1)*1.4;return {...a,x:a.x+x,y:a.y+y,indoor:location(scene,a).indoor};})};
 }
 function facility(scene,snapshot,network,id,expectedType='food'){
  const b=scene.buildings.find(b=>b.id===id),f=snapshot?.facilities[id],related=(snapshot?.agents||[]).filter(a=>a.target===id);
  const data={building:b,occupancy:f?.occupancy||0,capacity:b?Scene.capacity(b):0,waiting:related.filter(a=>a.state==='waiting').length,incoming:related.filter(a=>a.state==='moving').length,queued:f?.queued||0,served:f?.served||0,people:related};
  data.reason=!b?'missing':expectedType&&b.type!==expectedType?'repurposed':!network?.connected[id]?'unreachable':snapshot?.done?'complete':snapshot&&(snapshot.minute<b.open*60||snapshot.minute>=b.close*60)?'closed':data.waiting>0?'capacity':!snapshot?'ready':data.incoming>0?'incoming':data.occupancy>0?'serving':'quiet';
  const messages={complete:'三日运行已结束：完成服务 '+data.served+' 次，累计等候 '+data.queued+' 次。查看结果，再尝试另一种设计。',missing:'这处设施已移除。可新增餐饮，再连接步道。',repurposed:'这栋建筑已改为其他用途。可在附近补充餐饮。',unreachable:'入口没有接通村口。先检查入口和步道。',closed:'现在不在开放时间内。检查开放时段是否覆盖就餐活动。',capacity:'有人已到达，但接待位正在使用。可扩容，或在另一处补充餐饮分担。',ready:'先观察一次食堂就餐，再决定要改哪里。',incoming:'有人正在前往这里。点击来客，看他从哪里走来。',serving:'正在提供服务。观察接待位是否够用。',quiet:'目前没有就餐活动。可继续观察或推进至结算。'};
  data.message=messages[data.reason];return data;
 }
 function visible(a){return !['planned','departed','outside'].includes(a.state);}
 function personColor(a){return a.kind==='visitor'?({family:'#9673ad',overnight:'#bb6d86'})[a.profile]||'#bf6228':a.ageGroup==='child'?'#4c88b8':a.ageGroup==='senior'?'#bd9142':'#26765b';}
 function relevant(a,ui){if(ui.selected?.kind==='agent'&&ui.selected.id===a.id)return true;const filters=(!ui.profileFilter||ui.profileFilter==='all'||a.profile===ui.profileFilter)&&(!ui.flowFilter||ui.flowFilter==='all'||a.activityGroup===ui.flowFilter);return filters&&(ui.focusId?a.target===ui.focusId:ui.selected?.kind==='agent'?false:true);}
 function labelVisible(b,ui){if(ui.selected?.kind==='building'&&ui.selected.id===b.id||ui.focusId===b.id)return true;if(!ui.labels)return false;if(ui.focusPoint)return Math.hypot(b.x-ui.focusPoint[0],b.y-ui.focusPoint[1])<80&&b.type!=='home';return b.type!=='home'&&b.overviewLabel!==false;}
 function seekMeal(sim,id,endMinute){let snapshot=sim.snapshot(),found=false;while(snapshot.day===1&&snapshot.minute<endMinute-1){if(snapshot.agents.some(a=>a.target===id&&a.state==='moving'&&a.need==='food')){found=true;break;}sim.step(1);snapshot=sim.snapshot();}return {found,snapshot};}
 function isChatting(a,snapshot){return ['serving','resting'].includes(a.state)&&a.interaction?.until>(snapshot.day-1)*1440+snapshot.minute;}
 return {interpolate,layout,location,facility,relevant,labelVisible,seekMeal,visible,personColor,isChatting};
});
