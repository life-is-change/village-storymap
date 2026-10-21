import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,rm,symlink,link} from 'node:fs/promises';
import {fixture} from './fixtures/storage.mjs';
import {join} from 'node:path';
const m=await import('../src/storage.mjs').catch(()=>({}));
test('verified same-handle bytes are readable including empty blobs',async()=>{
 assert.equal(typeof m.createStorageReader,'function','storage reader missing');
 for(const bytes of [Buffer.alloc(0),Buffer.alloc(2*1024*1024+17,73)]){
  const f=await fixture(bytes);try{
   const reader=await m.createStorageReader(f);const file=await reader.open(f.object);
   assert.equal(file.size,bytes.length);assert.equal(file.sha256,f.object.sha256);
   const chunks=[];for await(const b of file.stream({start:0,end:bytes.length-1}))chunks.push(b);
   assert.deepEqual(Buffer.concat(chunks),bytes);await file.close();
  }finally{await f.cleanup();}
 }
});
test('invalid index or database identity never selects another local path',async()=>{
 assert.equal(typeof m.createStorageReader,'function');const f=await fixture();try{
  for(const patch of [{bucket:'facade-generation'},{name:'../escape'},{sha256:'../x'},{size:-1},{size:52428801}]){
   await writeFile(f.indexPath,JSON.stringify({...f.index,objects:[{...f.object,...patch}]}));
   await assert.rejects(()=>m.createStorageReader(f));
  }
  await writeFile(f.indexPath,JSON.stringify(f.index));const reader=await m.createStorageReader(f);
  await assert.rejects(()=>reader.open({...f.object,name:'another.glb'}),{code:'FILE_UNAVAILABLE'});
  await assert.rejects(()=>reader.open({...f.object,id:'b0000000-0000-4000-8000-000000000001'}),{code:'FILE_UNAVAILABLE'});
  for(const patch of [{declared_size:f.bytes.length+1},{snapshot_updated_at:'2026-10-16T00:00:00.000001Z'},{snapshot_etag:'changed'},{snapshot_version:'v2'}]){
   await assert.rejects(()=>reader.open({...f.object,...patch}),{code:'FILE_UNAVAILABLE'});
  }
 }finally{await f.cleanup();}
});
test('changed bytes are rejected before a response can be sent',async()=>{
 assert.equal(typeof m.createStorageReader,'function');const f=await fixture();try{
  const reader=await m.createStorageReader(f);await writeFile(f.blob,Buffer.alloc(f.bytes.length,66));
  await assert.rejects(()=>reader.open(f.object),{code:'FILE_UNAVAILABLE'});
 }finally{await f.cleanup();}
});
test('linked blobs cannot escape the private storage mount',async t=>{
 assert.equal(typeof m.createStorageReader,'function');const f=await fixture();try{
  const reader=await m.createStorageReader(f);await rm(f.blob);await writeFile(join(f.dir,'other'),f.bytes);
  await link(join(f.dir,'other'),f.blob);await assert.rejects(()=>reader.open(f.object));await rm(f.blob);
  try{await symlink(join(f.dir,'other'),f.blob);}catch(e){if(e.code==='EPERM'){t.diagnostic('Native symlink creation unavailable on this host; hard-link rejection tested');return;}throw e;}
  await assert.rejects(()=>reader.open(f.object));
 }finally{await f.cleanup();}
});
test('bounded active readers release slots when closed',async()=>{
 const f=await fixture();const files=[];try{
  const reader=await m.createStorageReader(f);
  for(let i=0;i<4;i++)files.push(await reader.open(f.object));
  await assert.rejects(()=>reader.open(f.object),{code:'FILE_BUSY'});
  await files.pop().close();const next=await reader.open(f.object);await next.close();
 }finally{await Promise.all(files.map(f=>f.close()));await f.cleanup();}
});

test('explicit autonomous inventory retains both historical GPU buckets without changing ordinary scope',async()=>{
 const f=await fixture();try{
  for(const bucket of ['geoprocessing-results','facade-generation']){
   const object={...f.object,bucket};await writeFile(f.indexPath,JSON.stringify({...f.index,objects:[object]}));
   await assert.rejects(m.createStorageReader(f));
   const reader=await m.createStorageReader({...f,scope:'autonomous'});const opened=await reader.open(object);
   const chunks=[];for await(const part of opened.stream({start:0,end:f.bytes.length-1}))chunks.push(part);
   assert.deepEqual(Buffer.concat(chunks),f.bytes);await opened.close();
  }
  const geo={...f.object,bucket:'geoprocessing-results',size:51*1024**2,declared_size:51*1024**2};
  await writeFile(f.indexPath,JSON.stringify({...f.index,objects:[geo]}));await m.createStorageReader({...f,scope:'autonomous'});
  await writeFile(f.indexPath,JSON.stringify({...f.index,objects:[{...geo,size:512*1024**2+1}]}));await assert.rejects(m.createStorageReader({...f,scope:'autonomous'}));
 }finally{await f.cleanup();}
});
