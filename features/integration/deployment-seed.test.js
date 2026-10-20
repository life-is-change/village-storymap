const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm');
test('local copy initialization uses scoped API reads and audited lock/save/release, never raw source upsert',async()=>{
 const window={},calls=[];vm.runInNewContext(fs.readFileSync('features/data/copy-space-seed.js','utf8'),{window,console,crypto:{randomUUID:()=> 'request'}});
 const context={teachingProjectId:'p',villageId:'v',spaceId:'copy'},geom={type:'Polygon',coordinates:[]};
 const deps={services:{planning:{execute:async(a,p)=>{calls.push([a,p]);if(a==='planning.listFeatures')return [{object_code:'B',geom,props:{},layer_key:'building'}];if(a==='planning.acquireLock')return {success:true,lockToken:'lease'};return {};}}},getContext:()=>context,getSupabaseClient:()=>({from(){throw Error('SOURCE_QUERY');}}),hasAnyBuildingFeaturesInDb:async()=>false,isBaseSpace:()=>false,BASE_SPACE_ID:'base',normalizeCode:v=>v,cloneJson:v=>v,PLANNING_FEATURES_TABLE:'planning_features'};
 await window.CopySpaceSeedModule.seedBuildingsForCopySpace(deps,'copy');assert.equal(calls.find(c=>c[0]==='planning.saveBatch')[1].changes[0].lockToken,'lease');assert.equal(calls.at(-1)[0],'planning.releaseLock');
});
