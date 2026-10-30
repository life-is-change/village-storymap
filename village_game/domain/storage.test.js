const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const Scene=require('./scene');const Storage=fs.existsSync(__dirname+'/storage.js')?require('./storage'):{};
test('export/import preserve the design and recent completed result',()=>{
  assert.equal(typeof Storage.serialize,'function');const scene=Scene.createVillage();
  const result=require('./simulation').createSimulation(scene).runToEnd();
  const parsed=Storage.parse(Storage.serialize(scene,result));
  assert.deepEqual(parsed.scene,scene);assert.equal(parsed.result.done,true);
});
test('malformed and unknown-version imports fail without returning a replacement',()=>{
  assert.equal(typeof Storage.parse,'function');
  assert.throws(()=>Storage.parse('{broken'));
  const scene=Scene.createVillage();scene.buildings[0].type='script';
  assert.throws(()=>Storage.parse(JSON.stringify({format:'village-game',version:1,scene})));
  assert.throws(()=>Storage.parse(JSON.stringify({format:'village-game',version:99,scene:Scene.createVillage()})));
});
test('storage failures are surfaced and corrupted saved data is recoverable',()=>{
  assert.equal(typeof Storage.save,'function');
  const bad={setItem(){throw new Error('disabled');},getItem(){return 'bad';}};
  assert.equal(Storage.save(bad,Scene.createVillage(),null).ok,false);
  assert.equal(Storage.load(bad).ok,false);
  const bag=new Map();const memory={setItem:(k,v)=>bag.set(k,v),getItem:k=>bag.get(k)};
  assert.equal(Storage.save(memory,Scene.createVillage(),null).ok,true);
  assert.equal(Storage.load(memory).ok,true);
});
test('invalid historical metrics are discarded while valid scene data remains importable',()=>{
  const parsed=Storage.parse(Storage.serialize(Scene.createVillage(),{done:true,revision:0,resident:'broken'}));
  assert.equal(parsed.scene.name,'溪田村');assert.equal(parsed.result,null);
});
test('all displayed historical statistics are numeric and bounded',()=>{
  const scene=Scene.createVillage(),result=require('./simulation').createSimulation(scene).runToEnd();
  for(const mutate of [r=>r.facilities['service-2'].peak='<img src=x onerror=alert(1)>',r=>r.facilities['service-2'].queued=-1,r=>r.housingShortage='markup']){
    const bad=Scene.clone(result);mutate(bad);
    const imported=Storage.parse(Storage.serialize(scene,bad));
    assert.deepEqual(imported.scene,scene);assert.equal(imported.result,null);
  }
});
test('imports enforce the same building footprint and road constraints as editing',()=>{
  for(const mutate of [s=>s.buildings[0].x=1,s=>s.buildings[0].x=452,s=>s.buildings[0].x=100,s=>s.roads.push({id:'through-house',kind:'path',width:3,points:[[30,82],[125,82]]})]){
    const scene=Scene.createVillage();mutate(scene);assert.throws(()=>Storage.parse(Storage.serialize(scene,null)));
  }
});
test('this experience rejects unsupported scenario dimensions before replacing a plan',()=>{
  const scene=Scene.createVillage();scene.size=[1500,1500];scene.scenario.entry=[1000,1000];
  assert.throws(()=>Storage.parse(Storage.serialize(scene,null)),/情境|体验版/);
  const population=Scene.createVillage();population.scenario.population=50;
  assert.throws(()=>Storage.parse(Storage.serialize(population,null)),/情境|体验版/);
});
test('behavior version is validated independently of scene schema while old results remain readable',()=>{const s=Scene.createIdealVillage(),r=require('./simulation').createSimulation(s).runToEnd();assert.equal(Storage.parse(Storage.serialize(s,r)).result.behaviorVersion,5);const old=Scene.clone(r);delete old.behaviorVersion;assert.ok(Storage.parse(Storage.serialize(s,old)).result);const bad=Scene.clone(r);bad.behaviorVersion='<script>';assert.equal(Storage.parse(Storage.serialize(s,bad)).result,null);});
