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
