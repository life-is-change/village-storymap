const test=require('node:test'),assert=require('node:assert/strict'),Scene=require('./scene'),Sim=require('./simulation'),Schedule=require('./schedule'),Network=require('./network');
function village(){const s=Scene.createLivingVillage();s.scenario.days=2;s.scenario.visitorsPerDay=0;if(!s.buildings.some(b=>b.type==='market'))s.buildings.push({...Scene.createBuilding('market',285,178,'daily-market',2),width:24,depth:12,height:1,open:6.5,close:10,staff:3,capacity:30});return s;}
test('a market is part of the same full day, with real residents, dialogue, purchase and later family life',()=>{
 const s=village(),sim=Sim.createSimulation(s),ids=s.people.map(p=>p.id);let conversations=0,purchases=new Set(),later=false;
 for(let i=0;i<1440;i++){sim.step(1);const q=sim.snapshot();assert.equal(q.agents.filter(a=>a.kind==='resident').length,ids.length);assert.equal(new Set(q.agents.map(a=>a.id)).size,q.agents.length);
  for(const a of q.agents){if(a.marketState==='conversing'){conversations++;assert.ok(q.agents.some(b=>b.id===a.dialogue?.partnerId));}if(a.purchaseStatus==='purchased')purchases.add(a.id);if(q.minute>650&&purchases.has(a.id)&&a.need==='lunch')later=true;}
  if(q.day===1&&q.minute===601)assert.equal(q.done,false);
 }
 assert.ok(conversations>0);assert.ok(purchases.size>0);assert.ok(later);assert.equal(sim.snapshot().day,2);
 const r=sim.runToEnd();assert.ok(r.dailyMarkets.purchases>purchases.size);assert.equal(r.done,true);assert.equal(sim.snapshot().minute,1440);
});
test('market tasks respect school escort and employment, and never create a purchase without access or staff',()=>{
 for(const mode of ['unreachable','unstaffed']){const s=village();s.scenario.days=1;if(mode==='unreachable')s.roads=[];else for(const b of s.buildings.filter(b=>b.type==='market'))b.staff=0;const r=Sim.createSimulation(s).runToEnd();if(mode==='unreachable')assert.equal(r.dailyMarkets.purchases,0);else{assert.equal(r.dailyMarkets.markets[0].vendors,r.dailyMarkets.markets[0].stalls);assert.ok(r.dailyMarkets.purchases>0);}}
 const s=village(),bindings=Schedule.bind(s,Network.buildNetwork(s)),daily=Schedule.residentDay(s,bindings,1);
 for(const p of s.people){const tasks=daily.plans[p.id];if(tasks.some(t=>t.mode==='market-shop')){assert.equal(p.ageGroup==='child',false);assert.equal(tasks.some(t=>t.mode==='escort'||t.mode==='external'),false);}}
});
module.exports={village};

test('daily market respects facility capacity and fractional stepping is reproducible',()=>{
 const s=village();s.scenario.days=1;s.buildings.find(b=>b.type==='market').capacity=1;
 const a=Sim.createSimulation(s),b=Sim.createSimulation(s);
 for(let i=0;i<350;i++){a.step(1);for(const f of Object.values(a.snapshot().facilities))assert.ok(f.occupancy<=f.capacity,f.name+' exceeded capacity');}
 const result=a.runToEnd();for(let i=0;i<500&&!b.snapshot().done;i++)b.step(i%2?.25:7.75);assert.deepEqual(b.result(),result);
 const tx=result.dailyMarkets.transactions;assert.equal(new Set(tx.map(t=>t.day+':'+t.householdId)).size,tx.length);
});

test('multi-day facility served equals cumulative market purchases and disconnected demand is reported',()=>{
 const r=Sim.createSimulation(village()).runToEnd(),id=r.dailyMarkets.markets[0].id;
 assert.equal(r.facilities[id].served,r.dailyMarkets.purchases);
 const s=village();s.scenario.days=1;s.roads=[];const bad=Sim.createSimulation(s).runToEnd();assert.ok(bad.dailyMarkets.failures.unreachable>0);
});
test('market deadline uses the same absolute clock on day two',()=>{
 const Daily=require('./daily-market'),s=village(),b=s.buildings.find(b=>b.type==='market');let failed;
 const a={id:'late',name:'late',active:{mode:'market-shop',target:b.id,deadline:1440+560},_marketPhase:'opening',state:'waiting',marketRole:'customer',x:0,y:0};
 const c=Daily.create({scene:s,agents:[a],bindings:{staff:{}},layouts:{},facilities:{},move(){},finish(a,reason){failed=reason;},path(){},log(){}});
 c.reset(2);a._marketPhase='opening';a.marketRole='customer';c.tick(a,570);assert.equal(failed,'time');
});

test('every physical stall has a unique vendor, shortfall comes from the village gate, and actors are reused across days',()=>{
 const s=village();for(const p of s.people){if(p.ageGroup==='adult')p.job='external';if(p.ageGroup==='senior')p.mobility=.6;}const sim=Sim.createSimulation(s);sim.step(120);const first=sim.snapshot(),r=sim.result(),m=r.dailyMarkets.markets[0];
 assert.equal(m.vendors,m.stalls);const vendors=first.agents.filter(a=>a.marketRole==='vendor');assert.equal(vendors.length,m.stalls);assert.equal(new Set(vendors.map(a=>a.stallId)).size,m.stalls);assert.ok(vendors.some(a=>a.kind==='vendor'));assert.equal(first.agents.filter(a=>a.kind==='resident').length,s.people.length);
 const externalIds=first.agents.filter(a=>a.kind==='vendor').map(a=>a.id);assert.ok(externalIds.length>0);sim.step(1440);assert.deepEqual(sim.snapshot().agents.filter(a=>a.kind==='vendor').map(a=>a.id),externalIds);const result=sim.runToEnd();assert.equal(result.externalVendors.count,externalIds.length);assert.ok(sim.snapshot().agents.filter(a=>a.kind==='vendor').every(a=>a.state==='departed'));assert.equal(result.dailyMarkets.markets[0].vendors,m.stalls);
});
