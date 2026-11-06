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
test('a rejected photo upload does not reuse its terminal failed session on retry',async()=>{
 const storage=receiptStorage(),begins=[],puts=[];let next=0,fail=true;
 const client=api.createBusinessFilesClient({storage,origin:'https://local.example',getAccessToken:async()=> 'token',getIdentityKey:()=> 'owner',uuid:()=> 'rid-'+ ++next,createObjectURL:()=> 'blob:photo',fetchImpl:async(url,o)=>{
  if(url.endsWith('/sessions')){const request=JSON.parse(o.body);begins.push(request.requestId);return Response.json({data:{id:request.requestId}});}
  if(o.method==='PUT'){puts.push(url);if(fail){fail=false;return Response.json({error:{code:'INVALID_FILE'}},{status:422});}return Response.json({data:{}});}
  if(url.endsWith('/commit'))return Response.json({data:{fileId:'10000000-0000-4000-8000-000000000001',photo_path:'ordinary/photo'}});
  if(url.includes('/sessions/'))return Response.json({data:{id:'rid-1',state:'pending',files:[{state:'failed'}]}});
  return new Response('photo');
 }});
 const target={objectCode:'B1'},file=new File(['png'],'input.png');
 await assert.rejects(client.uploadPhoto(target,file),{code:'INVALID_FILE'});
 assert.equal((await client.uploadPhoto(target,file)).photoUrl,'blob:photo');
 assert.deepEqual(begins,['rid-1','rid-2']);assert.ok(puts[1].includes('/rid-2/'));
});

test('photo content signatures select PNG JPEG and WebP even when filenames disagree',async()=>{
 const {png}=await import('../../business-api/test/fixtures/scene-files.mjs');
 const {validateFile}=await import('../../business-api/scene-files/formats.mjs');
 const jpeg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
 const webp=Buffer.alloc(26);webp.write('RIFF');webp.writeUInt32LE(18,4);webp.write('WEBP',8);webp.write('VP8L',12);webp.writeUInt32LE(5,16);webp[20]=0x2f;
 for(const [bytes,name,extension,mime] of [[png,'renamed.jpg','png','image/png'],[jpeg,'renamed.png','jpg','image/jpeg'],[jpeg,'photo.jpeg','jpeg','image/jpeg'],[webp,'photo','webp','image/webp']]){
  let descriptor;
  const client=api.createBusinessFilesClient({storage:receiptStorage(),origin:'https://local.example',getAccessToken:async()=> 'token',getIdentityKey:()=> 'owner',uuid:()=> 'rid',createObjectURL:()=> 'blob:photo',fetchImpl:async(url,o)=>{
   if(url.endsWith('/sessions')){descriptor=JSON.parse(o.body).files[0];return Response.json({data:{id:'session'}});}
   if(o.method==='PUT'){
    const content=Buffer.from(await o.body.arrayBuffer());
    await validateFile({...descriptor,handle:{async read(b,off,len,pos){const n=content.copy(b,off,pos,pos+len);return {bytesRead:n};}}});
    return Response.json({data:{}});
   }
   if(url.endsWith('/commit'))return Response.json({data:{fileId:'10000000-0000-4000-8000-000000000001'}});
   return new Response('photo');
  }});
  await client.uploadPhoto({objectCode:'B1'},new File([bytes],name));assert.equal(descriptor.extension,extension);assert.equal(descriptor.mime,mime);
 }
});

test('an old receipt whose session contains a failed file is replaced before PUT',async()=>{
 const storage=receiptStorage();let next=0,attempt=0;const starts=[];
 const options={storage,origin:'https://local.example',getAccessToken:async()=> 'token',getIdentityKey:()=> 'owner',uuid:()=> 'rid-'+ ++next,createObjectURL:()=> 'blob:photo',fetchImpl:async(url,o)=>{
  if(url.endsWith('/sessions')){const id=JSON.parse(o.body).requestId;starts.push(id);return Response.json({data:{id}});}
  if(o.method==='PUT'){if(attempt++===0)throw TypeError('lost response');assert.ok(url.includes('/rid-2/'));return Response.json({data:{}});}
  if(url.endsWith('/commit'))return Response.json({data:{fileId:'10000000-0000-4000-8000-000000000001'}});
  if(url.includes('/sessions/'))return Response.json({data:{id:'rid-1',state:'pending',files:[{state:'failed'}]}});
  return new Response('photo');
 }};
 const target={objectCode:'B1'},file=new File(['png'],'input.png');
 await assert.rejects(api.createBusinessFilesClient(options).uploadPhoto(target,file));
 await api.createBusinessFilesClient(options).uploadPhoto(target,file);assert.deepEqual(starts,['rid-1','rid-2']);
});
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
