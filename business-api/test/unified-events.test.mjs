import test from 'node:test';import assert from 'node:assert/strict';
let api;try{api=await import('../unified/events.mjs');}catch{api={};}
const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A'};
const identity={userId:'10000000-0000-4000-8000-000000000001',expiry:1000};
test('event streams borrow short transactions, expire and enforce connection budgets',async()=>{
 assert.equal(typeof api.createEventService,'function');let clock=1000,borrowed=0,reads=0;
 const database={async withIdentity(i,fn){borrowed++;try{return await fn({async query(sql,args){assert.match(sql,/event_read/);reads++;return {rows:[{data:{cursor:String(reads),refresh:true,events:[]}}]};}});}finally{borrowed--;}}};
 const service=api.createEventService({database,now:()=>clock,wait:async()=>{assert.equal(borrowed,0);clock=1000001;}});
 const streams=await Promise.all(Array.from({length:4},()=>service.open(identity,[context],null)));
 await assert.rejects(service.open(identity,[context],null),{code:'RATE_LIMITED'});
 assert.equal((await streams[0].next()).value.event,'refresh');assert.equal(borrowed,0);
 assert.equal((await streams[0].next()).done,true);assert.equal(reads,4);await service.close();assert.equal(borrowed,0);
});
test('revocation ends a stream before another event, and backpressure has a deadline',async()=>{
 assert.equal(typeof api.createEventService,'function');let allowed=true,clock=1000;
 const service=api.createEventService({now:()=>clock,wait:async()=>{clock+=15000;},database:{async withIdentity(i,fn){if(!allowed)throw Object.assign(Error('FORBIDDEN'),{code:'FORBIDDEN'});return fn({async query(){return {rows:[{data:{cursor:'1',refresh:true,events:[]}}]};}});}}});
 const stream=await service.open(identity,[context],null);await stream.next();allowed=false;
 await assert.rejects(stream.next(),{code:'FORBIDDEN'});const next=await service.open({...identity,userId:'20000000-0000-4000-8000-000000000002'},[context],null).catch(e=>e);assert.equal(next.code,'FORBIDDEN');
 allowed=true;const slow=await service.open(identity,[context],null);clock+=30001;assert.equal((await slow.next()).done,true);await service.close();
});
test('the global stream budget stays at 32 with no permanently borrowed clients',async()=>{
 let borrowed=0;const service=api.createEventService({database:{async withIdentity(i,fn){borrowed++;try{return await fn({async query(){return {rows:[{data:{cursor:'0',refresh:true,events:[]}}]};}});}finally{borrowed--;}}}});
 for(let i=0;i<32;i++)await service.open({...identity,userId:String(i)},[context]);
 assert.equal(borrowed,0);await assert.rejects(service.open({...identity,userId:'new'},[context]),{code:'RATE_LIMITED'});await service.close();
});
