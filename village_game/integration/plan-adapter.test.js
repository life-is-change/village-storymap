const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('../domain/scene'),Network=require('../domain/network'),Simulation=require('../domain/simulation');
const A=require('./plan-adapter');
const {fixture,polygon}=require('./tests/fixtures');

test('decorative site paths remain components and are not offered as simulation roads',()=>{
 const f=fixture();f.document.objects.push({id:'garden-path',kind:'line',category:'path',geometry:{type:'LineString',coordinates:[[113,23],[113.001,23]]},properties:{sceneRole:'site-component'}});
 const catalog=A.catalog(f.document,f.context);
 assert.equal(catalog.find(o=>o.key==='object:garden-path').kind,'component');
});

test('explicit simulation area clips roads, derives multiple gates and preserves out-of-area saved assignments',()=>{
 const f=fixture();f.cfg.area=polygon(112.99995,22.9999,.00095,.0006);f.cfg.entry=null;f.cfg.entryMode='auto';
 const outside=structuredClone(f.cfg.assignments[0]);outside.key='baseline:outside';f.context.baselineFeatures.push({id:'outside',layerKey:'building',geometry:polygon(113.02,23.02),properties:{}});f.cfg.assignments.push(outside);
 const before=JSON.stringify(f.cfg),r=A.compile(f.document,f.context,f.cfg);
 assert.equal(r.ok,true,JSON.stringify(r.errors));assert.ok(r.scene.scenario.entries.length>=2);assert.ok(r.extent.widthM<200);
 assert.equal(r.scene.buildings.length,f.cfg.assignments.length-1);assert.match(r.warnings.join(' '),/范围外/);assert.equal(JSON.stringify(f.cfg),before);
});

test('a missing village alley becomes traversable only after its design path is explicitly included',()=>{
 const f=fixture();f.context.baselineFeatures[0].geometry=polygon(113,23.0005);
 let r=A.compile(f.document,f.context,f.cfg),home=r.scene.buildings.find(b=>b.type==='home');
 assert.equal(r.network.accessDiagnostics[home.id].reason,'too-far');
 f.document.objects.push({id:'alley',kind:'line',category:'path',properties:{widthM:1.5},geometry:{type:'LineString',coordinates:[[113.000075,23],[113.000075,23.00049]]}});
 r=A.compile(f.document,f.context,f.cfg);assert.equal(r.network.connected[home.id],false,'a saved unchecked path must not silently enter the trial');
 f.cfg.roads.push('object:alley');r=A.compile(f.document,f.context,f.cfg);
 assert.equal(r.ok,true,JSON.stringify(r.errors));assert.equal(r.network.accessDiagnostics[home.id].reason,'connected');
 assert.ok(Network.route(r.network,r.network.access.entry,r.network.access[home.id]));
});

test('a 1963m village is not rejected because of the 40m display margin on either side',()=>{
 const f=fixture(),G=require('../../3D_scenes_edit/domain/geometry-rules');
 f.context.baselineFeatures.find(i=>i.layerKey==='road').geometry.coordinates[1]=G.fromLocalMeters([1963,0],[112.9999,23]);
 const before=JSON.stringify(f.cfg),r=A.compile(f.document,f.context,f.cfg);
 assert.equal(r.ok,true,JSON.stringify(r.errors));assert.ok(r.scene.size[0]>2000);assert.ok(r.scene.size[0]<=2080);
 assert.ok(Math.abs(r.extent.widthM-1963)<1);assert.equal(Scene.validate(r.scene).ok,true);assert.equal(JSON.stringify(f.cfg),before);
});

test('an actual span beyond 2km remains blocked and reports measured dimensions',()=>{
 const f=fixture(),G=require('../../3D_scenes_edit/domain/geometry-rules');
 f.context.baselineFeatures.find(i=>i.layerKey==='road').geometry.coordinates[1]=G.fromLocalMeters([2010,0],[112.9999,23]);
 const r=A.compile(f.document,f.context,f.cfg);assert.equal(r.ok,false);assert.ok(r.errors.some(e=>e.includes('2010')&&e.includes('2公里')));
 assert.ok(Math.abs(r.extent.widthM-2010)<1);
 const demo=Scene.createVillage();demo.size[0]=2040;assert.equal(Scene.validate(demo).ok,false,'the standalone size limit is unchanged');
});

test('the exact 2000m boundary is accepted despite projection floating point roundoff',()=>{
 const f=fixture(),G=require('../../3D_scenes_edit/domain/geometry-rules');
 f.context.baselineFeatures.find(i=>i.layerKey==='road').geometry.coordinates[1]=G.fromLocalMeters([2000,0],[112.9999,23]);
 const r=A.compile(f.document,f.context,f.cfg);assert.equal(r.ok,true,JSON.stringify(r.errors));assert.ok(r.scene.size[0]<=2080);
});

test('startup housing checks household size against capacity rather than counting houses only',()=>{
 const f=fixture();f.cfg.settings.population=3;f.cfg.assignments[0].capacity=1;
 const setup=A.setup(f.cfg,A.catalog(f.document,f.context));assert.equal(setup.housingShortage,1);assert.equal(setup.rows.find(r=>r.id==='residents').status,'warning');
 const plan=A.compile(f.document,f.context,f.cfg);assert.equal(plan.ok,true);assert.ok(plan.warnings.some(w=>w.includes('家庭')&&w.includes('容量')));
});

test('residents lacking a large enough home can visit a park and finish a cycle without returning to a nonexistent building',()=>{
 const f=fixture();f.cfg.settings.population=24;f.cfg.settings.days=1;f.cfg.assignments[0].capacity=1;
 const plan=A.compile(f.document,f.context,f.cfg);assert.equal(plan.ok,true);const sim=Simulation.createSimulation(plan.scene);
 assert.doesNotThrow(()=>{while(!sim.snapshot().done)sim.step(30);});assert.equal(sim.snapshot().done,true);assert.ok(sim.result().housingShortage>0);
});

test('a component-free design boundary can be explicitly assigned as one whole park',()=>{
 const f=fixture();f.document.objects=[];f.document.selectionBoundary=polygon(113.00045,23.00012,.00035,.0003);
 const before=JSON.stringify(f.document),items=A.catalog(f.document,f.context),boundary=items.find(i=>i.key==='boundary:selection');
 assert.ok(boundary);assert.equal(boundary.kind,'area');assert.equal(boundary.origin,'selection-boundary');
 assert.equal(A.createConfig(f.document,f.context).assignments.length,0,'recognition must not silently define a park');
 f.cfg.assignments=[f.cfg.assignments[0],A.assignment(boundary.key,'park')];
 const report=A.compile(f.document,f.context,f.cfg);assert.equal(report.ok,true,JSON.stringify(report.errors));
 const park=report.scene.buildings.find(b=>b.type==='park');assert.equal(park.sourceKey,boundary.key);assert.equal(park.componentCount,0);assert.ok(park.areaM2>900);
 assert.equal(JSON.stringify(f.document),before,'registration must not create duplicate design objects or mutate the source document');
});

test('whole-boundary facilities follow boundary edits and report deletion without changing other saved uses',()=>{
 const f=fixture();f.document.selectionBoundary=polygon(113.00045,23.00012,.00035,.0003);
 f.cfg.assignments=[f.cfg.assignments[0],A.assignment('boundary:selection','park')];
 const saved=JSON.stringify(f.cfg),before=A.compile(f.document,f.context,f.cfg);assert.equal(before.ok,true);
 f.document.selectionBoundary=polygon(113.00045,23.00012,.0004,.0003);const after=A.compile(f.document,f.context,f.cfg);assert.equal(after.ok,true);assert.ok(after.scene.buildings[1].areaM2>before.scene.buildings[1].areaM2);
 assert.equal(JSON.stringify(f.cfg),saved);f.document.selectionBoundary=null;assert.equal(A.compile(f.document,f.context,f.cfg).ok,false);
});

test('map selection of a design boundary preserves actual building precedence and polygon holes',()=>{
 const f=fixture();f.document.selectionBoundary=polygon(112.99995,23.00005,.001,.0005);const items=A.catalog(f.document,f.context);
 assert.equal(A.pickSource(null,[113.00005,23.00015],items).key,'baseline:house');
 assert.equal(A.pickSource(null,[113.0003,23.0004],items).key,'boundary:selection');
 f.document.selectionBoundary.coordinates.push(polygon(113.0002,23.0002,.00005,.00008).coordinates[0]);
 assert.equal(A.pickSource(null,[113.00022,23.00023],A.catalog(f.document,f.context)),null);
});

test('startup checklist distinguishes missing setup, household shortage and an unchecked connection',()=>{
 const f=fixture(),items=A.catalog(f.document,f.context),cfg=A.createConfig(f.document,f.context);
 const empty=A.setup(cfg,items);assert.equal(empty.rows.find(r=>r.id==='entry').status,'missing');assert.equal(empty.rows.find(r=>r.id==='facilities').status,'missing');assert.equal(empty.rows.find(r=>r.id==='connections').status,'pending');
 cfg.entry=f.cfg.entry;cfg.assignments=[A.assignment('baseline:house','home')];cfg.settings.population=24;
 const short=A.setup(cfg,items);assert.equal(short.householdCount,8);assert.equal(short.housingShortage,7);assert.equal(short.rows.find(r=>r.id==='residents').status,'warning');
 const checked=A.compile(f.document,f.context,f.cfg),ready=A.setup(f.cfg,items,checked);assert.equal(ready.rows.find(r=>r.id==='connections').status,'ready');
});
test('legacy reference reconciliation preserves ambiguous or deleted choices instead of guessing or dropping them',()=>{
 const f=fixture(),items=A.catalog(f.document,f.context);items[0].aliases=['baseline:old'];items[1].aliases=['baseline:old'];
 f.cfg.assignments[0].key='baseline:old';const c=A.reconcileConfig(f.cfg,items);
 assert.equal(c.assignments[0].key,'baseline:old');assert.equal(c.assignments.length,f.cfg.assignments.length);
 assert.notEqual(c,f.cfg);assert.equal(A.compile(f.document,f.context,c).ok,false);
});

test('a building without decorative components remains solid and at its footprint centre',()=>{
 const f=fixture(),r=A.compile(f.document,f.context,f.cfg);
 assert.equal(r.ok,true,JSON.stringify(r.errors));
 const home=r.scene.buildings[0];assert.equal(home.passable,false);
 const center=home.footprint.slice(0,-1).reduce((p,q)=>p.map((v,i)=>v+q[i]/4),[0,0]);
 assert.deepEqual([home.x,home.y],center);
});

test('platform road network accepts an intact 596-segment village without applying the small demo cap',()=>{
 const f=fixture();f.context.baselineFeatures.find(x=>x.layerKey==='road').geometry.coordinates=Array.from({length:597},(_,i)=>[112.9999+.0011*i/596,23]);
 const r=A.compile(f.document,f.context,f.cfg);
 assert.equal(r.ok,true,JSON.stringify(r.errors));assert.equal(r.scene.roads[0].points.length,597);
 const route=Network.route(r.network,r.network.access.entry,r.network.access[r.scene.buildings[0].id]);assert.ok(route);
});
test('plan adapter preserves source identities, metre distances and full facility boundaries',()=>{
 const f=fixture(),r=A.compile(f.document,f.context,f.cfg);assert.equal(r.ok,true,JSON.stringify(r.errors));assert.equal(Scene.validate(r.scene).ok,true);
 const park=r.scene.buildings.find(b=>b.type==='park');assert.equal(park.sourceKey,'object:square');assert.equal(park.footprint.length,5);assert.ok(park.areaM2>900);assert.equal(park.componentCount,1);
 assert.equal(r.scene.buildings.length,2,'a bench is a component, not a separate destination');assert.ok(Math.abs(Network.distance(r.scene.roads[0].points[0],r.scene.roads[0].points[1])-112.6)<2);
 assert.deepEqual(r.projection.toDegrees(r.projection.toLocal([113.0005,23.0002])),[113.0005,23.0002]);assert.equal(f.document.objects.length,2);
});
test('changing capacity and roads changes frozen simulation input and actual reachability',()=>{
 const f=fixture(),before=A.compile(f.document,f.context,f.cfg);f.cfg.assignments[1].capacity=22;const after=A.compile(f.document,f.context,f.cfg);assert.notDeepEqual(before.scene,after.scene);assert.equal(before.scene.buildings[1].capacity,6);assert.equal(after.scene.buildings[1].capacity,22);assert.equal(Scene.capacity(after.scene.buildings[1]),22);
 f.cfg.roads=[];const missing=A.compile(f.document,f.context,f.cfg);assert.equal(missing.ok,false);assert.ok(missing.errors.some(e=>e.includes('道路')));
});
test('run is independent of subsequent plan changes and accepts the existing behaviour engine',()=>{
 const f=fixture(),r=A.compile(f.document,f.context,f.cfg);assert.equal(r.ok,true,JSON.stringify(r.errors));const sim=Simulation.createSimulation(r.scene);f.cfg.settings.population=9;sim.step(60);assert.equal(sim.snapshot().agents.filter(a=>a.kind==='resident').length,3);assert.equal(r.scene.source.projectId,'project-one');
});
test('invalid and stale configuration is rejected instead of silently dropping selected facilities',()=>{
 const f=fixture();f.cfg.assignments[1].key='object:deleted';assert.equal(A.compile(f.document,f.context,f.cfg).ok,false);
 const g=fixture();g.cfg.assignments[1].capacity=100000;assert.equal(A.validateConfig(g.cfg).ok,false);
 const h=fixture();h.cfg.entry=null;assert.equal(A.compile(h.document,h.context,h.cfg).ok,false);
});
test('small village employment adapts to configured services and amenities must be inside their facility',()=>{
 const f=fixture();f.cfg.assignments[1].type='food';f.cfg.assignments[1].staff=1;
 const r=A.compile(f.document,f.context,f.cfg);assert.equal(r.ok,true);assert.ok(r.scene.people.some(p=>p.job==='service'));
 f.document.objects.find(o=>o.id==='bench').geometry.coordinates=[114,24];assert.equal(A.compile(f.document,f.context,f.cfg).ok,false);
});
test('large areas preserve their perimeter and configured capacity without proxy-box clipping',()=>{
 const f=fixture();f.document.objects[0].geometry=polygon(113.0004,23.0001,.001,.001);const r=A.compile(f.document,f.context,f.cfg);assert.equal(r.ok,true,JSON.stringify(r.errors));const area=r.scene.buildings[1];assert.ok(area.areaM2>10000);assert.equal(Scene.capacity(area),area.capacity);
});
