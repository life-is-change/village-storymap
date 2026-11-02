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
 for(const mode of ['unreachable','unstaffed']){const s=village();s.scenario.days=1;if(mode==='unreachable')s.roads=[];else for(const b of s.buildings.filter(b=>b.type==='market'))b.staff=0;const r=Sim.createSimulation(s).runToEnd();assert.equal(r.dailyMarkets.purchases,0);}
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
