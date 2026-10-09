const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('camera uses current village extent before any building or terrain await',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../app-3d.js'),'utf8');
 const start=source.indexOf('  function positionVillageCamera(');
 assert.ok(start>=0,'early camera function exists');
 const end=source.indexOf('\n  async function initViewer()',start);
 const calls=[];
 const sandbox={
  viewer:{camera:{flyToBoundingSphere:(sphere,options)=>calls.push({sphere,options})},scene:{requestRender(){}}},
  getMain3DResources:()=>({initialExtent:[110,20,111,21]}),
  getBasemapGeoref:()=>{throw Error('wrong village fallback');},
  window:{Village3DConfigModule:require('./village-3d-config')},
  Cesium:{Cartesian3:{fromDegrees:(x,y)=>[x,y]},BoundingSphere:class {constructor(center){this.center=center;}},
   HeadingPitchRange:class{constructor(h,p,r){this.range=r;}},Math:{toRadians:x=>x*Math.PI/180}}
 };
 vm.runInNewContext(source.slice(start,end)+';positionVillageCamera()',sandbox);
 assert.deepEqual(Array.from(calls[0].sphere.center),[110.5,20.5]);
 assert.equal(calls[0].options.duration,0);
 const load=source.slice(source.indexOf('  async function loadBuildingsNow()'),source.indexOf('  const loadBuildings ='));
 assert.ok(load.indexOf('positionVillageCamera()')<load.indexOf('await Promise.all('));
 assert.ok(load.indexOf('viewer.flyTo(buildingsDataSource')<load.indexOf('await applyTerrainHeights'));
});
