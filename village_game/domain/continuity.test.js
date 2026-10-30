const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('./scene'),Schedule=require('./schedule'),Network=require('./network'),Sim=require('./simulation'),Editor=require('./editor'),Storage=require('./storage');
test('farm lunch follows network walking time and recomputes after a home move or road disconnection',()=>{
 const s=Scene.createIdealVillage(),net=Network.buildNetwork(s),b=Schedule.bind(s,net),farmers=s.people.filter(p=>p.job==='farm');
 assert.ok(b.farmLunch,'lunch policy must be bound to the actual plan');assert.ok(farmers.some(p=>b.farmLunch[p.id].mode==='home'));assert.ok(farmers.some(p=>b.farmLunch[p.id].mode==='packed'));
 for(const p of farmers){const route=Network.route(net,net.access[b.homes[p.householdId]],net.access[b.jobs[p.id]]),minutes=route.distance/(55*p.mobility);assert.ok(Math.abs(b.farmLunch[p.id].walkMinutes-minutes)<.01);assert.equal(b.farmLunch[p.id].mode,minutes<=10?'home':'packed');}
 const p=farmers.find(p=>b.farmLunch[p.id].mode==='packed'),home=s.buildings.find(h=>h.id===b.homes[p.householdId]),field=s.buildings.find(f=>f.id===b.jobs[p.id]);Object.assign(home,{x:field.x+42,y:field.y-30});assert.equal(Schedule.bind(s).farmLunch[p.id].mode,'home');
 const detached=Network.buildNetwork(s);detached.access[home.id]=null;assert.equal(Schedule.bind(s,detached).farmLunch[p.id].mode,'packed');
});
test('morning preparation starts at six and both farm lunch chains include a real rest and return to work',()=>{
 const s=Scene.createIdealVillage(),bindings=Schedule.bind(s),daily=Schedule.residentDay(s,bindings,1);assert.equal(Math.min(...Object.values(daily.plans).flat().map(t=>t.start)),360);
 assert.ok(bindings.farmLunch);const home=s.people.find(p=>p.job==='farm'&&bindings.farmLunch[p.id].mode==='home'),packed=s.people.find(p=>p.job==='farm'&&bindings.farmLunch[p.id].mode==='packed');
 for(const p of [home,packed]){const list=daily.plans[p.id],lunch=list.find(t=>t.slot==='lunch'),rest=list.find(t=>t.slot==='midday-rest');assert.equal(lunch.mode,p===home?'home-meal':'packed');assert.equal(rest.mode,'pause');assert.equal(rest.duration,30);assert.equal(rest.target,p===home?bindings.homes[p.householdId]:bindings.jobs[p.id]);}
 const sim=Sim.createSimulation(s),seen=Object.fromEntries([home,packed].map(p=>[p.id,new Set()])),last={};
 for(let m=360;m<1030;m++){const snap=sim.snapshot();for(const p of [home,packed]){const a=snap.agents.find(a=>a.id===p.id);assert.ok(a.lunchPlan?.reason);if(a.state==='eating'&&a.need==='lunch')seen[p.id].add('eat:'+a.node);if(a.state==='resting')seen[p.id].add('rest:'+a.node);if(a.state==='working'&&m>810)seen[p.id].add('afternoon');if(last[a.id])assert.ok(Math.hypot(a.x-last[a.id].x,a.y-last[a.id].y)<=a.speed+.01,'physical position must not jump');last[a.id]={x:a.x,y:a.y};}sim.step(1);}
 assert.ok(seen[home.id].has('eat:'+bindings.homes[home.householdId]));assert.ok(seen[packed.id].has('eat:'+bindings.jobs[packed.id]));for(const p of [home,packed]){assert.ok([...seen[p.id]].some(v=>v.startsWith('rest:')));assert.ok(seen[p.id].has('afternoon'));}
 assert.equal(sim.result().behaviorVersion,5);
});
test('farm packed meals cannot succeed without household preparation',()=>{
 const s=Scene.createIdealVillage(),b=Schedule.bind(s),p=s.people.find(p=>p.job==='farm'&&b.farmLunch?.[p.id]?.mode==='packed');assert.ok(p);const h=s.households.find(h=>h.id===p.householdId);for(const id of h.members){const q=s.people.find(p=>p.id===id);if(q.age>=18)q.mobility=.6;}const sim=Sim.createSimulation(s);sim.step(470);const a=sim.snapshot().agents.find(a=>a.id===p.id);assert.ok(a.history.some(t=>t.need==='lunch'&&t.reason==='household'));
});
test('version five places waterfront and community spaces coherently and keeps old reference layouts',()=>{
 const s=Scene.createIdealVillage();assert.equal(s.source.presetVersion,5);assert.equal(Scene.validate(s).ok,true);assert.equal(Editor.validateSpatial(s).ok,true);const net=Network.buildNetwork(s);assert.ok(s.buildings.every(b=>net.connected[b.id]));
 const view=s.buildings.find(b=>b.type==='attraction'),meal=s.buildings.find(b=>b.type==='meal'),night=s.buildings.find(b=>b.type==='night');assert.ok(view.x>=540);assert.ok(meal.y<200);assert.ok(night.y<350);assert.ok(view.height<=2);assert.ok(night.height<=3);
 assert.equal(typeof Scene.createLingnanVillageV4,'function');const old=Scene.createLingnanVillageV4();assert.equal(old.source.presetVersion,4);assert.equal(old.buildings.find(b=>b.type==='meal').y,405);assert.equal(Scene.referenceVillage(old).buildings.find(b=>b.type==='attraction').x,455);assert.deepEqual(Storage.parse(Storage.serialize(old,null)).scene,old);
});
test('a child already picked up completes the shared return journey even beyond the pickup time window',()=>{
 const s=Scene.createIdealVillage(),sim=Sim.createSimulation(s);sim.step(681);const before=sim.snapshot();for(const id of ['resident-4','resident-6'])assert.equal(before.agents.find(a=>a.id===id).state,'moving');sim.step(80);const after=sim.snapshot();
 for(const id of ['resident-4','resident-6']){const a=after.agents.find(a=>a.id===id),home=s.buildings.find(b=>b.id===a.home);assert.ok(a.history.some(t=>t.need==='escort'&&t.place===home.name&&!t.reason),'picked-up pair must get home rather than stop on the road');assert.ok(!a.history.some(t=>t.need==='escort'&&t.reason==='time'));}
});
