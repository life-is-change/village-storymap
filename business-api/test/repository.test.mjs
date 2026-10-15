import test from 'node:test';
import assert from 'node:assert/strict';
const r=await import('../src/repository.mjs').catch(()=>({}));
test('profile absence is explicit and private queries are parameterized',async()=>{
 assert.equal(typeof r.getMe,'function','repository missing');
 await assert.rejects(()=>r.getMe({query:async()=>({rows:[]})},'test'),{code:'PROFILE_NOT_SYNCED'});
 let call;
 await r.getSpace({query:async(...args)=>{call=args;return {rows:[]};}},'personal',"x' OR true --",'user-id');
 assert.ok(!call[0].includes("x'"));assert.ok(call[0].includes('owner_id'));assert.deepEqual(call[1],["x' OR true --",'user-id']);
});
