const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Scene = fs.existsSync(__dirname + '/scene.js') ? require('./scene') : {};

test('starter village has residents, services and a valid complete scene', () => {
  assert.equal(typeof Scene.createVillage, 'function');
  const scene = Scene.createVillage();
  assert.equal(Scene.validate(scene).ok, true);
  assert.equal(scene.buildings.filter(b => b.type === 'home').length, 12);
  assert.equal(scene.buildings.filter(b => b.type === 'home').reduce((n,b) => n + b.residents, 0), 30);
  assert.ok(scene.buildings.some(b => b.type === 'inn'));
  assert.ok(scene.roads.length >= 4);
});
test('invalid coordinates, sizes, function types and duplicate IDs cannot be imported', () => {
  assert.equal(typeof Scene.validate, 'function');
  for (const mutate of [s => s.buildings[0].x = NaN, s => s.buildings[0].width = -2,
    s => s.buildings[0].type = 'unknown', s => s.buildings[1].id = s.buildings[0].id,
    s => s.roads[0].points[0] = [1000, 20], s => s.scenario.days = 10000]) {
    const scene = Scene.createVillage(); mutate(scene);
    assert.equal(Scene.validate(scene).ok, false);
  }
});
test('inherited function names and reserved object IDs are rejected',()=>{
  for(const mutate of [s=>s.buildings[0].type='toString',s=>s.buildings[0].id='__proto__']){
    const scene=Scene.createVillage();mutate(scene);assert.equal(Scene.validate(scene).ok,false);
  }
});
test('custom entrances must stay beside their own building',()=>{
  const scene=Scene.createVillage(),b=scene.buildings[0];b.entrance=[400,110];assert.equal(Scene.validate(scene).ok,false);
  b.entrance=[b.x+b.width/2+1,b.y];assert.equal(Scene.validate(scene).ok,true);
});
test('the internal village entry identifier cannot be assigned to a building',()=>{
  const scene=Scene.createVillage();scene.buildings[12].id='entry';assert.equal(Scene.validate(scene).ok,false);
});
test('road complexity has a combined segment budget',()=>{
  const scene=Scene.createVillage();scene.roads=Array.from({length:4},(_,i)=>({id:'r-'+i,kind:'path',width:3,points:Array.from({length:80},(_,j)=>[10+j,20+i])}));
  assert.equal(Scene.validate(scene).ok,false);
});
