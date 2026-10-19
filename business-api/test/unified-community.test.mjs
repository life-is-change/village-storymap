import test from 'node:test';import assert from 'node:assert/strict';
let api;try{api=await import('../unified/community.mjs');}catch{api={};}
test('community operations are bound to identity, receipts and real numeric legacy IDs',async()=>{
 assert.equal(typeof api.createCommunityService,'function');const calls=[];const service=api.createCommunityService({database:{async withIdentity(i,fn,o){calls.push(o);return fn({async query(sql,args){calls.push([sql,args]);return {rows:[{data:{id:7}}]};}});}}});
 const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',requestId:'c0000000-0000-4000-8000-000000000001'};
 assert.equal((await service.execute({},'community.updateTask',{...c,id:7,body:'Updated',revision:0})).id,7);
 await assert.rejects(service.execute({},'community.react',{...c,id:7,reaction:'like',likerName:'Admin'}),{code:'INVALID_INPUT'});
 assert.equal(calls.length,2);assert.equal(calls[0].readOnly,false);
});
