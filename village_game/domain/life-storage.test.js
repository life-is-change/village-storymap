const test=require('node:test'),assert=require('node:assert/strict');const Scene=require('./scene'),Editor=require('./editor'),Storage=require('./storage'),Sim=require('./simulation');
test('visitor scenario edits are validated, reversible and cannot remove residents',()=>{
 const e=Editor.createEditor(Scene.createIdealVillage());e.apply({type:'set-scenario',patch:{visitorsPerDay:48,visitorMix:[20,50,30],days:7}});assert.equal(e.scene.scenario.visitorsPerDay,48);assert.equal(e.scene.people.length,72);e.undo();assert.equal(e.scene.scenario.visitorsPerDay,24);e.redo();assert.equal(e.scene.scenario.days,7);const old=e.scene;assert.throws(()=>e.apply({type:'set-scenario',patch:{visitorMix:[80,80,0]}}));assert.equal(e.scene,old);assert.throws(()=>e.apply({type:'set-scenario',patch:{population:1}}));
});
test('version two plans preserve portraits, scenario and valid results with typed capacity',()=>{
 const s=Scene.createIdealVillage();s.scenario.visitorsPerDay=40;const r=Sim.createSimulation(s).runToEnd(),text=Storage.serialize(s,r);assert.equal(JSON.parse(text).version,2);const parsed=Storage.parse(text);assert.deepEqual(parsed.scene,s);assert.deepEqual(parsed.result,r);
 const b=Scene.createBuilding('school',125,405,'new-school',2);assert.equal(b.modelVersion,2);assert.equal(b.staff,1);
});
test('new local storage never overwrites the legacy key and exposes the old backup',()=>{
 const bag=new Map([[Storage.LEGACY_KEY,Storage.serialize(Scene.createVillage(),null)]]),store={getItem:k=>bag.get(k)||null,setItem:(k,v)=>bag.set(k,v)},old=bag.get(Storage.LEGACY_KEY);const loaded=Storage.load(store);assert.equal(loaded.scene,null);assert.equal(loaded.legacyAvailable,true);Storage.save(store,Scene.createIdealVillage(),null);assert.equal(bag.get(Storage.LEGACY_KEY),old);assert.equal(Storage.load(store).scene.schemaVersion,2);assert.equal(Storage.legacyText(store),old);
});
test('invalid new portraits or stats cannot enter the workbench',()=>{
 const s=Scene.createIdealVillage(),r=Sim.createSimulation(s).runToEnd();const invalid=Scene.clone(s);invalid.people[0].profile='script';assert.throws(()=>Storage.parse(JSON.stringify({format:'village-game',version:2,scene:invalid})));
 for(const mutate of [x=>x.byProfile['adult-male'].completed='html',x=>x.homeMeals=-1,x=>x.facilities['service-2'].effectiveCapacity='html',x=>x.failures.staff=-1]){const bad=Scene.clone(r);mutate(bad);assert.equal(Storage.parse(Storage.serialize(s,bad)).result,null);}
});

test('legacy backup remains discoverable after the new automatic save and reload',()=>{const values=new Map([[Storage.LEGACY_KEY,Storage.serialize(Scene.createVillage(),null)]]),store={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};assert.equal(Storage.load(store).legacyAvailable,true);Storage.save(store,Scene.createIdealVillage(),null);assert.equal(Storage.load(store).legacyAvailable,true);assert.equal(Storage.legacyText(store),values.get(Storage.LEGACY_KEY));});
