import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {createHandler} from '../src/http.mjs';
import {fixture} from './fixtures/storage.mjs';
const storageModule=await import('../src/storage.mjs').catch(()=>({}));
test('private file routes authorize before metadata and serve GET HEAD single ranges',async()=>{
 assert.equal(typeof storageModule.createStorageReader,'function','file routes not implemented');
 const f=await fixture();const storage=await storageModule.createStorageReader(f);let dbCalls=0;const logs=[];
 const handler=createHandler({storage,verifyIdentity:async h=>{if(!['Bearer A','Bearer B'].includes(h))throw {code:'UNAUTHORIZED'};return {userId:h==='Bearer A'?'A':'B'};},database:{withIdentity:async(i,fn)=>{dbCalls++;return fn({user:i.userId});}},repository:{getMe:async()=>({}),getStorageObject:async(c,id)=>c.user==='A'&&id===f.object.id?f.object:null},log:r=>logs.push(r)});
 const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v1/files/';
 try{
  let r=await fetch(base+f.object.id);assert.equal(r.status,401);assert.equal(dbCalls,0);
  r=await fetch(base+f.object.id,{headers:{Authorization:'Bearer B'}});assert.equal(r.status,404);assert.equal(r.headers.get('etag'),null);
  r=await fetch(base+f.object.id,{headers:{Authorization:'Bearer A'}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('content-type'),'model/gltf-binary');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await r.arrayBuffer()),f.bytes);
  r=await fetch(base+f.object.id,{method:'HEAD',headers:{Authorization:'Bearer A'}});assert.equal(r.status,200);assert.equal(Number(r.headers.get('content-length')),f.bytes.length);assert.equal((await r.arrayBuffer()).byteLength,0);
  for(const [range,status,text] of [['bytes=0-3',206,'synt'],['bytes=-5',206,'bytes'],['bytes=4-',206,'hetic GLB bytes'],['bytes=200-',416,null],['bytes=0-1,3-4',416,null],['nonsense',416,null]]){
   r=await fetch(base+f.object.id,{headers:{Authorization:'Bearer A',Range:range}});assert.equal(r.status,status,range);if(text)assert.equal(await r.text(),text);else assert.equal(r.headers.get('content-range'),'bytes */19');
  }
  for(const [path,method,status] of [[f.object.id+'?path=secret','GET',400],['..%2fsecret','GET',400],[f.object.id,'POST',405]]){
   r=await fetch(base+path,{method,headers:{Authorization:'Bearer A'}});assert.equal(r.status,status,path);
  }
  await writeFile(f.blob,Buffer.alloc(f.bytes.length,90));r=await fetch(base+f.object.id,{headers:{Authorization:'Bearer A'}});assert.equal(r.status,503);assert.ok(!(await r.text()).includes(f.root));
  assert.ok(!JSON.stringify(logs).includes(f.object.id));assert.ok(!JSON.stringify(logs).includes('Bearer'));
 }finally{await new Promise(r=>server.close(r));await f.cleanup();}
});
test('empty file GET and HEAD succeed and empty ranges fail without byte leakage',async()=>{
 const f=await fixture(Buffer.alloc(0));const storage=await storageModule.createStorageReader(f);
 const server=createServer(createHandler({storage,verifyIdentity:async()=>({userId:'a'}),database:{withIdentity:async(_,fn)=>fn({})},repository:{getMe:async()=>({}),getStorageObject:async()=>f.object}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/api/v1/files/'+f.object.id;
 try{
  for(const method of ['GET','HEAD']){const r=await fetch(url,{method});assert.equal(r.status,200);assert.equal(r.headers.get('content-length'),'0');assert.equal((await r.arrayBuffer()).byteLength,0);}
  const r=await fetch(url,{headers:{Range:'bytes=0-0'}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */0');
 }finally{await new Promise(r=>server.close(r));await f.cleanup();}
});
