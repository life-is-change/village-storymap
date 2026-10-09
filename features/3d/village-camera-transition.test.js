const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../../app-3d.js'),'utf8');

test('first village camera flight is short and does not depend on terrain or building reads',()=>{

 const start=source.indexOf('  function positionVillageCamera('),end=source.indexOf('\n  async function initViewer()',start),calls=[];

 const s={viewer:{camera:{flyToBoundingSphere:(a,b)=>calls.push(b)},scene:{requestRender(){}}},

 getMain3DResources:()=>({initialExtent:[110,20,111,21]}),window:{Village3DConfigModule:require('./village-3d-config')},

 Cesium:{Cartesian3:{fromDegrees:()=>({})},BoundingSphere:class{},HeadingPitchRange:class{},Math:{toRadians:x=>x}}};

 vm.runInNewContext(source.slice(start,end)+';positionVillageCamera({duration:0.65})',s);

 assert.equal(calls[0].duration,0.65);

});




test('cached buildings wait for the first camera flight and obsolete focus callbacks do nothing',()=>{
 const start=source.indexOf('    if (entities.length',source.indexOf('  async function loadBuildingsNow()'));
 const end=source.indexOf('    await applyTerrainHeights(entities);',start);
 const calls=[],dataSource={},viewer={flyTo:(s,o)=>calls.push({s,o})};
 const s={entities:[{}],viewer,buildingsDataSource:dataSource,isStartupCamera:true,startupCameraPending:true,startupCameraCancelled:false,startupCameraFocus:null,
  isCurrentLoad:()=>true,is3DViewActive:()=>true,getOverviewCameraOffset:()=>({})};
 vm.runInNewContext(source.slice(start,end),s);
 assert.equal(calls.length,0);
 const focus=s.startupCameraFocus;focus();assert.equal(calls.length,1);
 s.buildingsDataSource={};focus();assert.equal(calls.length,1);
 s.buildingsDataSource=dataSource;s.is3DViewActive=()=>false;focus();assert.equal(calls.length,1);
});

test('a user cancelling the first flight before buildings return preserves their camera',()=>{
 const start=source.indexOf('    if (entities.length',source.indexOf('  async function loadBuildingsNow()'));
 const end=source.indexOf('    await applyTerrainHeights(entities);',start);
 const calls=[],s={entities:[{}],viewer:{flyTo:()=>calls.push('fly')},buildingsDataSource:{},
 isStartupCamera:true,startupCameraPending:false,startupCameraCancelled:true,startupCameraFocus:null,
 isCurrentLoad:()=>true,is3DViewActive:()=>true,getOverviewCameraOffset:()=>({})};
 vm.runInNewContext(source.slice(start,end),s);
 assert.equal(calls.length,0);assert.equal(s.startupCameraFocus,null);
});
