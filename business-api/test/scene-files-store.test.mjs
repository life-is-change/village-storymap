import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,link,symlink,stat,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {assetInput,glb,glbHeader,png} from './fixtures/scene-files.mjs';
const mod=await import('../scene-files/file-store.mjs').catch(()=>({}));
const contract=await import('../scene-files/contracts.mjs').catch(()=>({}));
async function sandbox(fn){const root=await mkdtemp(join(tmpdir(),'village-files-test-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
const props=(fileId,bytes)=>({fileId,role:'display',size:bytes.length,mime:'model/gltf-binary',extension:'glb',stream:Readable.from([bytes])});
test('upload manifest rejects duplicate roles, unsupported svg and unsafe context',()=>{
 assert.equal(typeof contract.parseUploadRequest,'function');assert.equal(contract.parseUploadRequest(assetInput()).purpose,'asset');
 for(const change of [i=>i.files.push(i.files[0]),i=>i.files[0].size=50*1024*1024+1,i=>i.context.ownerId=randomUUID(),i=>i.files[0].extension='../glb',i=>i.files[0].role='preview']){
  const i=assetInput();change(i);assert.throws(()=>contract.parseUploadRequest(i));
 }
 const i=assetInput([{role:'display',size:20,mime:'image/svg+xml',extension:'svg'}]);i.context.kind='symbol';assert.throws(()=>contract.parseUploadRequest(i),{code:'FILE_TYPE_UNSUPPORTED'});
});
test('formats reject mismatch external URI, malformed chunks and truncated data',async()=>sandbox(async root=>{
 assert.equal(typeof mod.createFileStore,'function');const s=await mod.createFileStore({root});
 for(const raw of [Buffer.from('not glb'),glbHeader(0,{images:[{uri:'https://evil.invalid/a.png'}]}),glbHeader(0,{buffers:[{uri:'../private.bin',byteLength:1}]}),glb().subarray(0,23)])await assert.rejects(()=>s.stage(props(randomUUID(),raw)),{code:'INVALID_FILE'});
 const id=randomUUID(),record=await s.stage(props(id,glb()));await s.persist(id);const opened=await s.open(id,record);await opened.close();
 const imageId=randomUUID();const image=await s.stage({fileId:imageId,role:'top',size:png.length,mime:'image/png',extension:'png',stream:Readable.from([png])});assert.equal(image.size,png.length);
}));
test('bounded stream accepts 50 MiB and rejects an extra byte without publishing',async()=>sandbox(async root=>{
 assert.equal(typeof mod.createFileStore,'function');const s=await mod.createFileStore({root});const size=50*1024*1024;let binSize=size-glbHeader(4).length;binSize-=binSize%4;let header=glbHeader(binSize);binSize=size-header.length;header=glbHeader(binSize);
 async function* bytes(extra=0){yield header;for(let n=0;n<binSize;){const count=Math.min(65536,binSize-n);yield Buffer.alloc(count);n+=count;}if(extra)yield Buffer.alloc(extra);}
 const id=randomUUID(),rec=await s.stage({fileId:id,role:'display',size,mime:'model/gltf-binary',extension:'glb',stream:Readable.from(bytes())});assert.equal(rec.size,size);await s.persist(id);
 const opened=await s.open(id,rec);assert.equal(opened.size,size);await opened.close();
 const bad=randomUUID();await assert.rejects(()=>s.stage({fileId:bad,role:'display',size,mime:'model/gltf-binary',extension:'glb',stream:Readable.from(bytes(1))}),{code:'FILE_TOO_LARGE'});await assert.rejects(()=>s.open(bad,rec));
 console.log('bounded stream rss MiB',Math.round(process.memoryUsage().rss/1024/1024));
}));
test('third concurrent upload is busy, aborted upload releases slot and is not readable',async()=>sandbox(async root=>{
 assert.equal(typeof mod.createFileStore,'function');const s=await mod.createFileStore({root});let release;const gate=new Promise(r=>release=r);let entered=0;
 async function* slow(){entered++;await gate;yield glb();}
 const one=s.stage({...props(randomUUID(),glb()),stream:Readable.from(slow())});const two=s.stage({...props(randomUUID(),glb()),stream:Readable.from(slow())});
 while(entered<2)await new Promise(r=>setTimeout(r,5));await assert.rejects(()=>s.stage(props(randomUUID(),glb())),{code:'FILE_BUSY'});release();await Promise.all([one,two]);
 const id=randomUUID();async function* aborted(){yield glb().subarray(0,10);throw Error('disconnect');}await assert.rejects(()=>s.stage({...props(id,glb()),stream:Readable.from(aborted())}));await assert.rejects(()=>s.open(id,{}));await s.stage(props(randomUUID(),glb()));
}));
test('file keys, hard links and symlinks cannot redirect or alias private files',async()=>sandbox(async root=>{
 assert.equal(typeof mod.createFileStore,'function');const s=await mod.createFileStore({root});await assert.rejects(()=>s.stage(props('../outside',glb())));
 const id=randomUUID(),rec=await s.stage(props(id,glb()));await s.persist(id);await link(join(root,'blobs',id),join(root,'alias'));await assert.rejects(()=>s.open(id,rec));
 await rm(join(root,'alias'));const opened=await s.open(id,rec);await opened.close();await assert.rejects(()=>s.stage(props(id,glb())));assert.equal((await stat(join(root,'blobs',id))).nlink,1);
 if(process.platform!=='win32'){const other=await mkdtemp(join(tmpdir(),'village-files-link-'));try{await symlink(other,join(root,'linked'));await assert.rejects(()=>mod.createFileStore({root:join(root,'linked')}));}finally{await rm(other,{recursive:true,force:true});}}
 await s.discard(id);await access(join(root,'blobs',id));
}));
test('image containers require valid CRC, dimensions, terminal markers and RIFF sizes',async()=>sandbox(async root=>{
 const s=await mod.createFileStore({root});const jpeg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
 const webp=Buffer.alloc(26);webp.write('RIFF');webp.writeUInt32LE(18,4);webp.write('WEBP',8);webp.write('VP8L',12);webp.writeUInt32LE(5,16);webp[20]=0x2f;
 for(const [extension,mime,raw]of [['jpg','image/jpeg',jpeg],['webp','image/webp',webp]]){
  await s.stage({fileId:randomUUID(),role:'display',size:raw.length,mime,extension,stream:Readable.from([raw])});
  const bad=raw.subarray(0,raw.length-1);await assert.rejects(()=>s.stage({fileId:randomUUID(),role:'display',size:bad.length,mime,extension,stream:Readable.from([bad])}),{code:'INVALID_FILE'});
 }
 const bad=Buffer.from(png);bad[52]^=1;await assert.rejects(()=>s.stage({fileId:randomUUID(),role:'top',size:bad.length,mime:'image/png',extension:'png',stream:Readable.from([bad])}),{code:'INVALID_FILE'});
 const huge=glbHeader(0,{extras:'x'.repeat(2*1024*1024)});await assert.rejects(()=>s.stage(props(randomUUID(),huge)),{code:'INVALID_FILE'});
 const malformed=glb();malformed.writeUInt32LE(1000,12);await assert.rejects(()=>s.stage(props(randomUUID(),malformed)),{code:'INVALID_FILE'});
}));
