const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('./scene'),Network=require('./network'),Editor=require('./editor');
test('ideal village is a complete connected scene with stable families and six resident portraits',()=>{
 assert.equal(typeof Scene.createIdealVillage,'function');const s=Scene.createIdealVillage();assert.equal(s.schemaVersion,2);assert.equal(s.households.length,24);assert.equal(s.people.length,72);assert.equal(new Set(s.people.map(p=>p.profile)).size,6);
 assert.equal(Scene.validate(s).ok,true);assert.equal(Editor.validateSpatial(s).ok,true);const net=Network.buildNetwork(s);assert.ok(s.buildings.every(b=>net.connected[b.id]));
 assert.ok(['kindergarten','care','clinic','culture','play','night','meal'].every(type=>s.buildings.some(b=>b.type===type)));
 for(const h of s.households){assert.ok(h.members.length>=2&&h.members.length<=5);assert.ok(h.members.every(id=>s.people.some(p=>p.id===id&&p.householdId===h.id)));}
});
test('new people and scenario data reject broken identities, impossible child jobs and invalid mix',()=>{
 for(const mutate of [s=>s.people[1].id=s.people[0].id,s=>s.people.find(p=>p.age<18).job='farm',s=>s.people[0].householdId='missing',s=>s.households[0].members.pop(),s=>s.scenario.visitorMix=[100,100,0],s=>s.buildings.find(b=>b.type==='kindergarten').staff=-1]){const s=Scene.createIdealVillage();mutate(s);assert.equal(Scene.validate(s).ok,false);}
});
test('explicit legacy upgrade preserves designed geometry and people count but changes rule version',()=>{
 const old=Scene.createVillage();old.buildings[14].capacity=12;const s=Scene.upgradeLegacy(old);assert.equal(s.schemaVersion,2);assert.equal(s.people.length,30);assert.equal(s.buildings[14].capacity,12);assert.deepEqual(s.roads,old.roads);assert.equal(Scene.validate(s).ok,true);
 const base=Scene.referenceVillage(s);assert.equal(base.people.length,30);assert.equal(base.scenario.visitorsPerDay,s.scenario.visitorsPerDay);
});
