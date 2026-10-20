import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';let api;try{api=await import('../unified/task-files.mjs');}catch{api={};}
test('verified GeoJSON is consumed one bounded feature at a time across arbitrary UTF8 chunk boundaries',async()=>{
 assert.equal(typeof api.geoJSONFeatures,'function');const features=[{type:'Feature',id:'a',properties:{name:'村庄 \\" [ ] features'},geometry:{type:'Point',coordinates:[113,23]}},{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[113,23],[114,24]]}}],text=JSON.stringify({type:'FeatureCollection',properties:{fake:'features: ['},features});
 const bytes=Buffer.from(text),chunks=[];for(let i=0;i<bytes.length;i+=7)chunks.push(bytes.subarray(i,i+7));const found=[];for await(const f of api.geoJSONFeatures(Readable.from(chunks)))found.push(f);assert.deepEqual(found,features);
 const oversized=JSON.stringify({features:[{type:'Feature',properties:{name:'x'.repeat(2*1024**2)},geometry:{type:'Point',coordinates:[113,23]}}]});await assert.rejects(async()=>{for await(const _f of api.geoJSONFeatures(Readable.from([oversized]))){};},{code:'INVALID_FILE'});
});
test('task photo access is scoped by owner, request and instance and releases the reader on invalid MIME',async()=>{
 assert.equal(typeof api.createTaskFiles,'function');let closed=0,args;
 const database={async withMaintenance(fn){return fn({async query(sql,values){assert.match(sql,/task_photo_file/);args=values;return {rows:[{data:{legacy:true,name:'private.webp'}}]};}});}};
 const files=api.createTaskFiles({database,store:{},instanceId:'aliyun-test',legacyReader:{async open(){return {size:20,sha256:'a'.repeat(64),async close(){closed++;}};}}});
 await assert.rejects(files.readTaskInput({requestId:'request',ownerId:'owner'}),{code:'FILE_TYPE_UNSUPPORTED'});assert.deepEqual(args,['request','owner','aliyun-test']);assert.equal(closed,1);
});
