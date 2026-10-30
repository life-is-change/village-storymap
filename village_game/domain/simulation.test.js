const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Scene = require('./scene');
const Sim = fs.existsSync(__dirname+'/simulation.js') ? require('./simulation') : {};

test('complete starter cycle produces traceable successes and a finished three-day result', () => {
  assert.equal(typeof Sim.createSimulation,'function');
  const sim=Sim.createSimulation(Scene.createVillage()); sim.runToEnd(); const r=sim.result();
  assert.equal(sim.snapshot().done,true); assert.equal(r.days,3);
  assert.ok(r.resident.completed>0); assert.ok(r.visitor.completed>0);
  assert.ok(r.resident.total>=r.resident.completed); assert.ok(r.visitor.total>=r.visitor.completed);
  assert.ok(r.walkMinutes>0);
  assert.equal(r.resident.total-r.resident.completed+r.visitor.total-r.visitor.completed,Object.values(r.failures).reduce((a,b)=>a+b,0));
});
test('breaking all roads prevents services rather than teleporting agents', () => {
  assert.equal(typeof Sim.createSimulation,'function');
  const scene=Scene.createVillage();scene.roads=[];scene.scenario.days=1;
  const sim=Sim.createSimulation(scene);sim.runToEnd();const r=sim.result();
  // Housing is available at the origin; none of the 120 off-site daily needs can complete.
  assert.equal(r.resident.completed,30);assert.equal(r.resident.total,150);
  assert.equal(r.visitor.completed,0);assert.ok(r.failures.unreachable>0);
});
test('closed services cannot complete visitor needs', () => {
  assert.equal(typeof Sim.createSimulation,'function');
  const scene=Scene.createVillage();scene.scenario.days=1;
  scene.buildings.forEach(b=>{b.open=0;b.close=1;});
  const sim=Sim.createSimulation(scene);sim.runToEnd();const r=sim.result();
  assert.equal(r.visitor.completed,0);assert.ok(r.failures.closed>0);
});
test('service occupancy never exceeds capacity and non-lodging slots are released', () => {
  assert.equal(typeof Sim.createSimulation,'function');
  const scene=Scene.createVillage();scene.scenario.days=1;
  scene.buildings.forEach(b=>b.capacity=1);
  const sim=Sim.createSimulation(scene);let served=false;
  for(let i=0;i<840;i++){sim.step(1);for(const f of Object.values(sim.snapshot().facilities)){assert.ok(f.occupancy<=f.capacity);served ||= f.served>0;}}
  assert.ok(served);
  for(const f of Object.values(sim.snapshot().facilities))if(f.type!=='inn')assert.equal(f.occupancy,0);
});
test('different rendering time batches have the same deterministic outcome', () => {
  assert.equal(typeof Sim.createSimulation,'function');
  const a=Sim.createSimulation(Scene.createVillage()),b=Sim.createSimulation(Scene.createVillage());
  a.runToEnd();for(let i=0;i<10000&&!b.snapshot().done;i++)b.step(i%2?0.25:7.75);
  assert.deepEqual(a.result(),b.result());
});
test('waiting diners try an available alternative before failing capacity', () => {
  const scene=Scene.createVillage();scene.scenario.days=1;
  scene.buildings.forEach(b=>b.capacity=b.type==='food'?1:40);
  const other=Scene.createBuilding('food',375,145,'food-alternative');other.rotation=180;other.capacity=30;
  scene.buildings.push(other);
  const sim=Sim.createSimulation(scene);sim.runToEnd();
  assert.equal(sim.result().facilities['service-2'].failed,0);
  assert.ok(sim.result().facilities['food-alternative'].served>0);
});
test('converting a house preserves the shared resident population', () => {
  const scene=Scene.createVillage();scene.buildings[0].type='shop';
  const sim=Sim.createSimulation(scene);
  assert.equal(sim.snapshot().agents.filter(a=>a.kind==='resident').length,30);
});
