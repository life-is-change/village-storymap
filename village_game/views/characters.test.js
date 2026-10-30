const test=require('node:test'),assert=require('node:assert/strict');let C;try{C=require('./characters');}catch{}
test('original characters share their geometry between canvas and SVG without external images',()=>{assert.ok(C);const a={kind:'resident',ageGroup:'adult',state:'moving',sex:'female'},rects=[];C.draw({fillRect(...r){rects.push(r);},set fillStyle(v){}},a,0,0,24,0);assert.ok(rects.length>5);const svg=decodeURIComponent(C.image(a,0).split(',')[1]);assert.match(svg,/<svg/);assert.ok(!svg.includes('<image'));assert.equal((svg.match(/<rect /g)||[]).length,rects.length);assert.notEqual(C.image(a,0),C.image(a,1));});
test('working sitting and visitors have distinct readable shared poses',()=>{assert.ok(C);const a={kind:'resident',ageGroup:'senior',state:'resting'};assert.notEqual(C.image(a,0),C.image({...a,state:'working'},0));assert.notEqual(C.image(a,0),C.image({...a,kind:'visitor',profile:'family'},0));assert.equal(C.image(a,0),C.image(a,1));});

test('every pose has a visible shoe touching the supplied ground point without transparent bottom padding',()=>{
 for(const state of ['moving','resting','eating','staying','home','working','cooking','waiting'])for(const phase of [0,1]){
  const marks=[];C.draw({fillRect(x,y,w,h){marks.push({x,y,w,h,color:this.fillStyle});}}, {kind:'resident',ageGroup:'adult',state},100,200,24,phase);
  const opaque=marks.filter(r=>/^#[\da-f]{6}$/i.test(r.color));
  assert.equal(Math.max(...opaque.map(r=>r.y+r.h)),200,`${state}: shoes must touch ground at y=200`);
  assert.ok(marks.every(r=>r.y+r.h<=200),'no pixels below the ground anchor');
 }
});
