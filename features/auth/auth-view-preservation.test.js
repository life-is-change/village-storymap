const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8');
const start=source.indexOf('    window.addEventListener("village-auth-change", async () => {');
const end=source.indexOf('\n    updateAuthButtonUI();',start);
function fixture(next='A'){
 const calls=[],s={activeWorkspaceAccountKey:'A',window:{addEventListener:(type,fn)=>s.handler=fn,VillageAuth:{getCurrentUser:()=>({name:'admin'})}},
 closeSceneStudioWorkspace:()=>calls.push('close'),updateAuthButtonUI(){},setCurrentUser(){},renderHomepageIdentityUi(){},
 getAccountStorageKey:()=>next,reloadWorkspaceForAuthenticatedAccount:async()=>calls.push('reload'),courseWorkbench:{refresh:async()=>calls.push('refresh')}};
 vm.runInNewContext(source.slice(start,end),s);return {s,calls};
}
test('same-account auth refresh on generator return preserves current view and studio',async()=>{
 const f=fixture();await f.s.handler();assert.equal(f.calls.includes('close'),false);assert.deepEqual(f.calls,['refresh']);
});
test('account replacement or logout still closes studio before loading the new scope',async()=>{
 const f=fixture('signed-out');await f.s.handler();assert.deepEqual(f.calls,['close','reload']);assert.equal(f.s.activeWorkspaceAccountKey,'signed-out');
});
