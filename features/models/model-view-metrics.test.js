const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function api(){const p=path.join(__dirname,'model-view-metrics.js');assert.ok(fs.existsSync(p),'viewport metrics module required');return require(p);}
const Cesium={Cartesian2:class {},Cartesian3:{distance:(a,b)=>Math.abs(a.x-b.x)},SceneTransforms:{wgs84ToWindowCoordinates:(_scene,p)=>({x:p.screenX??400,y:300})}};
function viewer(){return {camera:{positionWC:{x:0},frustum:{fovy:Math.PI/3}},scene:{canvas:{clientWidth:800,clientHeight:600}}};}
test('projected model size shrinks with distance and excludes offscreen models',()=>{
 const near=api().measureModelView(Cesium,viewer(),{x:100},5),far=api().measureModelView(Cesium,viewer(),{x:1000},5);
 assert.ok(near.pixels>far.pixels*9);assert.equal(near.inView,true);
 assert.equal(api().measureModelView(Cesium,viewer(),{x:100,screenX:2000},5).inView,false);
});
test('safe metrics fail closed when camera or position is missing',()=>{
 assert.equal(api().measureModelView(Cesium,null,null,5).inView,false);
});
