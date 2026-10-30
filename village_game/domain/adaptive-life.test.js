const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('./scene'),Life=require('./life'),Storage=require('./storage');
test('adaptive run records dynamic choices, state changes and market days reproducibly',()=>{
 const s=Scene.createAdaptiveVillage(),sim=Life.createSimulation(s);sim.step(400);const snap=sim.snapshot();
 assert.ok(snap.metrics.decisions>0);const a=snap.agents.find(a=>a.kind==='visitor'&&a.decision);assert.ok(a);assert.ok(a.needsState);assert.ok(a.decision.options.length>1);assert.ok(Math.abs(a.decision.options.reduce((n,x)=>n+x.probability,0)-1)<1e-6);
 const r=sim.runToEnd();assert.equal(r.marketDays.length,3);assert.equal(r.arrivals,r.marketDays.reduce((n,d)=>n+d.actual,0));assert.ok(r.satisfaction.count>0);assert.deepEqual(r,Life.createSimulation(s).runToEnd());assert.equal(Storage.parse(Storage.serialize(s,r)).result.behaviorVersion,5);
});
test('tourist groups share dynamic decisions and preserve continuous travel',()=>{
 const s=Scene.createAdaptiveVillage(),sim=Life.createSimulation(s);let previous=sim.snapshot();for(let i=0;i<850;i++){sim.step(1);const next=sim.snapshot();for(const a of next.agents){const old=previous.agents.find(x=>x.id===a.id);if(old&&a.kind==='visitor'&&!['planned','departed'].includes(old.state))assert.ok(Math.hypot(a.x-old.x,a.y-old.y)<=a.speed+1,'movement bounded '+a.id);}
 const active=next.agents.filter(a=>a.kind==='visitor'&&a.decision);const groups=Map.groupBy(active,a=>a.groupId);for(const group of groups.values())if(group.length>1){assert.equal(new Set(group.map(a=>a.decision.id)).size,1);assert.equal(new Set(group.map(a=>a.decision.destination)).size,1);}previous=next;}
});
test('adaptive zero visitors and seven-day run balance statistics and saved feedback',()=>{
 for(const days of [3,7]){const s=Scene.createAdaptiveVillage();s.scenario.days=days;s.scenario.visitorsPerDay=0;const r=Life.createSimulation(s).runToEnd();assert.equal(r.arrivals,0);assert.equal(r.visitor.total,0);assert.equal(r.marketDays.length,days);assert.ok(Storage.parse(Storage.serialize(s,r)).result);}
});
test('encounters happen in public spaces with cooldown and bounded indicators',()=>{
 const s=Scene.createAdaptiveVillage();s.scenario.visitorsPerDay=80;const sim=Life.createSimulation(s),seen=new Map();let visible=false;for(let i=0;i<2000;i++){sim.step(1);const snap=sim.snapshot();for(const a of snap.agents)if(a.interaction&&a.interaction.until>snap.minute+(snap.day-1)*1440){visible=true;const key=a.id+'-'+a.interaction.id;if(!seen.has(key)){const last=[...seen.values()].filter(x=>x.id===a.id).at(-1);if(last)assert.ok(a.interaction.start-last.start>=45);seen.set(key,{id:a.id,start:a.interaction.start});}}}
 assert.ok(visible);assert.ok(sim.runToEnd().encounters>0);
});
test('facility upgrades alter choices and tourism while fixed control preserves arrivals',()=>{
 const s=Scene.createAdaptiveVillage(),base=Life.createSimulation(s).runToEnd(),high=Scene.clone(s);for(const b of high.buildings)if(['attraction','ancestral','workshop','inn','food','park','play'].includes(b.type)){b.attraction=100;b.level=3;}
 const better=Life.createSimulation(high).runToEnd();assert.ok(better.marketDays[0].appeal.overall>base.marketDays[0].appeal.overall);assert.ok(better.arrivals>base.arrivals);
 s.scenario.visitorMode='fixed';s.scenario.visitorsPerDay=24;assert.equal(Life.createSimulation(s).runToEnd().arrivals,72);
});
test('malformed new feedback is discarded and snapshots do not mutate under later steps',()=>{
 const s=Scene.createAdaptiveVillage(),sim=Life.createSimulation(s);sim.step(400);const snap=sim.snapshot(),before=JSON.stringify(snap);sim.step(100);assert.equal(JSON.stringify(snap),before);
 const r=sim.runToEnd();for(const patch of [{marketDays:[{day:1,actual:1000}]},{satisfaction:{count:1,total:NaN,average:50}},{encounters:-1}])assert.equal(Storage.parse(Storage.serialize(s,{...r,...patch})).result,null);
});
test('an upgraded attractive inn participates in group lodging choice beyond the closest inn',()=>{const s=Scene.createAdaptiveVillage();Object.assign(s.scenario,{visitorMode:'fixed',visitorsPerDay:10,visitorMix:[0,0,100]});const inn=s.buildings.find(b=>b.id==='inn-north');Object.assign(inn,{attraction:100,level:3,upgrade:'comfort'});const sim=Life.createSimulation(s);sim.step(300);assert.ok(sim.snapshot().agents.filter(a=>a.kind==='visitor'&&a.bookedInn===inn.id).length>=2);});
test('flexible activities never occupy a required pickup or cooking start',()=>{const sim=Life.createSimulation(Scene.createAdaptiveVillage());for(let i=0;i<1080;i++){sim.step(1);const snap=sim.snapshot();for(const a of snap.agents)if(a.kind==='resident'&&a.taskId?.startsWith('dynamic'))assert.ok(!a.agenda.some(t=>['pickup','cook','escort'].includes(t.mode)&&t.start<=snap.minute),'leisure crosses commitment '+a.id+' at '+snap.minute);}});
test('new encounters cannot start in a closed public facility',()=>{const s=Scene.createAdaptiveVillage();Object.assign(s.scenario,{seed:1,visitorMode:'fixed',visitorsPerDay:80});for(const b of s.buildings)if(b.type!=='home'){b.open=0;b.close=1;}Object.assign(s.buildings.find(b=>b.id==='service-5'),{open:6,close:10,attraction:100,capacity:40});const sim=Life.createSimulation(s);sim.step(235);for(let i=0;i<65;i++){sim.step(1);const snap=sim.snapshot();for(const a of snap.agents)if(a.interaction?.start===snap.minute-1){const b=s.buildings.find(b=>b.id===a.node);assert.ok(a.interaction.start>=b.open*60&&a.interaction.start<b.close*60);}}});
