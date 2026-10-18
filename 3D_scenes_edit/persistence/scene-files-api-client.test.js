const test=require('node:test'),assert=require('node:assert/strict');let api;try{api=require('./scene-files-api-client');}catch{api={};}
const json=v=>new Response(JSON.stringify({data:v}),{headers:{'Content-Type':'application/json'}});
test('file client recovers a lost commit by querying the same session without source fallback',async()=>{
 assert.equal(typeof api.createSceneFilesClient,'function');const requests=[];let committed=false;const id='10000000-0000-4000-8000-000000000001';
 const client=api.createSceneFilesClient({baseUrl:'http://127.0.0.1:18083/api/v1/scene-files',getAccessToken:async()=>'good',fetchImpl:async(url,opts)=>{requests.push({url,opts});assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');if(url.endsWith('/commit')){if(committed)return json({id:'asset'});committed=true;throw Error('lost response');}if(opts.method==='PUT')return json({});if(opts.method==='GET')return json({id,state:committed?'committed':'ready',result:{id:'asset'}});return json({id,files:[{id,role:'display'}]});}});
 const result=await client.uploadBundle({context:{kind:'model',scopeKind:'personal',groupId:null,courseId:'course'},record:{displayName:'A',license:'student-provided',metadata:{}},files:[{role:'display',file:new Blob(['glb'],{type:'model/gltf-binary'})}]});assert.equal(result.ok,true);assert.equal(result.data.id,'asset');assert.equal(requests.filter(r=>r.url.endsWith('/sessions')).length,1);assert.ok(requests.every(r=>r.url.startsWith('http://127.0.0.1:18083/')));
});
test('lost commit recovery rechecks metadata instead of trusting another committed result',async()=>{
 let commits=0;const client=api.createSceneFilesClient({baseUrl:'http://127.0.0.1:18083/api/v1/scene-files',getAccessToken:async()=>'good',fetchImpl:async(url,opts)=>{
  if(url.endsWith('/commit')){if(++commits===1)throw Error('lost');return new Response(JSON.stringify({error:{code:'UPLOAD_CONFLICT'}}),{status:409});}
  if(opts.method==='PUT')return json({});return json({id:'10000000-0000-4000-8000-000000000001',state:commits?'committed':'pending',result:{id:'another-record'}});
 }});
 const result=await client.uploadBundle({context:{kind:'model'},record:{displayName:'ours'},files:[{role:'display',file:new Blob(['new'],{type:'model/gltf-binary'})}]});assert.equal(result.code,'UPLOAD_CONFLICT');assert.equal(commits,2);
});
test('file client authenticates blobs and revokes replacements and disposed URLs',async()=>{
 assert.equal(typeof api.createSceneFilesClient,'function');const revoked=[];let urls=0;const client=api.createSceneFilesClient({baseUrl:'http://127.0.0.1:18083/api/v1/scene-files',getAccessToken:async()=>'good',createObjectURL:()=>`blob:test-${++urls}`,revokeObjectURL:u=>revoked.push(u),fetchImpl:async(url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer good');return url.includes('/scene/')?json({fileId:'10000000-0000-4000-8000-000000000001'}):new Response(new Blob(['bytes']));}});
 assert.equal((await client.resolveAsset('asset','display')).url,'blob:test-1');assert.equal((await client.resolveAsset('asset','display')).url,'blob:test-2');assert.deepEqual(revoked,['blob:test-1']);client.dispose();assert.deepEqual(revoked,['blob:test-1','blob:test-2']);assert.equal((await client.resolveAsset('asset')).ok,false);
 assert.throws(()=>api.createSceneFilesClient({baseUrl:'http://8.148.248.237/api/v1/scene-files',getAccessToken:async()=>''}));
});
test('already committed sessions still verify commit contents on explicit retry',async()=>{
 let checked=0;const client=api.createSceneFilesClient({baseUrl:'http://127.0.0.1:18083/api/v1/scene-files',getAccessToken:async()=>'good',fetchImpl:async(url)=>{if(url.endsWith('/commit')){checked++;return new Response(JSON.stringify({error:{code:'UPLOAD_CONFLICT'}}),{status:409});}return json({id:'10000000-0000-4000-8000-000000000001',state:'committed',result:{id:'old'}});}});
 const result=await client.uploadBundle({context:{kind:'model'},record:{displayName:'changed'},files:[{role:'display',file:new Blob(['x'],{type:'model/gltf-binary'})}]});assert.equal(result.code,'UPLOAD_CONFLICT');assert.equal(checked,1);
});
test('a slower superseded resolver cannot revoke the newer active model URL',async()=>{
 let release,first=true;const gate=new Promise(r=>release=r),revoked=[];let urls=0;
 const client=api.createSceneFilesClient({baseUrl:'http://127.0.0.1:18083/api/v1/scene-files',getAccessToken:async()=>'good',createObjectURL:()=>`blob:${++urls}`,revokeObjectURL:u=>revoked.push(u),fetchImpl:async(url)=>{if(url.includes('/scene/')){if(first){first=false;await gate;}return json({fileId:'10000000-0000-4000-8000-000000000001'});}return new Response(new Blob(['x']));}});
 const old=client.resolveAsset('same');const current=await client.resolveAsset('same');release();assert.equal(current.ok,true);assert.equal((await old).code,'REQUEST_SUPERSEDED');assert.deepEqual(revoked,[]);client.dispose();assert.deepEqual(revoked,[current.url]);
});
test('committed replay with equal-size changed binary must fail before returning the old asset',async()=>{
 let commits=0,puts=0;const client=api.createSceneFilesClient({baseUrl:'http://127.0.0.1:18083/api/v1/scene-files',getAccessToken:async()=>'good',fetchImpl:async(url,opts)=>{
  if(opts.method==='PUT'){puts++;assert.equal(await opts.body.text(),'new');return new Response(JSON.stringify({error:{code:'UPLOAD_CONFLICT'}}),{status:409});}
  if(url.endsWith('/commit')){commits++;return json({id:'old-asset'});}
  return json({id:'10000000-0000-4000-8000-000000000001',state:'committed',result:{id:'old-asset'}});
 }});
 const result=await client.uploadBundle({requestId:'10000000-0000-4000-8000-000000000002',context:{kind:'model'},record:{displayName:'same'},files:[{role:'display',file:new Blob(['new'],{type:'model/gltf-binary'})}]});
 assert.equal(result.code,'UPLOAD_CONFLICT');assert.equal(puts,1);assert.equal(commits,0);
});
