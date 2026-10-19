import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,writeFile,symlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {glbHeader,png} from './fixtures/scene-files.mjs';
let api,storeAPI;try{api=await import('../unified/files.mjs');storeAPI=await import('../unified/file-store.mjs');}catch{api={};storeAPI={};}
const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A'};
test('ordinary upload contracts fix file roles and never accept paths, owners or generic MIME',()=>{
 assert.equal(typeof api.parseBusinessUpload,'function');const p={requestId:randomUUID(),purpose:'photo',context:c,files:[{role:'photo',size:20,mime:'image/png',extension:'png'}]};
 assert.doesNotThrow(()=>api.parseBusinessUpload(p));for(const edit of [{path:'../../x'},{ownerId:randomUUID()},{files:[{...p.files[0],size:10*1024**2+1}]},{files:[{...p.files[0],mime:'application/octet-stream'}]}])assert.throws(()=>api.parseBusinessUpload({...p,...edit}));
 assert.throws(()=>api.parseBusinessUpload({...p,purpose:'group-model',files:[{role:'display',size:50*1024**2+1,mime:'model/gltf-binary',extension:'glb'}]}));
 assert.throws(()=>api.parseBusinessUpload({...p,purpose:'dataset',files:[{role:'../manifest.json',size:1,mime:'application/json',extension:'json'}]}));
});
test('immutable file store rejects partial bytes, external GLB URIs, links and cross-instance reuse',async()=>{
 assert.equal(typeof storeAPI.createBusinessFileStore,'function');const root=await mkdtemp(join(tmpdir(),'village-business-files-'));
 try{const store=await storeAPI.createBusinessFileStore({root,instanceId:'aliyun-test'}),fileId=randomUUID(),bytes=png;
  const input={fileId,role:'photo',size:bytes.length,mime:'image/png',extension:'png',stream:Readable.from([bytes])};const rec=await store.stage(input);await store.persist(fileId);const opened=await store.open(fileId,rec);assert.equal(opened.size,bytes.length);const range=[];for await(const chunk of opened.stream({start:1,end:4}))range.push(chunk);assert.deepEqual(Buffer.concat(range),bytes.subarray(1,5));await opened.close();
  await assert.rejects(store.stage({...input,stream:Readable.from([bytes])}),{code:'UPLOAD_CONFLICT'});
  await assert.rejects(storeAPI.createBusinessFileStore({root,instanceId:'other-instance'}));
  await assert.rejects(store.stage({...input,fileId:randomUUID(),stream:Readable.from([bytes.subarray(0,8)])}),{code:'INVALID_FILE'});
  const evil=glbHeader(0,{images:[{uri:'https://evil.invalid/a.png'}]});await assert.rejects(store.stage({fileId:randomUUID(),role:'display',size:evil.length,mime:'model/gltf-binary',extension:'glb',stream:Readable.from([evil])}),{code:'INVALID_FILE'});
  if(process.platform!=='win32'){const linked=randomUUID();await symlink(join(root,'blobs',fileId),join(root,'blobs',linked));await assert.rejects(store.open(linked,rec));}
  const handles=await Promise.all(Array.from({length:4},()=>store.open(fileId,rec)));await assert.rejects(store.open(fileId,rec),{code:'FILE_BUSY'});await Promise.all(handles.map(h=>h.close()));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a photo registration cannot carry a client-supplied uploader or storage URL',()=>{
 assert.equal(typeof api.parseBusinessCommit,'function');assert.doesNotThrow(()=>api.parseBusinessCommit('photo',{objectCode:'B1',objectType:'building'}));
 for(const record of [{objectCode:'B1',objectType:'building',photoUrl:'http://x'},{objectCode:'B1',objectType:'building',uploaderName:'admin'}])assert.throws(()=>api.parseBusinessCommit('photo',record));
});
test('large GeoJSON is streamed with real feature counts, geometry types and WGS84 bounds',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unified-geojson-'));
 try{const store=await storeAPI.createBusinessFileStore({root,instanceId:'json-test'}),geometry={type:'Polygon',coordinates:[[[113,23],[114,23],[114,24],[113,23]]]};
  const stage=value=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));return store.stage({fileId:randomUUID(),role:'buildings.geojson',mime:'application/geo+json',extension:'geojson',size:bytes.length,stream:Readable.from([bytes])});};
  const fc={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Village'},geometry}]};
  assert.equal((await stage(fc)).validation.featureCount,1);
  for(const value of [{type:'FeatureCollection',features:[{}]},{...fc,features:[{...fc.features[0],geometry:{type:'Point',coordinates:[113,23]}}]},{...fc,features:[{...fc.features[0],geometry:{...geometry,coordinates:[[[181,23],[114,23],[114,24],[181,23]]]}}]},'{"type":"FeatureCollection",\u00a0"features":[]}'])await assert.rejects(stage(value),{code:'INVALID_FILE'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('two uploads share a bounded budget and a full 50 MiB GLB streams without buffering the body',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unified-large-'));
 try{const store=await storeAPI.createBusinessFileStore({root,instanceId:'large-test'});let release,entered=0;const gate=new Promise(r=>release=r),small=glbHeader();
  async function* slow(){entered++;await gate;yield small;}
  const descriptor={role:'display',size:small.length,mime:'model/gltf-binary',extension:'glb'};
  const a=store.stage({...descriptor,fileId:randomUUID(),stream:Readable.from(slow())}),b=store.stage({...descriptor,fileId:randomUUID(),stream:Readable.from(slow())});
  while(entered<2)await new Promise(r=>setTimeout(r,2));await assert.rejects(store.stage({...descriptor,fileId:randomUUID(),stream:Readable.from([small])}),{code:'FILE_BUSY'});release();await Promise.all([a,b]);
  const size=50*1024**2;let binSize=size-glbHeader(4).length;binSize-=binSize%4;let header=glbHeader(binSize);binSize=size-header.length;header=glbHeader(binSize);
  async function* large(){yield header;for(let n=0;n<binSize;){const count=Math.min(65536,binSize-n);yield Buffer.alloc(count);n+=count;}}
  const id=randomUUID(),record=await store.stage({...descriptor,fileId:id,size,stream:Readable.from(large())});assert.equal(record.size,size);await store.persist(id);const h=await store.open(id,record);await h.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
