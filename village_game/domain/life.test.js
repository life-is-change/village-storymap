const test=require('node:test'),assert=require('node:assert/strict');const Scene=require('./scene'),Network=require('./network');
const Sim=require('./simulation');
test('multi-gate visitors start at actual gates and keep each travel group together',()=>{
 const s=Scene.createLivingVillage();s.scenario.visitorMode='fixed';s.scenario.visitorsPerDay=30;s.scenario.entries=[s.scenario.entry,s.roads[0].points.at(-1)];
 const sim=Sim.createSimulation(s),visitors=sim.snapshot().agents.filter(a=>a.kind==='visitor');
 assert.ok(visitors.some(a=>a.node==='entry:1'));assert.ok(visitors.some(a=>a.node==='entry'));
 for(const a of visitors){const index=a.node==='entry'?0:1;assert.deepEqual([a.x,a.y],s.scenario.entries[index]);assert.ok(visitors.filter(b=>b.groupId===a.groupId).every(b=>b.node===a.node));}
 const result=sim.runToEnd();assert.equal(result.done,true);
});
test('overnight groups reserve lodging on their actual gate component rather than the isolated primary gate',()=>{
 const s=Scene.createPreviousVillage(),old=s.scenario.entry;s.size=[1000,1000];s.roads.push({id:'isolated-gate',kind:'path',width:3,points:[[800,800],[900,800]]});
 s.scenario.entry=[800,800];s.scenario.entries=[[800,800],old];s.scenario.visitorMode='fixed';s.scenario.visitorsPerDay=60;s.scenario.visitorMix=[0,0,100];
 const sim=Sim.createSimulation(s);sim.step(300);const guests=sim.snapshot().agents.filter(a=>a.kind==='visitor'&&a.home==='entry:1'&&a.state!=='planned');
 assert.ok(guests.length>0);assert.ok(guests.some(a=>a.bookedInn),'reachable staffed inns must accept secondary-gate parties');
});
test('complete life cycle preserves resident identities, families and group-wise need accounting',()=>{
 const s=Scene.createPreviousVillage(),sim=Sim.createSimulation(s),ids=sim.snapshot().agents.filter(a=>a.kind==='resident').map(a=>a.id);sim.step(1080);assert.equal(sim.snapshot().day,2);assert.deepEqual(sim.snapshot().agents.filter(a=>a.kind==='resident').map(a=>a.id),ids);
 const r=sim.runToEnd();assert.equal(r.ruleVersion,2);assert.equal(r.done,true);assert.ok(r.byProfile['child-male'].total>0);assert.ok(r.resident.completed>0);assert.ok(r.visitor.completed>0);assert.equal(r.resident.total+r.visitor.total-r.resident.completed-r.visitor.completed,Object.values(r.failures).reduce((a,b)=>a+b,0));
});
test('children attend school on weekdays and never farm; family and work meals dominate resident eating',()=>{
 const s=Scene.createPreviousVillage(),sim=Sim.createSimulation(s);sim.step(240);let snap=sim.snapshot();assert.ok(snap.agents.some(a=>a.ageGroup==='child'&&['studying','outside'].includes(a.state)));assert.ok(!snap.agents.some(a=>a.ageGroup==='child'&&a.need==='work'));
 const r=sim.runToEnd();assert.ok(r.homeMeals+r.packedMeals>r.residentPublicMeals);assert.equal(r.earlyVisitorMeals,0);assert.ok(r.schoolByDay[1]>0);assert.equal(r.schoolByDay[2]||0,0);assert.equal(r.schoolByDay[3]||0,0);
});
test('overnight people and occupied beds survive midnight without overbooking',()=>{
 const sim=Sim.createSimulation(Scene.createPreviousVillage());sim.step(1079);const guests=sim.snapshot().agents.filter(a=>a.profile==='overnight'&&a.bedId);assert.ok(guests.length>0);const ids=guests.map(a=>a.id);sim.step(1);const snap=sim.snapshot();assert.ok(ids.every(id=>snap.agents.some(a=>a.id===id&&a.bedId)));for(const f of Object.values(snap.facilities))assert.ok(f.occupancy<=f.capacity);
 sim.step(240);assert.ok(ids.every(id=>!sim.snapshot().agents.find(a=>a.id===id)?.bedId));
});
test('tourist parties use shared destinations and capacity counts real members',()=>{
 const sim=Sim.createSimulation(Scene.createPreviousVillage());for(let i=0;i<600;i++){sim.step(1);const snap=sim.snapshot(),parties=new Map();for(const a of snap.agents.filter(a=>a.kind==='visitor'&&a.state==='moving')){const key=a.groupId+'|'+a.taskId;if(!parties.has(key))parties.set(key,a.target);assert.equal(parties.get(key),a.target);}for(const f of Object.values(snap.facilities))assert.ok(f.occupancy<=f.capacity);}
});
test('new reachable restaurant automatically serves diners and changes queue outcomes',()=>{
 const s=Scene.createPreviousVillage();s.scenario.visitorsPerDay=60;s.scenario.days=1;for(const b of s.buildings)if(b.type==='food')b.capacity=2;const before=Sim.createSimulation(s).runToEnd();const b=Scene.createBuilding('food',290,405,'new-food');Object.assign(b,{modelVersion:2,staff:3,schoolStage:'primary',depth:16,rotation:180,capacity:24,open:10,close:21});s.buildings.push(b);const after=Sim.createSimulation(s).runToEnd();assert.ok(after.facilities[b.id].served>0);assert.ok(after.failures.capacity<before.failures.capacity);assert.ok(after.homeMeals+after.packedMeals>after.residentPublicMeals*10);
});
test('roads, staff and visitor volume affect operation rather than creating phantom services',()=>{
 const s=Scene.createPreviousVillage();s.scenario.days=1;const normal=Sim.createSimulation(s).runToEnd();const more=Scene.clone(s);more.scenario.visitorsPerDay=48;assert.ok(Sim.createSimulation(more).runToEnd().visitor.total>normal.visitor.total);
 const broken=Scene.clone(s);broken.roads=[];const r=Sim.createSimulation(broken).runToEnd();assert.ok(r.failures.unreachable>0);assert.ok(r.homeMeals>0);assert.equal(r.facilities['service-2'].served,0);assert.equal(r.resident.total+r.visitor.total-r.resident.completed-r.visitor.completed,Object.values(r.failures).reduce((a,b)=>a+b,0));
 const noStaff=Scene.clone(s);noStaff.buildings.filter(b=>b.type==='food').forEach(b=>b.staff=0);const n=Sim.createSimulation(noStaff).runToEnd();assert.equal(n.facilities['service-2'].served,0);assert.ok(n.failures.staff>0);
});
test('overnight groups reserve accommodation on arrival and never reserve beyond physical beds',()=>{
 const sim=Sim.createSimulation(Scene.createPreviousVillage());sim.step(300);const snap=sim.snapshot();assert.ok(snap.agents.some(a=>a.profile==='overnight'&&a.bookedInn&&!a.bedId));assert.ok(Object.values(snap.facilities).some(f=>f.reservedBeds>0));for(const f of Object.values(snap.facilities))assert.ok(f.occupancy+f.reservedBeds<=f.capacity);
});
test('failed check-in releases the whole party reservation instead of blocking later guests forever',()=>{
 const s=Scene.createPreviousVillage();s.scenario.days=1;s.buildings.filter(b=>b.type==='inn').forEach(b=>b.close=16);const r=Sim.createSimulation(s).runToEnd();assert.ok(r.failures.closed>0);for(const f of Object.values(r.facilities).filter(f=>f.type==='inn')){assert.equal(f.occupancy,0);assert.equal(f.reservedBeds,0);}
});
test('a child requiring accompaniment cannot silently walk alone when the household has no eligible guardian',()=>{
 const s=Scene.createPreviousVillage(),h=s.households[0],child=s.people.find(p=>h.members.includes(p.id)&&p.ageGroup==='child');for(const p of s.people.filter(p=>h.members.includes(p.id)&&p.age>=18))Object.assign(p,{age:85,ageGroup:'senior',profile:'senior-'+p.sex,job:'retired',mobility:.55,lightWork:false});const sim=Sim.createSimulation(s);sim.step(220);const a=sim.snapshot().agents.find(a=>a.id===child.id);assert.ok(a.history.some(e=>e.need==='school'&&e.reason==='household'));assert.notEqual(a.state,'studying');
});
test('housing conversion never removes people or their basic daily demand',()=>{
 const s=Scene.createPreviousVillage();s.buildings.filter(b=>b.type==='home').forEach(b=>b.type='inn');const sim=Sim.createSimulation(s);assert.equal(sim.snapshot().agents.filter(a=>a.kind==='resident').length,72);assert.ok(sim.runToEnd().housingShortage>0);
});
test('new fixed-step simulation is reproducible across frame batching and overnight boundaries',()=>{
 const s=Scene.createPreviousVillage();const a=Sim.createSimulation(s),b=Sim.createSimulation(s);const expected=a.runToEnd();for(let i=0;i<20000&&!b.snapshot().done;i++)b.step(i%2?.3:9.7);assert.deepEqual(b.result(),expected);
});

test('young children wait for a guardian and return home together after weekday school',()=>{const s=Scene.createPreviousVillage(),sim=Sim.createSimulation(s);let paired=false;for(let i=0;i<720;i++){sim.step(1);const snap=sim.snapshot();for(const c of snap.agents.filter(a=>a.needsEscort&&a.need==='escort'&&a.state==='moving')){const g=snap.agents.find(a=>a.taskId?.includes('pickup-'+c.id));assert.ok(g);assert.equal(g.target,c.home);assert.equal(c.target,c.home);assert.ok(Math.hypot(g.x-c.x,g.y-c.y)<.01);paired=true;}}assert.ok(paired);});
test('a child without an eligible guardian does not walk to later school lunch or afternoon sessions',()=>{const s=Scene.createPreviousVillage(),c=s.people.find(p=>p.needsEscort),h=s.households.find(h=>h.id===c.householdId);for(const p of s.people.filter(p=>h.members.includes(p.id)&&p.age>=18))p.mobility=.55;const sim=Sim.createSimulation(s);for(let i=0;i<700;i++){sim.step(1);const a=sim.snapshot().agents.find(a=>a.id===c.id);assert.ok(!(a.state==='moving'&&['school','lunch'].includes(a.need)));}assert.ok(sim.result().failures.household>0);});

test('rest state is home only when physically at the assigned residence',()=>{const sim=Sim.createSimulation(Scene.createPreviousVillage());sim.step(390);for(const a of sim.snapshot().agents.filter(a=>a.kind==='resident'&&a.state==='home'))assert.equal(a.node,a.home);});

test('school departure waits at home for a real available guardian for village and external classes',()=>{for(const outside of [false,true]){const s=Scene.createPreviousVillage();if(outside)s.buildings.find(b=>b.type==='school').staff=0;const sim=Sim.createSimulation(s);let trips=0;for(let i=0;i<240;i++){sim.step(1);const snap=sim.snapshot();for(const c of snap.agents.filter(a=>a.needsEscort&&a.need==='school'&&a.state==='moving')){const g=snap.agents.find(a=>a.need==='escort'&&a.state==='moving'&&a.taskId?.includes('escort-'+c.id));assert.ok(g,'no accompanying guardian: '+c.id+' at '+snap.minute);assert.ok(Math.hypot(g.x-c.x,g.y-c.y)<.01);trips++;}}assert.ok(trips>0);const c=sim.snapshot().agents.find(a=>a.id==='resident-27');assert.equal(c.state,outside?'outside':'studying');}});
