const test=require('node:test'),assert=require('node:assert/strict'),Population=require('./population');

test('morning-market teaching population has stable adult roles and genuine household memberships',()=>{
 const homes=[{id:'h1',type:'home'},{id:'h2',type:'home'}];const a=Population.generate(homes,18,{preset:'morning-market'}),b=Population.generate(homes,18,{preset:'morning-market'});
 assert.deepEqual(a,b);assert.equal(a.people.length,18);assert.equal(new Set(a.people.map(p=>p.id)).size,18);assert.ok(a.people.every(p=>p.age>=18));assert.equal(Population.validate({...a,scenario:{population:18}}).length,0);
});
