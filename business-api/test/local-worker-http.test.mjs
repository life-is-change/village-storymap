import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {listenLoopback} from './fixtures/http-listen.mjs';
import {createLocalQueueService} from '../local-tasks/service.mjs';
let mod;try{mod=await import('../local-tasks/http.mjs');}catch{mod={};}
const workerId='10000000-0000-4000-8000-000000000001',runId='20000000-0000-4000-8000-000000000002';
const authorization='Bearer village_worker_'+workerId+'.'+'A'.repeat(43);
test('Worker HTTP authenticates its own key namespace and bounds method, lease and JSON input',async()=>{
 assert.equal(typeof mod.createLocalWorkerHandler,'function');let calls=0;
 const queue=createLocalQueueService({instanceId:'aliyun-test',database:{withMaintenance:async fn=>fn({query:async(sql)=>{calls++;return {rows:[{data:sql.includes('local_worker_auth')?{workerId,kind:'geo'}:{ok:true}}]};}})}});
 const server=createServer(mod.createLocalWorkerHandler({queue}));await listenLoopback(server);const base='http://127.0.0.1:'+server.address().port+'/api/worker/v1';
 try{
  assert.equal((await fetch(base+'/claim',{method:'POST',headers:{Authorization:'Bearer synthetic.browser.jwt'}})).status,401);assert.equal(calls,0);
  const headers={Authorization:authorization,'Content-Type':'application/json'};
  const good=await fetch(base+'/heartbeat',{method:'POST',headers,body:JSON.stringify({state:'idle',protocol:'geo-aliyun-local-v1'})});assert.equal(good.status,200);assert.equal((await good.json()).data.ok,true);
  assert.equal((await fetch(base+'/heartbeat',{headers})).status,405);
  assert.equal((await fetch(base+'/heartbeat',{method:'POST',headers,body:'{bad'})).status,400);
  assert.equal((await fetch(base+'/heartbeat',{method:'POST',headers,body:JSON.stringify({padding:'x'.repeat(9000)})})).status,413);
  assert.equal((await fetch(base+'/runs/'+runId+'/renew',{method:'POST',headers,body:'{}'})).status,400);
  assert.equal((await fetch(base+'/claim?kind=facade',{method:'POST',headers,body:'{}'})).status,400);
  assert.equal((await fetch(base+'/rpc',{method:'POST',headers,body:'{}'})).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Worker file routes require lease, bound binary chunks and serve byte ranges with closed handles',async()=>{
 const lease='30000000-0000-4000-8000-000000000003',uploadId='40000000-0000-4000-8000-000000000004';let closed=0,puts=0;
 const queue={authenticate:async()=>({})},files={async openInput(){return {size:6,mime:'image/png',sha256:'a'.repeat(64),stream:({start,end})=>(async function*(){yield Buffer.from('abcdef').subarray(start,end+1);})(),async close(){closed++;}};},async put(a,r,l,input,stream){assert.equal(l,lease);assert.equal(input.uploadId,uploadId);let count=0;for await(const part of stream)count+=part.length;assert.equal(count,3);puts++;return {offset:count};}};
 const server=createServer(mod.createLocalWorkerHandler({queue,files}));await listenLoopback(server);const base='http://127.0.0.1:'+server.address().port+'/api/worker/v1/runs/'+runId,headers={Authorization:authorization,'X-Village-Lease':lease};
 try{
  const read=await fetch(base+'/input',{headers:{...headers,Range:'bytes=1-3'}});assert.equal(read.status,206);assert.equal(await read.text(),'bcd');assert.equal(closed,1);
  const invalid=await fetch(base+'/input',{headers:{...headers,Range:'bytes=100-200'}});assert.equal(invalid.status,416);assert.equal(closed,2);
  const url=base+'/uploads/'+uploadId+'/chunks/0',binary={...headers,'Content-Type':'application/octet-stream','X-Village-Sha256':'a'.repeat(64)};
  assert.equal((await fetch(url,{method:'PUT',headers:binary,body:'abc'})).status,200);assert.equal(puts,1);
  assert.equal((await fetch(url,{method:'PUT',headers:{...binary,'Content-Encoding':'gzip'},body:'abc'})).status,415);
  assert.equal((await fetch(base+'/input',{headers:{Authorization:authorization}})).status,400);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});


test('read-only Worker identity accepts both kinds without queue mutation',async()=>{
 for(const kind of ['geo','facade']){
  let calls=0;
  const queue=createLocalQueueService({instanceId:'aliyun-test',database:{withMaintenance:async fn=>fn({query:async(sql)=>{calls++;assert.match(sql,/local_worker_auth/);return {rows:[{data:{workerId,kind}}]};}})}});
  const server=createServer(mod.createLocalWorkerHandler({queue}));await listenLoopback(server);
  try{const result=await fetch('http://127.0.0.1:'+server.address().port+'/api/worker/v1/identity',{headers:{Authorization:authorization}});
   assert.equal(result.status,200);assert.deepEqual((await result.json()).data,{workerId,kind,instanceId:'aliyun-test'});assert.equal(calls,1);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 }
});
