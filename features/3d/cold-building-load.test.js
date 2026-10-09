const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../app-3d.js'),'utf8');
const body=source.slice(source.indexOf('  async function loadBuildingsNow()'),source.indexOf('  const loadBuildings ='));
test('cold building load overlaps CSV, geometry and scoped edit reads; stale result is discarded',async()=>{
 let release;const gate=new Promise(r=>release=r),events=[];
 const s={viewer:{dataSources:{remove(){}}},clearAllReplacementModels(){},clearActiveEntity(){},buildingsDataSource:null,roadsDataSource:null,
 entityMap:new Map(),terrainHeightCache:new Map(),positionVillageCamera(){},startupCameraKey:null,key:'A',get3DLoadKey:()=>s.key,
 getActualLinkedSpaceIdFor3D:()=> 'space',getLinked2DSpaceFor3D:()=>({spaceType:'shared'}),getMain3DResources:()=>({buildingUrl:'geometry'}),
 CSV_URL:'csv',GEOJSON_URL:'geometry',loadCSVRows:async()=>{events.push('csv');await gate;},
 loadText:async()=>{events.push('geometry');await gate;return '{"features":[]}';},
 list3DBuildingsFromDb:async()=>{events.push('edits');await gate;return [];},window:{EffectiveBuildingFeaturesModule:{}},
 };
 const load=vm.runInNewContext(body+';loadBuildingsNow',s),pending=load();
 await new Promise(r=>setImmediate(r));const started=[...events];s.key='B';release();await pending;
 assert.deepEqual(started.sort(),['csv','edits','geometry']);
});
