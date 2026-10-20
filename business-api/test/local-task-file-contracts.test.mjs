import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createBusinessFileStore} from '../unified/file-store.mjs';import {parseBusinessUpload,businessFileLimit} from '../unified/file-contracts.mjs';
let api;try{api=await import('../local-tasks/file-contracts.mjs');}catch{api={};}
test('trusted task results have per-kind limits while public upload contracts stay bounded',()=>{
 assert.equal(typeof api.taskFileSpec,'function');
 const sha256='a'.repeat(64),base={artifactType:'buildings',size:51*1024**2,sha256,mime:'application/geo+json',extension:'geojson'};
 assert.equal(api.taskFileSpec('geo','geo',base).role,'task:buildings.geojson');
 assert.equal(businessFileLimit(api.taskFileSpec('geo','geo',base)),512*1024**2);
 for(const spec of [{...base,size:512*1024**2+1},{...base,artifactType:'boundary'},{...base,mime:'text/html'},{...base,url:'https://arbitrary.test'}])assert.throws(()=>api.taskFileSpec('geo','geo',spec));
 assert.throws(()=>api.taskFileSpec('facade','generation',{...base,artifactType:'building_glb',mime:'model/gltf-binary',extension:'glb'}),{code:'FILE_TOO_LARGE'});
 assert.throws(()=>api.taskFileSpec('facade','rectification',{...base,artifactType:'rectified_source',mime:'image/png',extension:'png'}),{code:'FILE_TOO_LARGE'});
 assert.throws(()=>parseBusinessUpload({requestId:randomUUID(),purpose:'photo',context:{courseId:'test',groupId:null,scopeKind:'personal'},files:[api.taskFileSpec('geo','geo',base)]}));
});
test('a supported GeoJSON result above 50 MiB streams through validation, persist and ranged reads',async()=>{
 assert.equal(typeof api.taskFileSpec,'function');const root=await mkdtemp(join(tmpdir(),'task-large-')),fileId=randomUUID();
 const head=Buffer.from('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"properties":{}}]}');
 const padding=Buffer.alloc(65536,32),size=51*1024**2+head.length,hash=createHash('sha256').update(head);for(let n=0;n<51*16;n++)hash.update(padding);const sha256=hash.digest('hex');
 try{const store=await createBusinessFileStore({root,instanceId:'aliyun-test'}),spec=api.taskFileSpec('geo','geo',{artifactType:'buildings',size,sha256,mime:'application/geo+json',extension:'geojson'});
  async function* bytes(){yield head;for(let n=0;n<51*16;n++)yield padding;}
  const staged=await store.stage({...spec,fileId,stream:bytes()});assert.equal(staged.sha256,sha256);assert.equal(staged.validation.featureCount,1);await store.persist(fileId);
  const opened=await store.open(fileId,{size,sha256});try{const chunks=[];for await(const chunk of opened.stream({start:0,end:head.length-1}))chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),head);}finally{await opened.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
