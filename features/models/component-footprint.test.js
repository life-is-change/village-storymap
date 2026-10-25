const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/../../app-3d.js','utf8');
const fn=source.slice(source.indexOf('  function getEntityFootprintSizeMeters('),source.indexOf('  function estimateEntityFootprintHeadingDeg('));
function measure(holes){
 class Vec{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}static fromRadians(){return new Vec();}}
 const sandbox={Cesium:{Cartesian3:Vec,JulianDate:{now(){}},Transforms:{eastNorthUpToFixedFrame(){}},Matrix4:Object.assign(class {},{inverse(){return {};},multiplyByPoint(_m,p){return p;}}),Math:{toRadians:d=>d*Math.PI/180}},
  getEntityCenterCartographic:()=>({longitude:0,latitude:0}),toFiniteNumber:(v,f)=>Number.isFinite(Number(v))?Number(v):f};
 const calc=vm.runInNewContext(fn+';getEntityFootprintSizeMeters',sandbox);
 return calc({polygon:{hierarchy:{getValue:()=>({positions:[new Vec(-6,-4),new Vec(6,-4),new Vec(6,4),new Vec(-6,4)],holes})}}});
}
test('rectangular source preserves dimensions but courtyard holes cannot pass existing component footprint gate',()=>{
 const rectangle=measure([]);assert.equal(rectangle.sizeX,12);assert.equal(rectangle.sizeY,8);assert.equal(rectangle.rectangularity,1);
 assert.ok(measure([{positions:[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}]}]).rectangularity<.98);
});
