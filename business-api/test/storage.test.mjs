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
