import test from 'node:test';import assert from 'node:assert/strict';let api;try{api=await import('../../supabase/functions/aliyun-facade-cloud/core.mjs');}catch{api={};}
const token='private-synthetic-bridge-token-1234567890',ownerId='10000000-0000-4000-8000-000000000001',requestId='20000000-0000-4000-8000-000000000002';
test('isolated cloud entry rejects browser credentials and caller photo/provider fields before any side effect',async()=>{
 assert.equal(typeof api.createCloudFacadeHandler,'function');let calls=0;const handler=api.createCloudFacadeHandler({token,instanceId:'aliyun-test',repository:{async claim(){calls++;}},provider:{available:true},storage:{}});
 const request=(authorization,body)=>new Request('https://source.invalid/private',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await handler(request('Bearer publishable',{action:'submit',ownerId,requestId}))).status,401);
 assert.equal((await handler(request('Bearer '+token,{action:'submit',ownerId,requestId,photoId:1}))).status,400);
 assert.equal((await handler(request('Bearer '+token,{action:'submit',ownerId,requestId,instanceId:'supabase'}))).status,400);assert.equal(calls,0);
});
test('cloud task uses the private receipt input and a durable claim, never repeats an uncertain provider submission',async()=>{
 assert.equal(typeof api.createCloudFacadeHandler,'function');let claimed=false,submits=0;const records=[];
 const repository={async claim(){if(claimed)return {operation:'wait'};claimed=true;return {operation:'submit',runId:requestId,photo:{path:'aliyun-test/photos/synthetic/hash.png'}};},async record(...args){records.push(args);}};
 const provider={available:true,async submit(input){submits++;assert.equal(input.imageUrl,'https://source.invalid/private-signed');throw Error('credential-bearing provider failure');}};
 const handler=api.createCloudFacadeHandler({token,instanceId:'aliyun-test',repository,provider,storage:{async signInput(photo){assert.equal(photo.path,'aliyun-test/photos/synthetic/hash.png');return 'https://source.invalid/private-signed';}}});
 const request=()=>new Request('https://source.invalid/private',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({action:'submit',ownerId,requestId})});
 const first=await handler(request());assert.equal(first.status,503);assert.doesNotMatch(await first.text(),/credential/);await handler(request());assert.equal(submits,1);assert.equal(records[0][1].status,'submission_unknown');
});
