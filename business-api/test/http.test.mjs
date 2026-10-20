import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {listenLoopback} from './fixtures/http-listen.mjs';
const m=await import('../src/http.mjs').catch(()=>({}));
const uid='10000000-0000-4000-8000-000000000001';
test('fixed HTTP routes enforce auth methods input and error redaction',async()=>{
 assert.equal(typeof m.createHandler,'function','HTTP API missing');let dbCalls=0;const logs=[];
 const handler=m.createHandler({verifyIdentity:async h=>{if(h!=='Bearer good')throw Object.assign(Error('private-token'),{code:'UNAUTHORIZED'});return {userId:uid};},database:{withIdentity:async(_,fn)=>{dbCalls++;return fn({});}},repository:{getMe:async()=>({id:uid}),listCourses:async()=>[],listSpaces:async()=>[],getSpace:async()=>null},requestId:()=> 'test-request',log:r=>logs.push(r)});
 const server=createServer(handler);await listenLoopback(server);const base='http://127.0.0.1:'+server.address().port;
 try{
  let r=await fetch(base+'/healthz');assert.deepEqual(await r.json(),{status:'ok'});assert.equal(dbCalls,0);
  r=await fetch(base+'/api/v1/me');assert.equal(r.status,401);assert.equal(dbCalls,0);assert.ok(!JSON.stringify(await r.json()).includes('private-token'));
  for(const path of ['/api/v1/me','/api/v1/courses','/api/v1/spaces','/api/v1/spaces?kind=personal']){r=await fetch(base+path,{headers:{Authorization:'Bearer good'}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');}
  for(const [path,status,method] of [['/api/v1/me',405,'POST'],['/api/v1/spaces?limit=101',400,'GET'],['/api/v1/spaces?limit=1&limit=2',400,'GET'],['/api/v1/spaces/personal/wrong',400,'GET'],['/api/v1/spaces/group/hidden',404,'GET'],['/api/v1/rpc/admin',404,'POST'],['/api/v1/profiles',404,'GET'],['/api/v1/me?userid=other',400,'GET']]){
   r=await fetch(base+path,{method,headers:{Authorization:'Bearer good'}});assert.equal(r.status,status,path);const data=await r.json();assert.equal(data.error.requestId,'test-request');assert.deepEqual(Object.keys(data.error).sort(),['code','requestId']);
  }
  assert.ok(!JSON.stringify(logs).includes('good'));assert.ok(!JSON.stringify(logs).includes(uid));
 }finally{await new Promise(r=>server.close(r));}
});
