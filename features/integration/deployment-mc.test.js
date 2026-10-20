const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm');
test('MC browser delegates export to local service without querying source or supplying geometry',async()=>{
 const window={};vm.runInNewContext(fs.readFileSync('features/mc/mc-bridge.js','utf8'),{window,crypto:{randomUUID:()=> 'request'}});const calls=[];
 const deps={services:{mc:{execute:async(a,p)=>(calls.push([a,p]),{count:2})}},getContext:()=>({teachingProjectId:'p',villageId:'v',spaceId:'s'}),getSupabaseClient(){throw Error('SOURCE_QUERY');}};
 assert.equal(await window.McBridgeModule.exportCurrentSpaceBuildingsToMc(deps),2);assert.equal(calls[0][0],'mc.exportBuildings');assert.equal(calls[0][1].villageId,'v');assert.equal(calls[0][1].requestId,'request');
});
