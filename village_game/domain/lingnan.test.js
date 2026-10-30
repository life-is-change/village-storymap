const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('./scene'),Population=require('./population'),Schedule=require('./schedule'),Network=require('./network'),Editor=require('./editor'),Sim=require('./simulation'),Storage=require('./storage');
test('Lingnan preset has explicit varied families, concentrated lineage, preschool and legal connected cultural space',()=>{
 const s=Scene.createIdealVillage();assert.equal(s.people.length,72);assert.equal(s.households.length,24);
 assert.deepEqual([...new Set(s.households.map(h=>h.members.length))].sort(),[2,3,4,5]);
 assert.equal(s.households.filter(h=>h.surname==='林').length,18);
 for(const h of s.households){assert.ok(h.kind&&h.description);for(const id of h.members)assert.ok(s.people.find(p=>p.id===id).role);assert.ok(Scene.capacity(s.buildings.find(b=>b.id===h.homeId))>=h.members.length);}
 assert.ok(s.people.some(p=>p.age>=3&&p.age<6));assert.ok(s.buildings.some(b=>b.type==='kindergarten'));assert.ok(s.buildings.some(b=>b.type==='ancestral'));assert.ok(!s.buildings.some(b=>b.type==='school'));assert.ok(s.zones.some(z=>z.kind==='water'&&z.name.includes('塘')));
 assert.equal(Scene.validate(s).ok,true);assert.equal(Editor.validateSpatial(s).ok,true);const net=Network.buildNetwork(s);assert.deepEqual(s.buildings.filter(b=>!net.connected[b.id]).map(b=>b.id),[]);
 assert.match(Population.describeHousehold(s.households[2],s.people),/三代/);
});
test('kindergarten admits preschool children only and staffing/added primary school changes enrollment',()=>{
 const s=Scene.createIdealVillage(),bindings=Schedule.bind(s),k=s.buildings.find(b=>b.type==='kindergarten');assert.ok(k);
 for(const p of s.people.filter(p=>p.ageGroup==='child')){assert.equal(bindings.schools[p.id],p.schoolStage==='preschool'?k.id:'entry');if(p.age<6){assert.ok(p.needsEscort);assert.ok(bindings.guardians[p.id]);}}
 const sim=Sim.createSimulation(s);sim.step(240);const snap=sim.snapshot();assert.ok(snap.agents.some(a=>a.age<6&&a.state==='studying'));assert.ok(!snap.agents.some(a=>a.age<6&&a.need==='work'));const r=sim.runToEnd();assert.equal(r.schoolByDay[2]||0,0);assert.ok(r.facilities[k.id].served>0);assert.ok(r.facilities['ancestral-hall'].served>0);
 k.staff=0;assert.ok(s.people.filter(p=>p.age<6).every(p=>Schedule.bind(s).schools[p.id]==='entry'));
 const b=Scene.createBuilding('school',290,405,'new-primary',2);Object.assign(b,{depth:16,rotation:180,capacity:24,staff:1,schoolStage:'primary'});s.buildings.push(b);const next=Schedule.bind(s);assert.ok(s.people.filter(p=>p.ageGroup==='child'&&p.schoolStage==='primary').every(p=>next.schools[p.id]===b.id));assert.ok(s.people.filter(p=>p.schoolStage==='secondary'&&p.ageGroup==='child').every(p=>next.schools[p.id]==='entry'));
});
test('new family metadata round trips while previous village plans remain unchanged',()=>{
 assert.equal(typeof Scene.createPreviousVillage,'function');const old=Scene.createPreviousVillage(),stored=Storage.serialize(old,null);assert.deepEqual(Storage.parse(stored).scene,old);
 const s=Scene.createIdealVillage();assert.deepEqual(Storage.parse(Storage.serialize(s,null)).scene,s);const bad=Scene.clone(s);bad.people.find(p=>p.age<6).schoolStage='primary';assert.equal(Scene.validate(bad).ok,false);
 assert.match(Population.describeHousehold(old.households[0],old.people),/关系.*未/);
});

test('conversion to kindergarten chooses the preschool stage when no stage is explicitly supplied',()=>{const e=Editor.createEditor(Scene.createIdealVillage());e.apply({type:'update-building',id:'home-3',patch:{type:'kindergarten',capacity:4,staff:1}});assert.equal(e.scene.buildings.find(b=>b.id==='home-3').schoolStage,'preschool');assert.equal(Scene.validate(e.scene).ok,true);});

test('legacy migration respects preschool stage and unstaffed cultural facilities',()=>{const old=Scene.createVillage();old.buildings[14].type='kindergarten';old.buildings[15].type='ancestral';const upgraded=Scene.upgradeLegacy(old);assert.equal(Scene.validate(upgraded).ok,true);assert.equal(upgraded.buildings[14].schoolStage,'preschool');assert.equal(upgraded.buildings[15].staff,0);});
