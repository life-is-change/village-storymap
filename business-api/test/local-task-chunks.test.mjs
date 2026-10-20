import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {Readable} from 'node:stream';
let api;try{api=await import('../local-tasks/chunks.mjs');}catch{api={};}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('private chunks survive restart, replay without overwrite and stream a verified ordered file',async()=>{
 assert.equal(typeof api.createTaskChunkStore,'function');const root=await mkdtemp(join(tmpdir(),'local-task-chunks-')),id=randomUUID(),a=Buffer.from('first'),b=Buffer.from('second');
 try{
  const store=await api.createTaskChunkStore({root,instanceId:'aliyun-test'});
  assert.equal((await store.put(id,0,a.length,hash(a),Readable.from([a]))).replayed,false);
  assert.equal((await store.put(id,0,a.length,hash(a),(async function*(){throw Error('must not overwrite accepted bytes');})())).replayed,true);
  await assert.rejects(store.put(id,0,b.length,hash(b),Readable.from([b])),{code:'UPLOAD_CONFLICT'});
  const restarted=await api.createTaskChunkStore({root,instanceId:'aliyun-test'});await restarted.put(id,1,b.length,hash(b),Readable.from([b]));
  const parts=[];for await(const bytes of restarted.stream(id,[{index:0,size:a.length,sha256:hash(a)},{index:1,size:b.length,sha256:hash(b)}]))parts.push(bytes);
  assert.equal(Buffer.concat(parts).toString(),'firstsecond');
  await restarted.remove(id);assert.ok(!(await readdir(root)).includes(id));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('new chunks stop before exhausting disk and cannot reuse another installation root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-task-space-')),id=randomUUID(),bytes=Buffer.from('x');
 try{const store=await api.createTaskChunkStore({root,instanceId:'aliyun-test',spaceAvailable:async()=>1024});
  await assert.rejects(store.put(id,0,1,hash(bytes),Readable.from([bytes])),{code:'QUOTA_EXCEEDED'});
  await assert.rejects(api.createTaskChunkStore({root,instanceId:'aliyun-other'}),{code:'FILE_UNAVAILABLE'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('interrupted and wrong-digest chunks never publish and can be retried without touching a completed chunk',async()=>{
 assert.equal(typeof api.createTaskChunkStore,'function');const root=await mkdtemp(join(tmpdir(),'local-task-chunks-')),id=randomUUID(),bytes=Buffer.from('complete');
 try{
  const store=await api.createTaskChunkStore({root,instanceId:'aliyun-test'});
  await assert.rejects(store.put(id,0,bytes.length,hash(bytes),(async function*(){yield bytes.subarray(0,2);throw Error('connection interrupted');})()));
  await assert.rejects(store.put(id,0,bytes.length,'a'.repeat(64),Readable.from([bytes])),{code:'INVALID_FILE'});
  await store.put(id,0,bytes.length,hash(bytes),Readable.from([bytes]));
  for(const bad of [{id:'../other',index:0,size:1},{id,index:-1,size:1},{id,index:64,size:1},{id,index:0,size:8*1024**2+1}])await assert.rejects(store.put(bad.id,bad.index,bad.size,hash(bytes),Readable.from([bytes])),{code:'INVALID_INPUT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
