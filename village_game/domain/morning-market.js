(function(root,factory){const c=typeof module==='object'&&module.exports,api=factory(c?require('./scene'):root.VillageScene,c?require('./network'):root.VillageNetwork,c?require('./market-layout'):root.VillageMarketLayout);if(c)module.exports=api;if(root)root.VillageMorningMarket=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Scene,Network,Layout){
 'use strict';
 const VERSION='morning-market-1',copy=v=>JSON.parse(JSON.stringify(v)),distance=Network.distance;
 function createSimulation(input){
  const scene=copy(input),valid=Scene.validate(scene);if(!valid.ok)throw Error(valid.errors.join('；'));
  const market=scene.morningMarket;if(!market?.layout||!market.roles?.length)throw Error('早市布局和角色尚未编译');
  const times=market.times,layout=market.layout,network=Network.buildNetwork(scene),buildings=new Map(scene.buildings.map(b=>[b.id,b]));
  const roleMap=new Map(market.roles.map(r=>[r.personId,r]));if(roleMap.size!==market.roles.length)throw Error('早市人物角色重复');
  const failures={missing:0,unreachable:0,closed:0,capacity:0,time:0},marketFailures={unavailable:0,waitTimeout:0,capacity:0,closed:0,unreachable:0,end:0},events=[],transactions=[],purchases=new Set();
  let minute=times.startMinute,carry=0,done=false,walkMinutes=0,walkTrips=0,arrivals=0;
  const stalls=layout.stalls.map(s=>({...s,queuePoints:s.queue,vendorId:market.roles.find(r=>r.marketRole==='vendor'&&r.stallId===s.id)?.personId||null,queue:[],customerId:null,served:0,status:'awaiting-vendor'}));
  const byStall=new Map(stalls.map(s=>[s.id,s]));let vendorIndex=0,customerIndex=0;
  const agents=scene.people.map(p=>{
   const role=roleMap.get(p.id),home=role?.homeId||scene.households.find(h=>h.id===p.householdId)?.homeId,b=buildings.get(home),position=b?.entrance||[b?.x||0,b?.y||0],index=role?.marketRole==='vendor'?vendorIndex++:role?.marketRole==='customer'?customerIndex++:0;
   return {...p,kind:'resident',home,node:home,x:position[0],y:position[1],state:'home',marketState:'home',purchaseStatus:'none',marketRole:role?.marketRole||null,stallId:role?.stallId||null,route:null,pathIndex:0,target:null,completed:0,failed:0,history:[],dialogue:null,_phase:role?'scheduled':'inactive',_depart:role?.departMinute??(role?.marketRole==='vendor'?times.startMinute+index*2:times.openMinute+index*4+Math.abs(scene.scenario.seed)%4),_wait:0,_after:null};
  });
  const byId=new Map(agents.map(a=>[a.id,a]));
  function log(type,a,extra={}){const event={type,day:1,minute,personId:a?.id||null,text:({departure:'从住宅出发','stall-open':'摊位开始营业','customer-enter':'村民进入早市',dialogue:'摊前交流',purchase:'完成购买','customer-home':'村民返家','vendor-home':'摊主返家','stall-closed':'摊位收摊',failure:'本次未购买'}[type]||type)+(a?' · '+a.name:''),kind:type==='failure'?'warning':'info',...extra};events.push(event);if(a)a.history.push(event);}
  function fail(a,reason){if(a.failureReason)return;a.failureReason=reason;a.failed++;const key=reason==='waitTimeout'||reason==='capacity'?'capacity':reason==='unavailable'?'closed':reason==='end'?'time':reason;failures[key]=(failures[key]||0)+1;marketFailures[reason]=(marketFailures[reason]||0)+1;log('failure',a,{reason});}
  const uniquePoints=points=>points.filter((p,i)=>i===0||distance(p,points[i-1])>1e-7).map(p=>p.slice());
  function move(a,points,after,target){
   if(!points){fail(a,'unreachable');a.state='blocked';a.marketState='blocked';a._phase='blocked';return false;}
   a.route=uniquePoints([[a.x,a.y],...points]);a.pathIndex=1;a.state='moving';a._phase='moving';a._after=after;a.target=target;a.marketState=after==='vendor-prepare'?'arriving':after==='choose'?'entering':after==='home'?'leaving':after==='service'?'approaching':'queueing';walkTrips++;
   if(a.route.length<2)arrive(a);return true;
  }
  function external(a,reverse=false){const p=Network.route(network,network.access[a.home],network.access[market.marketId]);return p?(reverse?[...p.points].reverse():p.points):null;}
  function insidePath(from,to){return Layout.route(layout,from,to)?.points||null;}
  function removeQueue(a){for(const s of stalls){s.queue=s.queue.filter(id=>id!==a.id);if(s.customerId===a.id){s.customerId=null;const v=byId.get(s.vendorId);if(v&&v.marketState==='conversing'){v.marketState='open';v.state='working';v.dialogue=null;}}}}
  function returnHome(a){
   removeQueue(a);a.dialogue=null;
   const outdoor=external(a,true);if(!outdoor){fail(a,'unreachable');a.state='blocked';a.marketState='blocked';a._phase='blocked';return;}
   const inner=insidePath([a.x,a.y],layout.gate);if(!inner){fail(a,'unreachable');a.state='blocked';a.marketState='blocked';a._phase='blocked';return;}
   move(a,[...inner,...outdoor],'home',a.home);
  }
  function open(s){const v=byId.get(s.vendorId);return v&&['open','conversing'].includes(v.marketState)&&minute>=times.openMinute&&minute<times.lastEntryMinute;}
  function choose(a){
   if(minute>=times.lastEntryMinute){fail(a,'closed');returnHome(a);return;}
   const choices=stalls.filter(s=>open(s)&&s.queue.length<3).map(s=>{const slot=[0,1,2].find(i=>!s.queue.some(id=>byId.get(id)?._queueSlot===i));return {s,slot,route:slot===undefined?null:insidePath([a.x,a.y],s.queuePoints[slot])};}).filter(o=>o.route).sort((a,b)=>(a.s.queue.length+!!a.s.customerId)-(b.s.queue.length+!!b.s.customerId)||a.s.id.localeCompare(b.s.id));
   if(!choices.length){
    if(!stalls.some(open)&&minute<times.openMinute+15){a._phase='waiting-opening';a._wait=a._wait||minute;a.state='waiting';a.marketState='waiting-opening';return;}
    fail(a,stalls.some(open)?'capacity':'unavailable');returnHome(a);return;
   }
   const choice=choices[Math.abs((scene.scenario.seed+a.id.length)%Math.min(choices.length,2))];a.stallId=choice.s.id;a._queueSlot=choice.slot;choice.s.queue.push(a.id);a._wait=minute;a.purchaseStatus='waiting';move(a,choice.route,'queue',market.marketId);
  }
  function arrive(a){
   a.route=null;a.pathIndex=0;a.node=a.target;
   if(a._after==='home'){a.state='home';a.marketState='home';a._phase='finished';log(a.marketRole==='vendor'?'vendor-home':'customer-home',a);return;}
   if(a._after==='vendor-prepare'){a.state='working';a.marketState='preparing';a._phase='preparing';a._ready=minute+3;return;}
   if(a._after==='choose'){arrivals++;log('customer-enter',a);choose(a);return;}
   if(a._after==='queue'){a.state='waiting';a.marketState='queued';a._phase='queued';return;}
   if(a._after==='service'){
    const s=byStall.get(a.stallId),v=byId.get(s?.vendorId);
    if(!s||!v||!['open','conversing'].includes(v.marketState)){fail(a,'unavailable');returnHome(a);return;}
    a.state='serving';a.marketState='conversing';a._phase='conversing';a._serviceStart=minute;a._transaction=market.marketId+':'+a.id+':'+s.id;
    v.marketState='conversing';v.state='serving';log('dialogue',a,{stallId:s.id,vendorId:v.id,transactionId:a._transaction});
   }
  }
  function advance(a){let left=45*(a.mobility||1);while(a.route&&a.pathIndex<a.route.length&&left>1e-8){const next=a.route[a.pathIndex],length=distance([a.x,a.y],next);if(length<=left+1e-8){a.x=next[0];a.y=next[1];left-=length;a.pathIndex++;}else{const t=left/length;a.x+=(next[0]-a.x)*t;a.y+=(next[1]-a.y)*t;left=0;}}walkMinutes++;if(a.route&&a.pathIndex>=a.route.length)arrive(a);}
  function completePurchase(a){const s=byStall.get(a.stallId);if(!s?.vendorId||!byId.get(s.vendorId)||purchases.has(a.id)){fail(a,'unavailable');returnHome(a);return;}
   const transaction={id:a._transaction,customerId:a.id,vendorId:s.vendorId,stallId:s.id,produceKind:s.produceKind,minute};transactions.push(transaction);purchases.add(a.id);s.served++;a.purchaseStatus='purchased';a.completed++;log('purchase',a,{transactionId:transaction.id,stallId:s.id});returnHome(a);
  }
  function tick(){
   minute++;
   for(const a of agents){
    if(!a.marketRole)continue;
    if(a._phase==='scheduled'&&minute>=a._depart){
     if(minute>=times.lastEntryMinute){fail(a,'closed');a._phase='finished';continue;}
     const s=byStall.get(a.stallId),outdoor=external(a),inner=a.marketRole==='vendor'&&s?insidePath(layout.gate,s.vendor):[layout.gate];
     if(!outdoor||!inner){fail(a,'unreachable');a.state='blocked';a.marketState='blocked';a._phase='blocked';continue;}
     log('departure',a);move(a,[...outdoor,...inner],a.marketRole==='vendor'?'vendor-prepare':'choose',market.marketId);
    }else if(a._phase==='moving')advance(a);
    else if(a._phase==='preparing'&&minute>=a._ready&&minute>=times.openMinute){const s=byStall.get(a.stallId);if(s){a.marketState='open';a._phase='open';s.status='open';log('stall-open',a,{stallId:s.id});}}
    else if(a._phase==='waiting-opening'){if(minute-a._wait>=15){fail(a,'unavailable');returnHome(a);}else choose(a);}
    else if(a._phase==='conversing'&&minute-a._serviceStart>=6)completePurchase(a);
    if(a.marketRole==='customer'&&['queued','moving'].includes(a._phase)&&['queued','queueing'].includes(a.marketState)&&minute-a._wait>=15){fail(a,'waitTimeout');returnHome(a);}
   }
   for(const s of stalls){
    const vendor=byId.get(s.vendorId);s.status=!vendor?'absent':vendor._phase==='finished'?'closed':['open','conversing'].includes(vendor.marketState)?'open':vendor.marketState;
    if(s.customerId===null&&vendor&&['open','conversing'].includes(vendor.marketState)&&s.queue.length){const next=byId.get(s.queue[0]);if(next?._phase==='queued'){s.queue.shift();s.customerId=next.id;move(next,insidePath([next.x,next.y],s.service),'service',market.marketId);}}
    if(minute>=times.lastEntryMinute){for(const id of [...s.queue]){const a=byId.get(id);fail(a,'closed');returnHome(a);}if(vendor&&vendor._phase==='open'&&!s.customerId&&minute>=times.lastEntryMinute+stalls.indexOf(s)*2+3){s.status='closed';log('stall-closed',vendor,{stallId:s.id});returnHome(vendor);}}
   }
   if(minute>=times.endMinute){
    for(const a of agents)if(a.marketRole&&!['finished','blocked'].includes(a._phase)){fail(a,'end');removeQueue(a);a.dialogue=null;a.route=null;a.state='idle';a.marketState='unfinished';a._phase='finished';}
    done=true;minute=times.endMinute;carry=0;
   }
  }
  function marketSummary(){return {purchases:transactions.length,servedCustomers:purchases.size,returnedCustomers:agents.filter(a=>a.marketRole==='customer'&&a.state==='home'&&a.history.some(e=>e.type==='customer-home')).length,returnedVendors:agents.filter(a=>a.marketRole==='vendor'&&a.state==='home'&&a.history.some(e=>e.type==='vendor-home')).length,failures:copy(marketFailures),transactions:copy(transactions),events:copy(events),unreturned:agents.filter(a=>a.marketRole&&a.state!=='home').map(a=>({id:a.id,reason:a.failureReason||'end'}))};}
  function result(){return {runKind:'morning-market',behaviorVersion:VERSION,ruleVersion:1,revision:scene.revision,seed:scene.scenario.seed,days:0,done,window:copy(times),scenario:copy(scene.scenario),resident:{total:customerIndex,completed:purchases.size},visitor:{total:0,completed:0},failures:copy(failures),housingShortage:0,arrivals,walkMinutes,walkTrips,averageWalkMinutes:walkTrips?Math.round(walkMinutes/walkTrips*10)/10:0,satisfaction:{average:customerIndex?Math.round(purchases.size/customerIndex*100):0},encounters:events.filter(e=>e.type==='dialogue').length,market:marketSummary()};}
  function snapshot(){return {runKind:'morning-market',day:1,minute,progress:carry,done,calendar:{label:'一次早市',weekday:scene.scenario.startWeekday,weekend:false},agents:agents.map(a=>{
   const clean=Object.fromEntries(Object.entries(a).filter(([k])=>!k.startsWith('_')));let dialogue=null;
   const customer=a.marketState==='conversing'?(a.marketRole==='customer'?a:byId.get(byStall.get(a.stallId)?.customerId)):null;
   if(customer){const s=byStall.get(customer.stallId),vendor=byId.get(s.vendorId),elapsed=minute-customer._serviceStart,customerTurn=elapsed%2===0,speakerId=customerTurn?customer.id:vendor.id,goods={vegetables:'青菜',fruit:'鲜果',tofu:'豆腐'}[s.produceKind]||'菜';dialogue={partnerId:a.id===customer.id?vendor.id:customer.id,speakerId,transactionId:customer._transaction,text:customerTurn?(elapsed<2?'早上好，今天的'+goods+'新鲜吗？':'麻烦帮我选一份'+goods+'。'):(elapsed<3?'今早刚备好的，您看看。':'好嘞，这份给您，慢走！'),until:customer._serviceStart+6};}
   return {...copy(clean),dialogue,interaction:dialogue?{status:'active',partnerId:dialogue.partnerId,until:dialogue.until,text:dialogue.text}:null,marketInside:a.node===market.marketId||a.marketState==='leaving',agenda:[],occupation:a.marketRole==='vendor'?'早市摊主':a.marketRole==='customer'?'买菜村民':null};
  }),households:copy(scene.households),facilities:{[market.marketId]:{occupancy:agents.filter(a=>['conversing','queued','preparing','open'].includes(a.marketState)).length,served:transactions.length,queued:stalls.reduce((n,s)=>n+s.queue.length,0)}},market:{...marketSummary(),phase:done?'finished':minute<times.openMinute?'preparing':minute<times.lastEntryMinute?'open':'closing',stalls:stalls.map(s=>({id:s.id,vendorId:s.vendorId,customerId:s.customerId,queue:s.queue.slice(),served:s.served,status:s.status}))},metrics:result(),events:copy(events.slice(-35).reverse()),roadFlows:{}};}
  return {network,step(minutes=1){if(!Number.isFinite(minutes)||minutes<0)throw Error('推进时间无效');if(done)return true;carry+=Math.min(minutes,360);while(carry>=1-1e-9&&!done){carry=Math.max(0,carry-1);tick();}return done;},snapshot,result,runToEnd(){while(!done)tick();return result();}};
 }
 return {VERSION,createSimulation};
});
