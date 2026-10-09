const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8');
const start=source.indexOf('    prepare: async ({ entry'),end=source.indexOf('    openWorkspace:',start);
const expression=source.slice(start,end).trim().replace(/^prepare: /,'').replace(/,$/,'');
test('ready basemap is revealed while course workspace is still loading',async()=>{
 let release;const gate=new Promise(r=>release=r),states=[];
 const s={villageProjectReadyPromise:Promise.resolve(),projectSwitcher:null,ENABLE_SUPABASE_SYNC:true,
 activeVillageContext:{teachingProjectId:'p',villageId:'v',spaceId:'s'},
 ensureCourseWorkbenchInitialized:async()=>{await gate;return {getContext:()=>({})};},
 ensurePlanMap:async()=>({}),setPlanMapLoadingState:x=>states.push(x)};
 const prepare=vm.runInNewContext('('+expression+')',s),pending=prepare({}, {isCurrent:()=>true});
 await new Promise(r=>setImmediate(r));const before=[...states];release();await pending;
 assert.ok(before.includes(false),'map must not stay covered until course queries finish');
});
