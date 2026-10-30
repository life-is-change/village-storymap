const test=require('node:test'),assert=require('node:assert/strict');const Scene=require('./scene'),Schedule=require('./schedule');
test('household and school plans use qualified cooks and guardians with a weekday calendar',()=>{
 const s=Scene.createIdealVillage(),bindings=Schedule.bind(s),day=Schedule.residentDay(s,bindings,1);for(const p of s.people){const tasks=day.plans[p.id];if(p.ageGroup==='child'){assert.ok(!tasks.some(t=>t.need==='work'||t.need==='cook'));assert.ok(tasks.some(t=>t.need==='school'));}for(const t of tasks.filter(t=>t.need==='cook'))assert.equal(t.target,bindings.homes[p.householdId]);}
 assert.ok(Object.values(day.plans).some(ts=>ts.some(t=>t.need==='escort')));const weekend=Schedule.residentDay(s,bindings,2);assert.ok(s.people.filter(p=>p.ageGroup==='child').every(p=>!weekend.plans[p.id].some(t=>t.need==='school')));
});
