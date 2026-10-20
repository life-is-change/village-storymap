import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {Readable} from 'node:stream';import {randomUUID} from 'node:crypto';
import {listenLoopback} from './fixtures/http-listen.mjs';
const mod=await import('../scene-files/http.mjs').catch(()=>({}));
test('HTTP authenticates before reading, bounds JSON and Range, and redacts failures',async()=>{
 assert.equal(typeof mod.createSceneFilesHandler,'function');let calls=0,closed=0;const id=randomUUID();
 const server=createServer(mod.createSceneFilesHandler({verifyIdentity:async h=>{if(h!=='Bearer good')throw {code:'UNAUTHORIZED'};return {userId:id};},database:{run:async()=>{calls++;throw Error('private SQL secret');}},uploads:{read:async()=>({size:4,mime:'model/gltf-binary',extension:'glb',role:'display',stream:({start,end})=>Readable.from([Buffer.from('glTF').subarray(start,end+1)]),close:async()=>{closed++;}})}}));
 await listenLoopback(server);const base='http://127.0.0.1:'+server.address().port+'/api/v1/scene-files';
 try{
  assert.equal((await fetch(base+'/scene/load',{method:'POST',body:'{bad json'})).status,401);assert.equal(calls,0);
  const huge=await fetch(base+'/scene/load',{method:'POST',headers:{Authorization:'Bearer good','Content-Type':'application/json'},body:JSON.stringify({padding:'x'.repeat(2*1024*1024)})});assert.equal(huge.status,413);
  const data=await fetch(base+'/files/'+id,{headers:{Authorization:'Bearer good',Range:'bytes=1-2'}});assert.equal(data.status,206);assert.equal(await data.text(),'lT');assert.equal(data.headers.get('content-range'),'bytes 1-2/4');assert.equal(data.headers.get('x-content-type-options'),'nosniff');
  const bad=await fetch(base+'/files/'+id,{headers:{Authorization:'Bearer good',Range:'bytes=10-'}});assert.equal(bad.status,416);
  const failed=await fetch(base+'/scene/load',{method:'POST',headers:{Authorization:'Bearer good','Content-Type':'application/json'},body:'{}'});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('secret'));assert.equal(closed,2);
  assert.equal((await fetch(base+'/rpc',{headers:{Authorization:'Bearer good'}})).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
