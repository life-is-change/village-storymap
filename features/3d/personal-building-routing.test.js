const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app-3d.js','utf8');
const readShared=source.slice(source.indexOf('  async function list3DBuildingsFromDb('),source.indexOf('  async function list3DPersonalBuildings('));
const readPersonal=source.slice(source.indexOf('  async function list3DPersonalBuildings('),source.indexOf('  async function list3DRoadsFromDb('));
const loadBody=source.slice(source.indexOf('  async function loadBuildingsNow()'),source.indexOf('  const loadBuildings ='));
function fixture(space,{forbidPersonal=false,resolve=false}={}){
 const calls=[];let keys=0,base;
 const ctx={viewer:{dataSources:{remove(){}}},clearAllReplacementModels(){},clearActiveEntity(){},buildingsDataSource:null,roadsDataSource:null,
  entityMap:new Map(),terrainHeightCache:new Map(),positionVillageCamera(){},startupCameraKey:null,get3DLoadKey:()=>++keys<=(resolve?2:1)?'current':'changed',
  getActualLinkedSpaceIdFor3D:()=>space.id,getLinked2DSpaceFor3D:()=>space,getMain3DResources:()=>({buildingUrl:'geometry'}),getActiveVillage3DContext:()=>({teachingProjectId:'p',villageId:'mibu'}),
  CSV_URL:'csv',GEOJSON_URL:'geometry',loadCSVRows:async()=>[],loadText:async()=>'{"features":[{"id":"baseline"}]}',
  window:{EffectiveBuildingFeaturesModule:{resolveEffectiveBuildingFeatureCollection(input){base=input.baseFeatures;return {features:[]};}},VillageBusinessServices:{planning:{async execute(action,input){
   calls.push([action,input]);if(action==='planning.listFeatures')return [{object_code:'H001'}];
   if(forbidPersonal)throw Object.assign(Error('FORBIDDEN'),{code:'FORBIDDEN'});
   if(action==='personal.listSelections')return [{layer_key:'building',current_version_id:'version'}];
   return [{object_code:'generated'}];
  }}}}
 };
 const run=vm.runInNewContext(readShared+readPersonal+loadBody+';loadBuildingsNow',ctx);
 return {run,calls,base:()=>base};
}
test('applied generated buildings do not reappear alongside the old 3D baseline',async()=>{
 const f=fixture({id:'own',spaceType:'practice_personal',appliedResultLayers:['building']},{resolve:true});await f.run();assert.deepEqual(Array.from(f.base()),[]);
});
for(const spaceType of ['practice_personal','formal_personal']){
 test(`3D reads ordinary ${spaceType} as planning features without calling the result version API`,async()=>{
  const f=fixture({id:'experience',spaceType},{forbidPersonal:true});await f.run();
  assert.deepEqual(f.calls.map(([a])=>a),['planning.listFeatures']);assert.equal(f.calls[0][1].spaceId,'experience');assert.equal(f.calls[0][1].includeDeleted,true);
 });
}
for(const space of [{id:'produced',spaceType:'practice_personal',personalLayerVersionSpace:true},{id:'legacy-produced',spaceType:'course_personal'}]){
 test(`3D reads explicitly versioned ${space.id} from the personal result API`,async()=>{
  const f=fixture(space);await f.run();assert.deepEqual(f.calls.map(([a])=>a),['personal.listSelections','personal.listFeatures']);assert.equal(f.calls[0][1].spaceId,space.id);assert.equal(f.calls[1][1].versionId,'version');
 });
}
test('3D does not swallow a genuine forbidden result-space read or fall back to baseline data',async()=>{
 const f=fixture({id:'forbidden',spaceType:'practice_personal',personalLayerVersionSpace:true},{forbidPersonal:true});await assert.rejects(f.run(),{code:'FORBIDDEN'});assert.deepEqual(f.calls.map(([a])=>a),['personal.listSelections']);
});
