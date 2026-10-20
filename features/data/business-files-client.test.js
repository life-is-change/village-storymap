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

const receiptStorage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
test('lost upload commit survives client recreation and does not PUT or commit twice',async()=>{
 const storage=receiptStorage(),requests=[],id='10000000-0000-4000-8000-000000000001';let committed=false,uuidCount=0;
 const options={storage,origin:'https://local.example',getAccessToken:async()=> 'token',getIdentityKey:()=> 'instance:user:project:space',uuid:()=> 'upload-'+ ++uuidCount,createObjectURL:()=> 'blob:ok',fetchImpl:async(url,o)=>{
  requests.push([url,o]);if(url.endsWith('/sessions'))return Response.json({data:{id:'session',state:'pending'}});
  if(url.endsWith('/sessions/session')&&o.method==='GET')return Response.json({data:{id:'session',state:'committed',result:{fileId:id,photo_path:'ordinary/photo'}}});
  if(url.endsWith('/commit')){committed=true;throw new TypeError('lost commit response');}
  return o.method==='PUT'?Response.json({data:{}}):new Response('photo');
 }};
 const target={teachingProjectId:'p',villageId:'v',spaceId:'s',objectCode:'B1',objectType:'building'},file=new File(['png'],'input.png');
 await assert.rejects(api.createBusinessFilesClient(options).uploadPhoto(target,file));assert.equal(committed,true);
 const result=await api.createBusinessFilesClient(options).uploadPhoto(target,new File(['png'],'input.png'));
 assert.equal(result.photoUrl,'blob:ok');assert.equal(uuidCount,1);assert.equal(requests.filter(([u])=>u.endsWith('/commit')).length,1);assert.equal(requests.filter(([,o])=>o.method==='PUT').length,1);
});
test('a committed photo with a failed URL read is reconciled on retry',async()=>{
 const storage=receiptStorage();let reads=0,commits=0;const id='10000000-0000-4000-8000-000000000001',result={fileId:id,photo_path:'ordinary/photo'};
 const options={storage,origin:'https://local.example',getAccessToken:async()=> 'token',getIdentityKey:()=> 'owner',uuid:()=> 'rid',createObjectURL:()=> 'blob:ok',fetchImpl:async(url,o)=>{
  if(url.endsWith('/sessions'))return Response.json({data:{id:'session'}});if(url.endsWith('/sessions/session'))return Response.json({data:{state:'committed',result}});
  if(url.endsWith('/commit')){commits++;return Response.json({data:result});}if(o.method==='PUT')return Response.json({data:{}});
  if(reads++===0)throw TypeError('lost download');return new Response('photo');
 }};
 const client=api.createBusinessFilesClient(options),target={objectCode:'B1'},file=new File(['x'],'a.png');await assert.rejects(client.uploadPhoto(target,file));await client.uploadPhoto(target,file);assert.equal(commits,1);
});
