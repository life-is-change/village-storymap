const test=require('node:test'),assert=require('node:assert/strict');
const {loadStudioResources}=require('./index');
test('seed catalog, uploaded assets and milestones begin together and remain scoped',async()=>{
 const events=[];let release;const gate=new Promise(r=>release=r);
 const result=loadStudioResources({
  loadSeeds:async()=>{events.push('seed');await gate;return [{id:'seed'}];},
  loadAssets:async()=>{events.push('assets');await gate;return {ok:true,data:[{id:'asset'}]};},
  loadVersions:async()=>{events.push('versions');await gate;return {ok:true,data:[{id:'version'}]};}
 });
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['seed','assets','versions']);release();
 assert.deepEqual(await result,{seeds:[{id:'seed'}],assets:[{id:'asset'}],versions:[{id:'version'}]});
});
test('rejected resource loads are propagated without a cached failed opening',async()=>{
 await assert.rejects(loadStudioResources({loadAssets:async()=>{throw Error('offline');}}),/offline/);
 assert.deepEqual(await loadStudioResources({}),{seeds:[],assets:[],versions:[]});
});
