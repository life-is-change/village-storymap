import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
let api;try{api=await import('../../supabase/functions/aliyun-task-bridge/core.mjs');}catch{api={};}
const token='private-synthetic-bridge-token-1234567890';
test('source transport fixes the instance and RPC set, denies browser credentials and arbitrary SQL',async()=>{
 assert.equal(typeof api.createBridgeHandler,'function');const calls=[];const h=api.createBridgeHandler({token,instanceId:'aliyun-test',database:{async call(op,p){calls.push([op,p]);return {instanceId:'aliyun-test'};}},storage:{}});
 const request=(value,auth=token)=>new Request('https://source.invalid/private',{method:'POST',headers:{authorization:'Bearer '+auth},body:JSON.stringify(value)});
 assert.equal((await h(request({action:'call',operation:'bridge_v1_status',input:{}} ,'publishable'))).status,401);
 assert.equal((await h(request({action:'call',operation:'select * from profiles',input:{}}))).status,400);
 assert.equal((await h(request({action:'call',operation:'bridge_v1_status',input:{},instanceId:'supabase'}))).status,400);
 assert.equal((await h(request({action:'call',operation:'bridge_v1_status',input:{ownerId:'a',requestId:'b'}}))).status,200);assert.equal(calls.length,1);
});
test('private task input bytes are hashed and scoped before an immutable upload',async()=>{
 assert.equal(typeof api.createBridgeHandler,'function');const bytes=Buffer.from([137,80,78,71,13,10,26,10]),sha256=createHash('sha256').update(bytes).digest('hex'),stored=[];
 const h=api.createBridgeHandler({token,instanceId:'aliyun-test',database:{},storage:{async putInput(path,data,mime){stored.push([path,data.length,mime]);}}});
 const photo={fileId:'10000000-0000-4000-8000-000000000001',sha256,size:bytes.length,mime:'image/png'};
 const req=p=>new Request('https://source.invalid/private',{method:'POST',headers:{authorization:'Bearer '+token,'x-bridge-photo':JSON.stringify(p)},body:bytes});
 assert.equal((await h(req({...photo,sha256:'a'.repeat(64)}))).status,422);assert.equal(stored.length,0);
 const response=await h(req(photo));assert.equal(response.status,200);assert.equal((await response.json()).path,`aliyun-test/photos/${photo.fileId}/${sha256}.png`);assert.equal(stored.length,1);
});
