import {randomUUID,createHash} from 'node:crypto';import {statfs} from 'node:fs/promises';import {createRequire} from 'node:module';
import {parseBusinessUpload,parseBusinessCommit,DATASET_NAMES} from './file-contracts.mjs';import {requestDigest} from '../scene-files/uploads.mjs';import {uuid,fault} from '../scene-files/contracts.mjs';import {fileType} from '../src/storage.mjs';
const require=createRequire(import.meta.url),packages=require('../../features/admin/village-package.js');
export {parseBusinessUpload,parseBusinessCommit};
export function createBusinessFilesService({database,store,legacyReader,spaceAvailable,now=Date.now}){
 let readers=0;const tx=(identity,fn)=>database.withIdentity(identity,fn),one=async(c,sql,args)=>(await c.query(sql,args)).rows[0]?.data;
 const lock=(c,id)=>one(c,'SELECT api_private.file_session($1) AS data',[id]);
 const available=spaceAvailable??(async()=>{const s=await statfs(store.root);return Number(s.bavail)*Number(s.bsize);});
 async function checkFiles(s){for(const f of s.files){const opened=await store.open(f.id,{size:Number(f.size),sha256:f.sha256});await opened.close();}}
 async function packageRecord(s,record){
  const files=new Map(s.files.map(f=>[f.role,f]));async function document(role){const f=files.get(role),h=await store.open(f.id,{size:Number(f.size),sha256:f.sha256});try{const chunks=[];for await(const b of h.stream())chunks.push(b);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}finally{await h.close();}}
  const manifest=packages.validateManifest(await document('manifest.json'));const validation=await document('validation.json');
  if(validation.valid!==true||manifest.files.length!==8||new Set(manifest.files.map(d=>d.path)).size!==8||manifest.layers.length!==4||manifest.imagery?.path!=='imagery.webp')throw fault('INVALID_FILE');
  for(const d of manifest.files){if(!DATASET_NAMES.includes(d.path)||['manifest.json','validation.json'].includes(d.path)||files.get(d.path)?.sha256!==String(d.sha256).toLowerCase())throw fault('INVALID_FILE');}
  const expected={building:'buildings.geojson',road:'roads.geojson',water:'water.geojson',contours:'contours.geojson'};
  if(new Set(manifest.layers.map(d=>d.type)).size!==4)throw fault('INVALID_FILE');
  for(const d of manifest.layers)if(expected[d.type]!==d.path||!Number.isSafeInteger(d.featureCount)||d.featureCount<0||d.featureCount!==files.get(d.path)?.validation?.featureCount)throw fault('INVALID_FILE');
  if(!files.get('boundary.geojson')?.validation?.featureCount)throw fault('INVALID_FILE');
  const safe=(value,depth=0)=>{if(depth>32)throw fault('INVALID_FILE');if(Array.isArray(value))value.forEach(x=>safe(x,depth+1));else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){if(/url|uri|__proto__|constructor|prototype/i.test(k)||k==='path'&&!DATASET_NAMES.includes(v))throw fault('INVALID_FILE');safe(v,depth+1);}};safe(manifest);safe(validation);
  const path=r=>files.get(r).logical_path;
  return {...record,villageName:manifest.village.name,imageryConfig:{...manifest.imagery,path:path('imagery.webp')},layerManifest:{layers:manifest.layers.map(d=>({...d,path:path(d.path)}))},validationSummary:{valid:true,fileCount:10,bounds:manifest.village.bounds,featureCounts:Object.fromEntries(manifest.layers.map(d=>[d.type,d.featureCount]))}};
 }
 return {
  async begin(identity,input){const spec=parseBusinessUpload(input),digest=requestDigest(spec),sessionId=randomUUID();return tx(identity,async c=>{
   const existing=await one(c,'SELECT api_private.file_existing($1,$2) AS data',[spec.requestId,digest]);if(existing)return existing;
   const budget=await one(c,'SELECT api_private.file_budget() AS data');const total=spec.files.reduce((a,f)=>a+f.size,0);
   if(await available()-Number(budget.bytes)-total<2*1024**3)throw fault('QUOTA_EXCEEDED');
   const files=spec.files.map(f=>({...f,id:randomUUID()}));return one(c,'SELECT api_private.file_begin($1,$2,$3::jsonb,$4::jsonb) AS data',[sessionId,digest,JSON.stringify(spec),JSON.stringify(files)]);
  });},
  async status(identity,id){if(!uuid(id))throw fault('INVALID_INPUT');return tx(identity,c=>lock(c,id));},
  async put(identity,id,role,stream){if(!uuid(id)||typeof role!=='string')throw fault('INVALID_INPUT');const f=await tx(identity,c=>one(c,'SELECT api_private.file_claim($1,$2) AS data',[id,role]));
   if(f.state==='ready'){const hash=createHash('sha256');let bytes=0;for await(const part of stream){bytes+=part.length;if(bytes>Number(f.size))throw fault('UPLOAD_CONFLICT');hash.update(part);}if(bytes!==Number(f.size)||hash.digest('hex')!==f.sha256)throw fault('UPLOAD_CONFLICT');return {id:f.id,size:bytes,sha256:f.sha256};}
   try{const rec=await store.stage({fileId:f.id,role:f.role,size:Number(f.size),mime:f.mime,extension:f.extension,stream});await store.persist(f.id);await tx(identity,c=>one(c,'SELECT api_private.file_finish($1,$2,$3,$4::jsonb) AS data',[id,f.id,rec.sha256,JSON.stringify(rec.validation)]));return {id:f.id,size:rec.size,sha256:rec.sha256};}
   catch(e){await tx(identity,c=>c.query('SELECT api_private.file_fail($1,$2)',[id,f.id])).catch(()=>{});throw e;}
  },
  async commit(identity,id,input){if(!uuid(id))throw fault('INVALID_INPUT');return tx(identity,async c=>{
   const s=await lock(c,id),record=parseBusinessCommit(s.purpose,input),digest=requestDigest(record);
   if(s.state==='committed'){if(s.commit_digest!==digest)throw fault('UPLOAD_CONFLICT');return s.result;}
   if(s.state!=='ready'||Date.parse(s.expires_at)<=now())throw fault('FILES_NOT_READY');await checkFiles(s);
   const verified=s.purpose==='dataset'?await packageRecord(s,record):record;
   return one(c,'SELECT api_private.file_commit($1,$2,$3::jsonb) AS data',[id,digest,JSON.stringify(verified)]);
  });},
  async read(identity,fileId){if(!uuid(fileId))throw fault('INVALID_INPUT');if(readers>=4)throw fault('FILE_BUSY');readers++;let opened;
   try{const f=await tx(identity,c=>one(c,'SELECT api_private.file_authorize($1) AS data',[fileId]));if(!f)throw fault('FORBIDDEN');
    opened=f.legacy?await legacyReader?.open(f):await store.open(f.id,{size:Number(f.size),sha256:f.sha256});if(!opened)throw fault('FILE_UNAVAILABLE');let closed=false;
    return {...opened,sha256:f.sha256??opened.sha256,mime:f.mime??fileType(f.name),extension:f.extension??f.name.split('.').at(-1).toLowerCase(),async close(){if(!closed){closed=true;try{await opened.close();}finally{readers--;}}}};
   }catch(e){await opened?.close();readers--;throw e;}
  },
  async resolvePath(identity,bucket,path){if(!['house-photos','group-models','village-datasets'].includes(bucket)||typeof path!=='string'||path.length>4096)throw fault('INVALID_INPUT');return tx(identity,c=>one(c,'SELECT api_private.file_resolve_path($1,$2) AS data',[bucket,path]));},
  async archive(identity,id){if(!uuid(id))throw fault('INVALID_INPUT');return tx(identity,c=>one(c,'SELECT api_private.file_archive($1) AS data',[id]));},
  async cleanup({execute=false}={}){const rows=await database.withMaintenance(c=>one(c,'SELECT api_private.file_cleanup($1) AS data',[false]));if(execute)for(const f of rows){await store.discard(f.id);await store.discard(f.id,{persisted:true});await database.withMaintenance(c=>c.query('SELECT api_private.file_cleanup_done($1)',[f.id]));}return {files:rows.length,bytes:rows.reduce((n,f)=>n+Number(f.size),0),executed:execute};}
 };
}
