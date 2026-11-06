const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
const start = source.indexOf('async function openSceneStudioWorkspace()');
const end = source.indexOf('  const previousView =', start);
const entry = source.slice(start, end) + 'return getCurrentSpace();}';
async function route({role='formal',group='group',current,spaces,dirty=false}) {
 const messages=[];
 const sandbox={spaces,activeVillageContext:{villageRole:role,teachingProjectId:'project',villageId:'village'},
  window:{VillageAuth:{getCurrentUser:()=>({id:'user',name:'Student'})}},
  courseWorkbench:{getContext:()=>({group:group?{id:group}:null})},
  isAdminIdentity:()=>false,hasUnsavedGeometryEdits:()=>dirty,
  getCurrentSpace:()=>spaces.find(s=>s.id===current),
  handleSpaceSelect:async id=>{current=id;},showToast:message=>{messages.push(message);}};
 const result=await vm.runInNewContext(entry+';openSceneStudioWorkspace()',sandbox);
 return {result,messages};
}
const personal={id:'personal',spaceType:'formal_personal',ownerId:'user',teachingProjectId:'project',villageId:'village'};
const shared={id:'shared',spaceType:'formal_shared',teachingProjectId:'project',villageId:'village'};
test('formal entry routes a remembered personal workspace to the shared group-scene baseline',async()=>{
 assert.equal((await route({current:'personal',spaces:[personal,shared]})).result.id,'shared');
});
test('formal entry prefers the actual current group plan and rejects entering without membership',async()=>{
 const groupPlan={...shared,id:'plan',spaceType:'group_plan',courseGroupId:'group'};
 assert.equal((await route({current:'personal',spaces:[personal,shared,groupPlan]})).result.id,'plan');
 assert.equal((await route({current:'personal',spaces:[personal,shared],group:null})).result,undefined);
});
test('practice entry uses the owner personal workspace without a group and protects pending edits',async()=>{
 const own={...personal,spaceType:'practice_personal'};
 const practice={...shared,spaceType:'practice_shared'};
 assert.equal((await route({role:'practice',group:null,current:'shared',spaces:[own,practice]})).result.id,'personal');
 assert.equal((await route({role:'formal',current:'personal',spaces:[personal,shared],dirty:true})).result,undefined);
});
