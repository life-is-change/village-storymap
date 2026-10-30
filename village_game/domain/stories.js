(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./decision'):root.VillageDecision);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageStories=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Decision){
 'use strict';
 const titles={chat:'邻里交流',guide:'游客文化问询',craft:'手作经验交流'};
 function create(scene,options={}){
  const active=new Map(),uses=new Map(),venues=new Map();let sequence=0,completed=0,cancelled=0;
  const dayAt=at=>Math.floor(at/1440)+1,key=(id,at)=>dayAt(at)+'|'+id;
  const available=(a,b,at)=>a.active&&['serving','resting'].includes(a.state)&&a.age>=6&&b&&['park','ancestral','culture','play','night','workshop'].includes(b.type)&&at%1440>=b.open*60&&at%1440<b.close*60&&a.active.deadline>=at+5&&a.remaining>=6;
  function tick(agents,buildings,at,onComplete){
   const byId=new Map(agents.map(a=>[a.id,a]));
   for(const [id,event] of active){const pair=event.ids.map(id=>byId.get(id)),b=buildings.get(event.place);
    const valid=b&&at%1440<b.close*60&&at%1440>=b.open*60&&pair.every((a,i)=>a&&a.node===event.place&&a.active?.id===event.tasks[i]&&['serving','resting'].includes(a.state));
    if(!valid||at>=event.until){for(const a of pair.filter(Boolean))a.interaction={...a.interaction,status:valid?'completed':'cancelled',until:at};active.delete(id);if(valid){completed++;onComplete(pair,event);}else cancelled++;}
   }
   if(at%5)return;
   const eligible=agents.filter(a=>available(a,buildings.get(a.node),at)&&!a.interaction?.status?.includes('active')&&at-(a.lastEncounter??-1000)>=90&&(uses.get(key(a.id,at))||0)<2);
   for(let i=0;i<eligible.length;i++){
    const a=eligible[i],bld=buildings.get(a.node);if(a.interaction?.status==='active'||(venues.get(key(a.node,at))||0)>=4)continue;
    const b=eligible.slice(i+1).find(q=>q.interaction?.status!=='active'&&q.groupId!==a.groupId&&q.node===a.node&&Math.hypot(q.x-a.x,q.y-a.y)<=12);if(!b)continue;
    const kind=bld.type==='workshop'?'craft':a.kind!==b.kind&&(a.kind==='resident'||b.kind==='resident')&&['ancestral','culture','park'].includes(bld.type)?'guide':'chat';
    const rng=options.random||Decision.random(scene.scenario.seed,dayAt(at),'story-'+at+'-'+a.id+'-'+b.id);if(rng()>.12+((a.needsState?.social||0)+(b.needsState?.social||0))*.001)continue;
    const event={id:'story-'+(++sequence),kind,title:titles[kind],place:a.node,ids:[a.id,b.id],tasks:[a.active.id,b.active.id],start:at,until:at+5};active.set(event.id,event);venues.set(key(a.node,at),(venues.get(key(a.node,at))||0)+1);
    for(const [p,other] of [[a,b],[b,a]]){p.lastEncounter=at;uses.set(key(p.id,at),(uses.get(key(p.id,at))||0)+1);p.interaction={...event,otherId:other.id,otherName:other.name,status:'active'};}
   }
  }return {tick,summary:()=>({completed,cancelled,active:active.size})};
 }
 return {create,titles};
});
