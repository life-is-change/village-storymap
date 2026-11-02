const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('3D person following accepts existing false animation argument without an invalid camera range',()=>{
 const source=fs.readFileSync(__dirname+'/scene3d.js','utf8'),body=source.match(/focus\(p,range=165\)\{([\s\S]*?)\},destroy/)[1];let range;
 const C={HeadingPitchRange:function(a,b,r){assert.equal(typeof r,'number');assert.ok(r>0);range=r;},Matrix4:{IDENTITY:{}}};
 const viewer={camera:{lookAt(){},lookAtTransform(){}},scene:{requestRender(){}}};
 new Function('p','range','C','viewer','point',body)([0,0],false,C,viewer,()=>[0,0,0]);assert.equal(range,165);
});