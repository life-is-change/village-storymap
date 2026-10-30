const test=require('node:test'),assert=require('node:assert/strict');
const O=require('./observation'),Scene=require('../domain/scene'),Network=require('../domain/network'),Sim=require('../domain/simulation');
test('encounter presentation expires and never marks a walker as talking',()=>{const a={state:'serving',interaction:{until:780}};assert.equal(O.isChatting(a,{day:1,minute:779}),true);assert.equal(O.isChatting(a,{day:1,minute:780}),false);assert.equal(O.isChatting({...a,state:'moving'},{day:1,minute:779}),false);});
test('interpolated walkers follow corners rather than crossing the inside of a road bend',()=>{
 const old={day:1,minute:600,agents:[{id:'a',state:'moving',target:'b',x:0,y:0,pathIndex:1,route:[[0,0],[10,0],[10,10]]}]};
 const next={day:1,minute:601,agents:[{id:'a',state:'moving',target:'b',x:10,y:10,pathIndex:3,route:[[0,0],[10,0],[10,10]]}]};
 const a=O.interpolate(old,next,.5).agents[0];assert.equal(a.x,10);assert.equal(a.y,0);assert.equal(next.agents[0].y,10);
 const q=O.interpolate(old,next,.75).agents[0];assert.equal(q.x,10);assert.equal(q.y,5);
});
test('cross-day and skipped-time observations never interpolate unrelated positions',()=>{
 const a={day:1,minute:700,agents:[{id:'a',x:0,y:0,state:'moving'}]},b={day:2,minute:420,agents:[{id:'a',x:90,y:30,state:'moving'}]};
 assert.equal(O.interpolate(a,b,.2).agents[0].x,90);b.day=1;b.minute=710;assert.equal(O.interpolate(a,b,.2).agents[0].x,90);
});
test('queue presentation shows each real waiter separately without mutating simulation positions',()=>{
 const scene=Scene.createVillage(),b=scene.buildings.find(b=>b.id==='service-2'),e=Scene.entrance(b);
 const snap={agents:[0,1,2].map(i=>({id:'a'+i,state:'waiting',target:b.id,x:e[0],y:e[1]}))};
 const placed=O.layout(scene,snap);assert.equal(new Set(placed.agents.map(a=>a.x+','+a.y)).size,3);assert.equal(snap.agents[0].x,e[0]);
});
test('facility observation distinguishes no facility, disconnected, closed and actual capacity pressure',()=>{
 const scene=Scene.createVillage(),b=scene.buildings.find(b=>b.id==='service-2'),net=Network.buildNetwork(scene);
 assert.equal(O.facility(scene,null,net,'gone').reason,'missing');
 assert.equal(O.facility(scene,null,{connected:{}},b.id).reason,'unreachable');
 const snap={minute:600,agents:[{id:'a',target:b.id,state:'waiting'},{id:'b',target:b.id,state:'moving'}],facilities:{[b.id]:{occupancy:3,capacity:3,queued:8,served:5}}};
 let f=O.facility(scene,snap,net,b.id);assert.equal(f.waiting,1);assert.equal(f.incoming,1);assert.equal(f.reason,'capacity');assert.equal(f.queued,8);
 snap.minute=1300;assert.equal(O.facility(scene,snap,net,b.id).reason,'closed');snap.done=true;assert.equal(O.facility(scene,snap,net,b.id).reason,'complete');b.type='home';assert.equal(O.facility(scene,snap,net,b.id).reason,'repurposed');
});
test('presentation snapshots carry copied route geometry and fractional progress while results remain reproducible',()=>{
 const sim=Sim.createSimulation(Scene.createVillage());sim.step(1.5);let s=sim.snapshot();assert.equal(s.progress,.5);
 const moving=s.agents.find(a=>a.state==='moving');assert.ok(moving.route.length>1);moving.route[0][0]=-999;
 assert.notEqual(sim.snapshot().agents.find(a=>a.id===moving.id).route[0][0],-999);
 assert.deepEqual(sim.runToEnd(),Sim.createSimulation(Scene.createVillage()).runToEnd());
});
test('following a diner retains the other diners and queue as visible context',()=>{
 const ui={selected:{kind:'agent',id:'chosen'},focusId:'service-2'};
 assert.equal(O.relevant({id:'chosen',target:'service-4'},ui),true);
 assert.equal(O.relevant({id:'waiter',target:'service-2'},ui),true);
 assert.equal(O.relevant({id:'other',target:'service-4'},ui),false);
});
test('guided seeking preserves all prior statistics and stops in day one when there is no diner',()=>{
 const scene=Scene.createVillage(),sim=Sim.createSimulation(scene),seek=O.seekMeal(sim,'service-2',scene.scenario.endMinute);
 assert.equal(seek.found,true);assert.equal(seek.snapshot.day,1);assert.ok(seek.snapshot.agents.some(a=>a.need==='food'&&a.target==='service-2'&&a.state==='moving'));
 assert.deepEqual(sim.runToEnd(),Sim.createSimulation(scene).runToEnd());
 scene.buildings.find(b=>b.id==='service-2').close=8;const closed=O.seekMeal(Sim.createSimulation(scene),'service-2',scene.scenario.endMinute);
 assert.equal(closed.found,false);assert.equal(closed.snapshot.day,1);assert.equal(closed.snapshot.minute,scene.scenario.endMinute-1);
});

test('whole-village filters combine activity and profile while selected people remain inspectable',()=>{const ui={flowFilter:'work',profileFilter:'boy'};assert.equal(O.relevant({id:'a',profile:'boy',activityGroup:'work'},ui),true);assert.equal(O.relevant({id:'b',profile:'girl',activityGroup:'work'},ui),false);assert.equal(O.relevant({id:'c',profile:'boy',activityGroup:'public'},ui),false);ui.selected={kind:'agent',id:'c'};assert.equal(O.relevant({id:'c',profile:'boy',activityGroup:'public'},ui),true);});
test('modern overview labels are sparse and private family activities are separately drawn',()=>{const s=Scene.createIdealVillage(),b=s.buildings.find(b=>b.overviewLabel===false&&b.type!=='home');assert.equal(O.labelVisible(b,{labels:true}),false);assert.equal(O.labelVisible(b,{labels:true,selected:{kind:'building',id:b.id}}),true);const home=s.buildings[0],snap={agents:[0,1,2].map(i=>({id:'p'+i,target:home.id,state:'eating',x:home.x,y:home.y}))};assert.equal(new Set(O.layout(s,snap).agents.map(a=>a.x+','+a.y)).size,3);assert.equal(snap.agents[0].x,home.x);assert.equal(O.visible({state:'outside'}),false);});

test('selected building name remains readable when general names are disabled',()=>{const b=Scene.createIdealVillage().buildings[0];assert.equal(O.labelVisible(b,{labels:false,selected:{kind:'building',id:b.id}}),true);assert.equal(O.labelVisible(b,{labels:false}),false);});

test('home and lodging remain traceable and changing activity does not move the display anchor',()=>{
 const s=Scene.createIdealVillage(),b=s.buildings[0],e=Scene.entrance(b),person={id:'resident-1',home:b.id,node:b.id,target:b.id,x:e[0],y:e[1]};assert.equal(O.visible({...person,state:'home'}),true);assert.equal(O.visible({...person,state:'staying'}),true);assert.equal(O.visible({...person,state:'outside'}),false);
 const snapshots=['home','moving','eating','idle'].map(state=>O.layout(s,{agents:[{...person,state}]}).agents[0]);for(const a of snapshots){assert.equal(a.x,snapshots[0].x);assert.equal(a.y,snapshots[0].y);}
 assert.equal(O.location(s,{...person,state:'home'}).indoor,true);assert.equal(O.location(s,{...person,state:'moving'}).indoor,false);assert.match(O.location(s,{...person,state:'outside'}).name,/村外/);
});
test('recorded interrupted escort snapshots never display untravelled route while normal arrivals still interpolate corners',()=>{
 const sim=Sim.createSimulation(Scene.createIdealVillage());sim.step(681);const before=sim.snapshot(),interrupted=before.agents.filter(a=>['resident-4','resident-6'].includes(a.id)&&a.state==='moving');assert.equal(interrupted.length,2);
 // Historical cancellation event captured by final review; picked-up pairs now complete their trip.
 const after={...before,minute:before.minute+1,agents:before.agents.map(a=>interrupted.some(p=>p.id===a.id)?{...a,state:'idle',target:null,route:null}:a)},shown=O.interpolate(before,after,.5);
 for(const old of interrupted){const now=after.agents.find(a=>a.id===old.id),display=shown.agents.find(a=>a.id===old.id);assert.equal(now.x,old.x);assert.equal(now.y,old.y);assert.equal(display.x,now.x);assert.equal(display.y,now.y);}
 const old={day:1,minute:600,agents:[{id:'walker',state:'moving',target:'house',x:0,y:0,pathIndex:1,route:[[0,0],[10,0],[10,10]]}]},next={day:1,minute:601,agents:[{id:'walker',state:'home',node:'house',x:10,y:10}]};const a=O.interpolate(old,next,.75).agents[0];assert.equal(a.x,10);assert.equal(a.y,5);
});
