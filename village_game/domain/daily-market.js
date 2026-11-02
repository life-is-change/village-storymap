(function(root,factory){const c=typeof module==='object'&&module.exports,api=factory(c?require('./market-design'):root.VillageMarketDesign,c?require('./market-layout'):root.VillageMarketLayout,c?require('./scene'):root.VillageScene);if(c)module.exports=api;if(root)root.VillageDailyMarket=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Design,Layout,Scene){
 'use strict';
 const clone=v=>JSON.parse(JSON.stringify(v));
 function prepare(scene){const layouts={};
  for(const b of scene.buildings.filter(b=>b.type==='market')){
   b.passable=true;
   if(scene.marketLayouts?.[b.id]){layouts[b.id]=scene.marketLayouts[b.id];continue;}
   if(scene.morningMarket?.marketId===b.id){layouts[b.id]=scene.morningMarket.layout;continue;}
   const shape=Design.geometry(b),ring=shape.field.coordinates[0],bounds=[0,1].map(i=>[Math.min(...ring.map(p=>p[i])),Math.max(...ring.map(p=>p[i]))]);
   const nearby=r=>r&&[0,1].every(i=>Math.max(...r.map(p=>p[i]))>=bounds[i][0]&&Math.min(...r.map(p=>p[i]))<=bounds[i][1]);
   const obstacles=[...(scene.obstacles||[]),...scene.zones.filter(z=>z.kind==='water').map(z=>z.points),...scene.buildings.filter(o=>o!==b&&!o.passable).map(o=>o.footprint||Design.geometry(o).field.coordinates[0])].filter(nearby);
   const result=Layout.compileMarketLayout({...shape,obstacles,gate:b.entrance||shape.gate});
   if(result.ok){layouts[b.id]=result.layout;b.entrance=result.layout.gate;}
  }
  scene.obstacles=scene.obstacles||[];
  for(const layout of Object.values(layouts))scene.obstacles.push(...layout.stalls.map(s=>s.footprint));
  return layouts;
 }
 function create({scene,agents,bindings,layouts,facilities,move,finish,path,log}){
  let day=1,runtime=new Map();const arrivals=new Map(),transactions=[],failures={unreachable:0,unavailable:0,closed:0,capacity:0,time:0},households=new Map();let conversations=0;
  function reset(nextDay){day=nextDay;runtime=new Map(scene.buildings.filter(b=>b.type==='market').map(b=>[b.id,{b,layout:layouts[b.id],stalls:(layouts[b.id]?.stalls||[]).map((s,i)=>({...s,queuePoints:s.queue,vendorId:bindings.staff[b.id]?.[i]||null,status:'absent',queue:[],customerId:null})),arrivals:0,purchases:0}]));for(const a of agents){a.marketRole=null;a.marketState=null;a.dialogue=null;a.purchaseStatus='none';delete a._marketPhase;delete a._marketFailure;}}
  const market=a=>runtime.get(a.active?.marketId||a.active?.target);
  function route(a,m,to,phase){const r=Layout.route(m.layout,[a.x,a.y],to);if(!r)return false;a._marketPhase=phase;move(a,m.b.id,r);return true;}
  function release(a,m){m.admitted?.delete(a.id);for(const s of m.stalls){s.queue=s.queue.filter(id=>id!==a.id);if(s.customerId===a.id){s.customerId=null;const v=agents.find(p=>p.id===s.vendorId);if(v){v.dialogue=null;if(v.marketState==='conversing')v.marketState='open';}}}}
  function finishHome(a){const failure=a._marketFailure;a.marketState='home';a.dialogue=null;a.marketRole=null;delete a._marketPhase;finish(a,failure==='unavailable'?'staff':failure);}
  function leave(a,m,reason){if(a.marketRole==='vendor'){const stall=m.stalls.find(s=>s.vendorId===a.id);if(stall)stall.status='closed';}if(reason&&!a._marketFailure){a._marketFailure=reason;failures[reason]=(failures[reason]||0)+1;log(a.name+'本次早市未完成：'+({unreachable:'路径不通',unavailable:'无摊主营业',closed:'已经收市',capacity:'容量或等候不足',time:'活动超时'}[reason]||reason),'warning');}release(a,m);a.dialogue=null;a.marketState='leaving';if(!m.layout||!route(a,m,m.layout.gate,'gate-out')){a.marketRole=null;delete a._marketPhase;finish(a,reason==='unavailable'?'staff':reason||'unreachable');}}
  function choose(a,m,minute){const cutoff=m.b.marketLastEntryMinute??(m.b.close*60)-30;
   if(minute>=cutoff){leave(a,m,'closed');return;}
   if(!m.admitted)m.admitted=new Set();
   if(m.admitted.size>=Scene.capacity(m.b)){leave(a,m,'capacity');return;}
   const options=m.stalls.filter(s=>s.status==='open'&&s.queue.length<s.queuePoints.length).sort((x,y)=>x.queue.length+!!x.customerId-y.queue.length-!!y.customerId||x.id.localeCompare(y.id));
   if(!options.length){if(minute<m.b.open*60+15){a._marketPhase='opening';a.marketState='waiting-opening';a.state='waiting';return;}leave(a,m,'unavailable');return;}
   const s=options[0],slot=s.queuePoints.findIndex((p,i)=>!s.queue.some(id=>agents.find(a=>a.id===id)?._marketSlot===i));m.admitted.add(a.id);a.stallId=s.id;a._marketSlot=slot;s.queue.push(a.id);a.purchaseStatus='waiting';a._marketWait=minute;a.marketState='queueing';if(!route(a,m,s.queuePoints[slot],'queue-walk'))leave(a,m,'unreachable');
  }
  function enter(a,minute){const m=market(a);if(!m)return false;
   if(!m.layout){reject(a,'unreachable');return true;}
   const phase=a._marketPhase;
   if(phase==='home-out'){finishHome(a);return true;}
   if(phase==='gate-out'){const p=path(m.b.id,a.home);if(!p){a.marketRole=null;delete a._marketPhase;finish(a,'unreachable');return true;}a._marketPhase='home-out';move(a,a.home,p);return true;}
   if(phase==='vendor-walk'){a._marketPhase='preparing';a.marketState='preparing';a.state='working';a._marketReady=minute+3;return true;}
   if(phase==='queue-walk'){a._marketPhase='queued';a.marketState='queued';a.state='waiting';return true;}
   if(phase==='service-walk'){
    const s=m.stalls.find(s=>s.id===a.stallId),v=agents.find(p=>p.id===s?.vendorId);
    if(minute>=(m.b.marketLastEntryMinute??m.b.close*60-30)||!v||v.marketState!=='open'){leave(a,m,'closed');return true;}
    a._marketPhase='talking';a.marketState='conversing';a.state='serving';a._marketTalk=minute;a._marketTransaction=day+':'+a.id+':'+s.id;v.marketState='conversing';
    a.dialogue={partnerId:v.id,speakerId:a.id,transactionId:a._marketTransaction,text:'这些菜今天新鲜吗？'};v.dialogue={...a.dialogue,partnerId:a.id};
    conversations++;log(a.name+'与'+v.name+'在摊前交流买菜。','market');return true;
   }
   if(!phase){a.marketRole=a.active.mode==='market-vendor'?'vendor':'customer';a.marketState='entering';
    if(a.marketRole==='vendor'){const s=m.stalls.find(s=>s.vendorId===a.id);if(!s){finish(a,'staff');return true;}a.stallId=s.id;if(!route(a,m,s.vendor,'vendor-walk'))leave(a,m,'unreachable');}
    else{m.arrivals++;arrivals.set(m.b.id,(arrivals.get(m.b.id)||0)+1);choose(a,m,minute);}return true;
   }
   return false;
  }
  function tick(a,minute){const m=market(a);if(!m||!a.active?.mode.startsWith('market-'))return false;
   if((day-1)*1440+minute>a.active.deadline&&!['gate-out','home-out'].includes(a._marketPhase)){leave(a,m,'time');return true;}
   if(a.state==='moving')return false;
   if(!m.layout){finish(a,'unreachable');return true;}
   const s=m.stalls.find(s=>s.id===a.stallId);
   if(a.marketRole==='vendor'){
    if(minute>=m.b.close*60&&a.marketState!=='conversing'){if(s)s.status='closed';leave(a,m);return true;}
    if(a._marketPhase==='preparing'&&minute>=a._marketReady&&minute>=m.b.open*60){a._marketPhase='selling';a.marketState='open';if(s)s.status='open';log(a.name+'到岗，摊位开始营业。','market');}
    a.state='working';
   }else if(a._marketPhase==='opening')choose(a,m,minute);
   else if(a._marketPhase==='queued'){
    if(minute>=(m.b.marketLastEntryMinute??m.b.close*60-30))leave(a,m,'closed');else if(minute-a._marketWait>15)leave(a,m,'capacity');else if(s?.queue[0]===a.id&&!s.customerId&&s.status==='open'){s.customerId=a.id;s.queue.shift();a.marketState='approaching';if(!route(a,m,s.service,'service-walk'))leave(a,m,'unreachable');}
   }else if(a._marketPhase==='talking'){
    const v=agents.find(p=>p.id===s?.vendorId),elapsed=minute-a._marketTalk;
    if(!v||v.marketState!=='conversing'){leave(a,m,'unavailable');return true;}
    const speaker=elapsed<3?a:v,text=elapsed<3?'这些菜今天新鲜吗？':'都是今早的，给你挑这一份。';
    a.dialogue={partnerId:v.id,speakerId:speaker.id,transactionId:a._marketTransaction,text};v.dialogue={...a.dialogue,partnerId:a.id};
    if(elapsed>=6){const tx={id:a._marketTransaction,day,minute,customerId:a.id,vendorId:v.id,householdId:a.householdId,stallId:s.id,marketId:m.b.id,produceKind:s.produceKind};transactions.push(tx);households.set(day+':'+a.householdId,tx.id);m.purchases++;a.purchaseStatus='purchased';log(a.name+'买好菜，沿村路返家。','market');leave(a,m);}
   }
   
   return true;
  }
  function sync(){for(const m of runtime.values()){const f=facilities[m.b.id];if(!f)continue;f.staffPresent=m.stalls.filter(s=>s.status==='open').length;f.occupancy=m.admitted?.size||0;f.peak=Math.max(f.peak,f.occupancy);f.served=transactions.filter(t=>t.marketId===m.b.id).length;}}
  function result(){return {purchases:transactions.length,conversations,householdsSupplied:households.size,failures:{...failures},transactions:clone(transactions),markets:[...runtime.values()].map(m=>({id:m.b.id,name:m.b.name,stalls:m.stalls.length,vendors:m.stalls.filter(s=>s.vendorId).length,arrivals:arrivals.get(m.b.id)||0,todayArrivals:m.arrivals,purchases:transactions.filter(t=>t.marketId===m.b.id).length,todayPurchases:m.purchases,window:{openMinute:m.b.open*60,lastEntryMinute:m.b.marketLastEntryMinute??m.b.close*60-30,endMinute:m.b.close*60}}))};}
  function reject(a,reason){failures[reason]=(failures[reason]||0)+1;a.marketRole=null;a.marketState='failed';finish(a,reason);}
  return {reset,enter,tick,result,sync,reject};
 }
 return {prepare,create};
});
