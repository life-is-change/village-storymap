const test=require('node:test'),assert=require('node:assert/strict');
const D=require('./market-design'),Catalog=require('../views/catalog');
test('metre-scale market mixes ground, long tables and canopies and adapts to available length',()=>{
 const stalls=D.stalls(24,12);assert.ok(stalls.length>6);assert.ok(D.stalls(16,12).length<stalls.length);
 assert.deepEqual(new Set(stalls.map(s=>s.style)),new Set(['canopy','table','ground']));
 for(const s of stalls){assert.ok(Math.abs(s.x)+s.width/2<=12);assert.ok(Math.abs(s.y)+s.depth/2<6);assert.ok(s.width>=1.5&&s.width<=3.5);assert.ok(s.height<=2.5);}
 assert.equal(D.stalls(5,5).length,0);
 const shape=Catalog.structure({id:'m',type:'market',width:24,depth:12,height:1});assert.equal(shape.body,null);
 assert.ok(shape.parts.some(p=>p.role==='market-ground'));assert.ok(shape.parts.some(p=>p.role==='market-awning'));
});
