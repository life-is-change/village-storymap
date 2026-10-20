import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {mkdtemp,rm,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {Readable} from 'node:stream';
import {createTaskChunkStore} from '../local-tasks/chunks.mjs';import {createBusinessFileStore} from '../unified/file-store.mjs';import {createFileBudget} from '../unified/budgets.mjs';
let api;try{api=await import('../local-tasks/files.mjs');}catch{api={};}
const bytes=Buffer.from('{"type":"FeatureCollection","features":[]}'),sha256=createHash('sha256').update(bytes).digest('hex');
test('file commit checks lease again after durable bytes; restart/replay adopts the same immutable blob',async()=>{
 assert.equal(typeof api.createLocalTaskFiles,'function');const root=await mkdtemp(join(tmpdir(),'worker-files-')),actor={},rid=randomUUID(),lease=randomUUID(),uploadId=randomUUID(),requestId=randomUUID();
 const spec={artifactType:'buildings',size:bytes.length,sha256,mime:'application/geo+json',extension:'geojson'};let state,fail=true,ready=0;
 const queue={instanceId:'aliyun-test',async fileCall(a,action,r,t,p){assert.equal(a,actor);assert.equal(r,rid);assert.equal(t,lease);
  if(action==='context')return {kind:'geo',phase:'geo'};
  if(action==='begin'){state={...p,uploadId,state:'pending',phase:'geo',kind:'geo',chunks:[]};return state;}
  if(action==='status'||action==='chunk-check')return structuredClone(state);
  if(action==='chunk'){state.chunks.push({index:p.index,size:p.size,sha256:p.sha256});return structuredClone(state);}
  if(action==='commit'){if(fail){fail=false;throw Object.assign(Error('lost lease'),{code:'LEASE_LOST'});}ready++;state.state='ready';return {...state};}
  throw Error('unexpected '+action);
 }};
 try{for(const dir of ['blobs','chunks'])await mkdir(join(root,dir),{mode:0o700});const store=await createBusinessFileStore({root:join(root,'blobs'),instanceId:'aliyun-test'}),chunks=await createTaskChunkStore({root:join(root,'chunks'),instanceId:'aliyun-test'}),budget=createFileBudget(),create=()=>api.createLocalTaskFiles({queue,store:budget.wrap(store),chunks,budget});
  const files=create();await files.begin(actor,rid,lease,{requestId,...spec});await files.put(actor,rid,lease,{uploadId,index:0,size:bytes.length,sha256},Readable.from([bytes]));
  await assert.rejects(files.commit(actor,rid,lease,{uploadId}),{code:'LEASE_LOST'});assert.equal(ready,0);
  const restarted=create();await restarted.commit(actor,rid,lease,{uploadId});assert.equal(ready,1);await restarted.commit(actor,rid,lease,{uploadId});assert.equal(ready,1);
  const opened=await store.open(state.fileId,{size:bytes.length,sha256});await opened.close();assert.deepEqual(budget.diagnostics(),{read:0,write:0});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('chunk writes share the ordinary global write budget and release it on failures',async()=>{
 const budget=createFileBudget({writes:1});assert.equal(typeof budget.withWrite,'function');let release;const gate=new Promise(r=>release=r),running=budget.withWrite(()=>gate);
 await assert.rejects(budget.withWrite(async()=>{}),{code:'FILE_BUSY'});release();await running;await assert.rejects(budget.withWrite(async()=>{throw Error('disk');}));assert.equal(budget.diagnostics().write,0);
});
