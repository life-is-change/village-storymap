import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {OPERATIONS,exampleInput} from '../unified/contracts.mjs';
let api;try{api=await import('../unified/http.mjs');}catch{api={};}
async function serverFor(handler,fn){const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn('http://127.0.0.1:'+server.address().port);}finally{await new Promise(r=>server.close(r));}}
test('every fixed unified action is authenticated, bounded, dispatched once and never leaks credentials',async()=>{
 assert.equal(typeof api.createUnifiedHandler,'function');const calls=[],logs=[];
 const services={execute:async(identity,action,input)=>(calls.push({identity,action,input}),{action}),events:{},files:{}};
 await serverFor(api.createUnifiedHandler({services,verifyIdentity:async header=>{if(header!=='Bearer test-secret')throw Object.assign(Error('private source failure'),{code:'UNAUTHORIZED',status:401});return {userId:'test'};},release:{releaseId:'test'},log:v=>logs.push(v)}),async base=>{
  assert.equal((await fetch(base+'/healthz')).status,200);
  assert.equal((await fetch(base+'/api/v1/me')).status,401);
  for(const [action,route]of Object.entries(OPERATIONS)){
   const response=await fetch(base+route.path,{method:route.method,headers:{Authorization:'Bearer test-secret','Content-Type':'application/json'},...(route.method==='POST'?{body:JSON.stringify(exampleInput(action))}:{})});assert.equal(response.status,200,action);assert.equal((await response.json()).data.action,action);
  }
  assert.equal(calls.length,Object.keys(OPERATIONS).length);
  const invalid=await fetch(base+OPERATIONS['catalog.listCourses'].path,{method:'POST',headers:{Authorization:'Bearer test-secret','Content-Type':'application/json'},body:'{"table":"profiles"}'});assert.equal(invalid.status,400);
  assert.equal((await fetch(base+'/api/v1/rpc/arbitrary',{method:'POST'})).status,404);
  assert.equal((await fetch(base+'/api/v1/scene-files/scene/version',{method:'POST'})).status,404);
  assert.equal((await fetch(base+'/api/v1/me?user=other',{headers:{Authorization:'Bearer test-secret'}})).status,400);
  assert.equal((await fetch(base+OPERATIONS['catalog.listCourses'].path,{method:'POST',headers:{Authorization:'Bearer test-secret','Content-Type':'application/json'},body:' '.repeat(2*1024**2+1)})).status,413);
 });assert.ok(!JSON.stringify(logs).includes('test-secret'));assert.ok(!JSON.stringify(logs).includes('private source failure'));
});
test('shared lifecycle closes events and outbox before the only connection pool, once',async()=>{
 assert.equal(typeof api.closeUnifiedServices,'function');const closed=[],services={events:{close:async()=>closed.push('events')},tasks:{close:async()=>closed.push('tasks')},database:{close:async()=>closed.push('pool')}};
 const close=api.closeUnifiedServices(services);await Promise.all([close(),close()]);assert.deepEqual(closed,['events','tasks','pool']);
});
