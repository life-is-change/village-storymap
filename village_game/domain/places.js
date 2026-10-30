(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./scene'):root.VillageScene,typeof module==='object'&&module.exports?require('./network'):root.VillageNetwork,typeof module==='object'&&module.exports?require('./schedule'):root.VillageSchedule);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillagePlaces=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Scene,Network,Schedule){
 'use strict';
 const rules=[
  {key:'culture',label:'文化参访与休憩',anchor:'ancestral',partners:[['park','culture']],profiles:['day','overnight','resident'],needs:['view','social','rest']},
  {key:'family',label:'亲子停留配套',anchor:'play',partners:[['park']],profiles:['family','child'],needs:['play','rest','social']},
  {key:'stay',label:'住宿与步行体验',anchor:'inn',partners:[['food'],['attraction','ancestral']],profiles:['overnight'],needs:['stay','food','view','rest']}
 ];
 function intersection(a,b){const out=[];for(const x of a)for(const y of b){const from=Math.max(x[0],y[0]),to=Math.min(x[1],y[1]);if(to>from)out.push([from,to]);}const merged=[];for(const w of out.sort((x,y)=>x[0]-y[0]||x[1]-y[1])){const last=merged.at(-1);if(last&&w[0]<=last[1])last[1]=Math.max(last[1],w[1]);else merged.push([...w]);}return merged;}
 function shiftArrival(person,path,task,offset=0){if(!person||!path||!Number.isFinite(task.deadline))return null;const at=task.start-offset+path.distance/(55*person.mobility);return at<=task.deadline-offset&&at<(task.until||task.deadline)-offset?at:null;}
 function analyze(scene,network=Network.buildNetwork(scene),day=1){
  const binding=Schedule.bind(scene,network),daily=Schedule.residentDay(scene,binding,day).plans,offset=(day-1)*1440,cache=new Map(),windows=new Map();
  const route=(a,b)=>{const key=a+'|'+b;if(!cache.has(key))cache.set(key,Network.route(network,network.access[a],network.access[b]));return cache.get(key);};
  for(const b of scene.buildings){
   let w=[[Math.max(360,b.open*60),Math.min(1440,b.close*60)]].filter(x=>x[1]>x[0]);
   if(!network.connected[b.id])w=[];
   if(Schedule.STAFFED.has(b.type)){
    const shifts=[];for(const id of binding.staff[b.id]||[]){const home=binding.homes[scene.people.find(p=>p.id===id)?.householdId];if(!home||!route(home,b.id))continue;
     for(const t of daily[id]||[])if(t.mode==='work'&&t.target===b.id){const at=shiftArrival(scene.people.find(p=>p.id===id),route(home,b.id),t,offset);if(at!==null)shifts.push([at,(t.until||t.deadline)-offset]);}}
    w=intersection(w,shifts);
   }windows.set(b.id,w);
  }
  const combinations=[];
  for(const rule of rules)for(const anchor of scene.buildings.filter(b=>b.type===rule.anchor)){
   const lists=rule.partners.map(types=>scene.buildings.filter(b=>b.id!==anchor.id&&types.includes(b.type)).map(b=>({b,path:route(anchor.id,b.id)})).sort((a,b)=>(a.path?.distance??Infinity)-(b.path?.distance??Infinity)||a.b.id.localeCompare(b.b.id)).slice(0,8));
   let chosen=null;const inspect=members=>{
    let reason='',w=windows.get(anchor.id)||[],distance=0;
    if(members.length!==rule.partners.length)reason='缺少互补设施';
    else if([anchor,...members].some(b=>!network.connected[b.id]))reason='入口或道路未连通';
    else{for(const b of members){const p=route(anchor.id,b.id);if(!p||p.distance>150){reason='步行配套超过150米或无法互通';break;}distance=Math.max(distance,p.distance);w=intersection(w,windows.get(b.id)||[]);}
     w=w.filter(x=>x[1]-x[0]>=30);if(!reason&&!w.length)reason='共同运营不足30分钟（含人员到岗）';}
    const c={id:rule.key+'-'+anchor.id,key:rule.key,label:rule.label,anchor:anchor.id,ids:[anchor.id,...members.map(b=>b.id)],names:[anchor.name,...members.map(b=>b.name)],profiles:rule.profiles,needs:rule.needs,active:!reason,reason:reason||'道路、配套与运营时段满足',windows:reason?[]:w,distance:Math.round(distance)};
    if(!chosen||c.active&&!chosen.active||c.active===chosen.active&&c.distance<chosen.distance)chosen=c;
   };
   const search=(i,members)=>{if(i===lists.length){inspect(members);return;}if(!lists[i].length){inspect(members);return;}for(const item of lists[i])search(i+1,[...members,item.b]);};search(0,[]);
   combinations.push(chosen);
  }return {combinations};
 }
 function bonus(report,id,profile,minute,need){return report?.combinations?.some(c=>c.active&&c.ids.includes(id)&&c.profiles.includes(profile)&&c.needs.includes(need)&&c.windows.some(w=>minute>=w[0]&&minute<w[1]))?1.2:0;}
 return {analyze,bonus,shiftArrival};
});
