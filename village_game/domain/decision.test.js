const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('./scene'),Network=require('./network'),Schedule=require('./schedule'),Editor=require('./editor'),Storage=require('./storage');
const D=require('./decision');
test('probabilities are normalized, bounded, and respond to unmet needs',()=>{
 const p=D.probabilities([{score:1000},{score:1002}]);assert.ok(p.every(x=>Number.isFinite(x.probability)));assert.ok(Math.abs(p.reduce((s,x)=>s+x.probability,0)-1)<1e-9);
 const a={kind:'visitor',profile:'family',ageGroup:'adult',needsState:{hunger:90,fatigue:10,social:20},memory:{}};
 const food=Scene.createBuilding('food',0,0,'f',2),park=Scene.createBuilding('park',0,0,'p',2);
 const before=D.score(a,food,'food',720,2,0);D.update(a.needsState,'food',30);assert.ok(D.score(a,food,'food',750,2,0)<before);assert.ok(a.needsState.hunger<20);
 assert.ok(D.score({...a,needsState:{hunger:10,fatigue:90,social:20}},park,'rest',750,2,0)>D.score({...a,needsState:{hunger:10,fatigue:5,social:20}},park,'rest',750,2,0));
});
test('grades change quality and capped capacity; editor undo/import preserve them',()=>{
 const e=Editor.createEditor(Scene.createAdaptiveVillage()),b=e.scene.buildings.find(b=>b.type==='park'),old=Scene.capacity(b);
 e.apply({type:'update-building',id:b.id,patch:{level:3,upgrade:'comfort',attraction:75}});const next=e.scene.buildings.find(x=>x.id===b.id);
 assert.ok(Scene.capacity(next)>old);assert.ok(Scene.capacity(next)<=Scene.maximumCapacity(next));assert.ok(D.quality(next).comfort>D.quality(b).comfort);
 assert.equal(Storage.parse(Storage.serialize(e.scene)).scene.buildings.find(x=>x.id===b.id).upgrade,'comfort');e.undo();assert.equal(e.scene.buildings.find(x=>x.id===b.id).level||1,1);
 for(const patch of [{level:9},{attraction:NaN},{upgrade:'unknown'},{upgrade:'family',type:'clinic'}])assert.throws(()=>e.apply({type:'update-building',id:b.id,patch}));
});
test('market ignores disconnected/unoperated supply and has diminishing returns',()=>{
 const s=Scene.createAdaptiveVillage(),net=Network.buildNetwork(s),bindings=Schedule.bind(s,net),base=D.attractiveness(s,net,bindings.staff);
 assert.ok(base.day>0&&base.day<=100);const empty=Scene.clone(s);empty.roads=[];assert.equal(D.attractiveness(empty,Network.buildNetwork(empty),bindings.staff).day,0);
 const noStaff=Object.fromEntries(s.buildings.map(b=>[b.id,[]]));assert.ok(D.attractiveness(s,net,noStaff).overnight<base.overnight);
 const one=Scene.clone(s),p=one.buildings.find(b=>b.type==='attraction');p.attraction=100;p.level=3;p.upgrade='culture';const high=D.attractiveness(one,net,bindings.staff);assert.ok(high.day>base.day);
 const repeated=Scene.clone(one);for(let i=0;i<8;i++)repeated.buildings.push({...p,id:'copy-'+i});const rn=Network.buildNetwork(repeated);assert.ok(D.attractiveness(repeated,rn,bindings.staff).day-high.day<20);
});
test('seeded market is reproducible, bounded, responds to design, zero stays zero',()=>{
 const s=Scene.createAdaptiveVillage();let rng=()=>D.random(s.scenario.seed,1,'market');assert.deepEqual(D.market(s,1,50,rng()),D.market(s,1,50,rng()));
 const result=D.market(s,1,50,rng());assert.ok(result.actual<=s.scenario.visitorsPerDay);assert.ok(result.actual>=0);s.scenario.visitorsPerDay=0;assert.equal(D.market(s,1,50,rng()).actual,0);
 s.scenario.visitorMode='fixed';s.scenario.visitorsPerDay=24;assert.equal(D.market(s,1,50,rng()).actual,24);
 for(const mode of ['bogus',null]){s.scenario.visitorMode=mode;assert.equal(Scene.validate(s).ok,false);}
});
test('cultural and service restaurant upgrades influence individual choice even without crowds',()=>{const a={kind:'visitor',profile:'day',needsState:{hunger:70,fatigue:10,social:20}},b=Scene.createBuilding('food',0,0,'f',2),base=D.score(a,b,'food',720,2,0);for(const upgrade of ['culture','service'])assert.ok(D.score(a,{...b,level:3,upgrade},'food',720,2,0)>base);});
test('facilities closed throughout the day contribute no tourism attraction',()=>{const s=Scene.createAdaptiveVillage();for(const b of s.buildings)if(b.type!=='home'){b.open=0;b.close=1;}const a=D.attractiveness(s);assert.equal(a.overall,0);assert.equal(D.market(s,1,50).actual,0);});
test('completed experience reflects waiting rather than only success and upgrades',()=>{const b=Scene.createBuilding('food',0,0,'f',2);assert.ok(D.experience(b,20,2,false)<D.experience(b,0,2,false));});
test('unreachable employees cannot supply attraction merely because jobs were assigned',()=>{const s=Scene.createAdaptiveVillage(),base=D.attractiveness(s);for(const b of s.buildings)if(b.type==='home'){b.rotation=180;b.entrance=null;}const changed=D.attractiveness(s);assert.equal(changed.overnight,0);assert.ok(changed.day<base.day);});
