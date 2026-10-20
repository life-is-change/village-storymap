const test=require('node:test'),assert=require('node:assert/strict');let api;try{api=require('./business-files-client.js');}catch{api={};}
test('file URLs are private authenticated blobs isolated by current identity context',async()=>{
 assert.equal(typeof api.createBusinessFilesClient,'function');let key='user1:A';const calls=[],revoked=[];
 const client=api.createBusinessFilesClient({origin:'https://local.example',getAccessToken:async()=> 'token',getIdentityKey:()=>key,createObjectURL:()=> 'blob:'+calls.length,revokeObjectURL:u=>revoked.push(u),fetchImpl:async(url,o)=>{calls.push([url,o]);return {ok:true,blob:async()=>new Blob(['private']),json:async()=>({data:{fileId:'10000000-0000-4000-8000-000000000001'}})};}});
 await client.resolvePathUrl('group-models','ordinary/x/display.glb');assert.equal(calls[1][1].headers.Authorization,'Bearer token');assert.equal(calls[1][1].credentials,'omit');assert.equal(calls[1][1].cache,'no-store');assert.equal(calls[1][1].redirect,'error');
 key='user2:A';await client.resolveFileUrl('10000000-0000-4000-8000-000000000001');assert.equal(revoked.length,1);client.clear();assert.equal(revoked.length,2);
});
test('photo upload sends bytes to the allocated slot and commits only fixed object metadata',async()=>{
 assert.equal(typeof api.createBusinessFilesClient,'function');const requests=[];
 const client=api.createBusinessFilesClient({origin:'http://127.0.0.1:18085',getAccessToken:async()=> 'token',getIdentityKey:()=> 'user:context',uuid:()=> 'request',createObjectURL:()=> 'blob:photo',revokeObjectURL:()=>{},fetchImpl:async(url,o)=>{requests.push([url,o]);return {ok:true,json:async()=>({data:url.endsWith('/sessions')?{id:'session',files:[{role:'photo',id:'file'}]}:{id:1,fileId:'10000000-0000-4000-8000-000000000001',photo_path:'ordinary/photo'}}),blob:async()=>new Blob(['image'])};}});
 const result=await client.uploadPhoto({teachingProjectId:'p',villageId:'v',spaceId:'s',objectCode:'B1',objectType:'building'},new File(['png'],'input.png',{type:'image/png'}));
 assert.equal(requests[1][1].method,'PUT');assert.equal(requests[1][1].body.size,3);assert.deepEqual(JSON.parse(requests[2][1].body),{objectCode:'B1',objectType:'building'});assert.equal(result.photoUrl,'blob:photo');client.clear();
});
test('reusing a private model reauthorizes with HEAD and avoids downloading identical bytes again',async()=>{
 const methods=[],revoked=[],id='10000000-0000-4000-8000-000000000001',hash='"'+'a'.repeat(64)+'"';let denied=false;
 const client=api.createBusinessFilesClient({origin:'https://local.example',getAccessToken:async()=> 'token',getIdentityKey:()=> 'user:space',createObjectURL:()=> 'blob:one',revokeObjectURL:u=>revoked.push(u),fetchImpl:async(_url,o)=>{methods.push(o.method);return denied?Response.json({error:{code:'FORBIDDEN'}},{status:403}):new Response(o.method==='HEAD'?null:'model',{headers:{ETag:hash}});}});
 assert.equal(await client.resolveFileUrl(id),'blob:one');assert.equal(await client.resolveFileUrl(id),'blob:one');assert.deepEqual(methods,['GET','HEAD']);assert.equal(revoked.length,0);
 denied=true;await assert.rejects(client.resolveFileUrl(id),{code:'FORBIDDEN'});client.clear();
});
