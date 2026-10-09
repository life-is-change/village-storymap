const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8');
const body=app.slice(app.indexOf('async function prepareVillageContext('),app.indexOf('\nasync function unloadVillageContext'));
function fixture(existing){
 const events=[], shared={id:'shared',spaceType:'practice_shared'};
 const personal={id:'personal',spaceType:'practice_personal',ownerId:'me'};
 let listed=0;
 const sandbox={
  activeVillageContext:{actor:{userId:'me'},villages:[{id:'target'}]},
  window:{VillageModelModule:{filterSpacesForContext:({spaces})=>spaces}},
  villageClient:{listSpaces:async()=>{events.push('list');return existing||listed++?[shared,personal]:[shared];},ensurePersonalSpace:async()=>events.push('ensure')},
  courseWorkbench:null,mapContextSpaceToWorkspace:s=>s,isDualTrackPersonalSpace:s=>s.spaceType.endsWith('personal')
 };
 return {events,run:vm.runInNewContext(body+';prepareVillageContext',sandbox)};
}
test('returning to an existing village personal space avoids the creation RPC',async()=>{
 const f=fixture(true);const value=await f.run({teachingProjectId:'p',villageId:'target',role:'practice'});
 assert.deepEqual(f.events,['list']);assert.equal(value.spaceId,'shared');
});
test('a missing personal space is created and the updated list is used',async()=>{
 const f=fixture(false);const value=await f.run({teachingProjectId:'p',villageId:'target',role:'practice'});
 assert.deepEqual(f.events,['list','ensure','list']);assert.equal(value.spaces.length,2);
});
