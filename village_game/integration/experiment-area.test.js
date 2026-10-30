const test=require('node:test'),assert=require('node:assert/strict'),Area=require('./experiment-area');
const square={type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23.001],[113,23]]]};
test('experiment boundary clips a long road and detects two unique external crossings',()=>{
 const r=Area.clipRoads([{key:'r',geometry:{type:'LineString',coordinates:[[112.99,23.0005],[113.01,23.0005]]}}],square);
 assert.equal(r.roads.length,1);assert.equal(r.entries.length,2);assert.ok(Math.abs(r.roads[0].geometry.coordinates[0][0]-113)<1e-9);
 assert.ok(Math.abs(r.roads[0].geometry.coordinates.at(-1)[0]-113.001)<1e-9);
 assert.equal(Area.clipRoads([{key:'r',geometry:{type:'LineString',coordinates:[[113.0001,23.0003],[113.0008,23.0003]]}}],square).entries.length,0);
});
test('clipping a concave area keeps separate pieces and never bridges the outside gap',()=>{
 const area={type:'Polygon',coordinates:[[[113,23],[113.003,23],[113.003,23.003],[113.002,23.003],[113.002,23.001],[113.001,23.001],[113.001,23.003],[113,23.003],[113,23]]]};
 const r=Area.clipRoads([{key:'r',geometry:{type:'LineString',coordinates:[[112.999,23.002],[113.004,23.002]]}}],area);
 assert.equal(r.roads.length,2);assert.equal(r.entries.length,4);
});
test('invalid and oversized experiment boundaries are rejected and valid polygons accepted',()=>{
 assert.equal(Area.validate(square).ok,true);assert.equal(Area.validate({type:'Polygon',coordinates:[[[0,0],[1,1],[0,1],[1,0],[0,0]]]}).ok,false);
 assert.equal(Area.validate({...square,coordinates:[square.coordinates[0].map(p=>[p[0]*2,p[1]])]}).ok,false);
});
test('a facility spanning the excluded notch is outside even when all of its corners lie inside',()=>{
 const make=ring=>({type:'Polygon',coordinates:[ring.map(([x,y])=>[113+x*.001,23+y*.001])]}),area=make([[0,0],[3,0],[3,3],[2,3],[2,1],[1,1],[1,3],[0,3],[0,0]]),facility=make([[.5,2],[2.5,2],[2.5,2.5],[.5,2.5],[.5,2]]);
 assert.equal(Area.contains(area,facility),false);
});
