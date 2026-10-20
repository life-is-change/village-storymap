import {createHash} from 'node:crypto';
import {fault} from './contracts.mjs';
import {fileType} from '../src/storage.mjs';
const geo={buildings:['buildings.geojson','building'],roads:['roads.geojson','road'],waterways:['waterways.geojson','water'],water_areas:['water_areas.geojson','water'],contours:['contours.geojson','contours']};
const images=new Set(['rectified_preview','rectified_source','building_mask','standard_facade']);
const one=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.data;
const fileId=text=>{const h=createHash('sha256').update(text).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};

// Input has already passed the store's streaming GeoJSON validator and immutable
// hash check. This second pass materializes only one feature, at most 2 MiB.
export async function* geoJSONFeatures(stream){
 const decoder=new TextDecoder('utf-8',{fatal:true});let depth=0,inString=false,escape=false,key='',rootString='',pending=false,arrayDepth=0,capture=null;
 function* consume(text){for(const ch of text){
  if(capture!==null){capture+=ch;if(capture.length>2*1024**2)throw fault('INVALID_FILE');}
  if(inString){if(depth===1)rootString+=ch;if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch==='"'){inString=false;if(depth===1){try{key=JSON.parse(rootString);}catch{throw fault('INVALID_FILE');}}}continue;}
  if(ch==='"'){inString=true;rootString=depth===1?'"':'';continue;}
  if(ch===':'&&depth===1){pending=key==='features';continue;}
  if(ch==='{'||ch==='['){
   if(ch==='['&&depth===1&&pending){arrayDepth=2;pending=false;}
   if(ch==='{'&&depth===arrayDepth&&arrayDepth){capture='{';}
   depth++;continue;
  }
  if(ch==='}'||ch===']'){
   depth--;if(capture!==null&&depth===arrayDepth){let feature;try{feature=JSON.parse(capture);}catch{throw fault('INVALID_FILE');}if(Buffer.byteLength(capture)>2*1024**2)throw fault('INVALID_FILE');capture=null;yield feature;}
   if(ch===']'&&depth<arrayDepth)arrayDepth=0;
  }
 }}
 try{for await(const chunk of stream)yield* consume(typeof chunk==='string'?chunk:decoder.decode(chunk,{stream:true}));yield* consume(decoder.decode());if(inString||capture!==null||depth!==0)throw fault('INVALID_FILE');}catch(e){throw e?.code?e:fault('INVALID_FILE');}
}
export function createTaskFiles({database,store,legacyReader,instanceId}){
 const maintenance=(sql,args)=>database.withMaintenance(c=>one(c,sql,args));
 async function manage(job,action,input){return maintenance('SELECT api_private.task_artifact_manage($1,$2,$3,$4::jsonb) AS data',[job.id,job.lease,action,JSON.stringify(input)]);}
 return {
  async readTaskInput(job){
   const f=await maintenance('SELECT api_private.task_photo_file($1,$2,$3) AS data',[job.requestId,job.ownerId,instanceId]);if(!f)throw fault('FORBIDDEN');
   const opened=f.legacy?await legacyReader.open(f):await store.open(f.id,{size:Number(f.size),sha256:f.sha256});
   const mime=f.mime??fileType(f.name);if(!['image/jpeg','image/png'].includes(mime)||opened.size>10485760){await opened.close();throw fault('FILE_TYPE_UNSUPPORTED');}
   return {...opened,sha256:f.sha256??opened.sha256,mime,stream:()=>opened.stream({start:0,end:opened.size-1})};
  },
  async prepareTaskArtifacts(job,artifacts,bridge){
   const prepared=[];
   for(const a of artifacts){
    const type=a.artifact_type;if(!geo[type]&&!images.has(type)&&type!=='building_glb')continue;
    if(!/^[a-f0-9]{64}$/.test(a.sha256??''))throw fault('INVALID_FILE');
    let descriptor=await manage(job,'lookup',{artifactType:type,sha256:a.sha256});
    if(descriptor?.state==='ready'){const h=await store.open(descriptor.file_id,{size:Number(descriptor.size),sha256:descriptor.sha256});await h.close();prepared.push(descriptor);continue;}
    const response=await bridge.downloadArtifact({ownerId:job.ownerId,requestId:job.requestId},type);
    if(response.sha256!==a.sha256){await response.stream.cancel?.();throw fault('INVALID_FILE');}
    const extension=geo[type]?'geojson':type==='building_glb'?'glb':response.mime==='image/png'?'png':response.mime==='image/jpeg'?'jpg':null;
    const mime=geo[type]?'application/geo+json':type==='building_glb'?'model/gltf-binary':response.mime;
    if(!extension||geo[type]&&!['application/json','application/geo+json'].includes(response.mime)||type==='building_glb'&&!['model/gltf-binary','application/octet-stream'].includes(response.mime)){await response.stream.cancel?.();throw fault('INVALID_FILE');}
    const fid=fileId(`${instanceId}/${job.sourceRunId}/${type}/${a.sha256}`),spec={artifactType:type,fileId:fid,sha256:a.sha256,size:response.size,mime,extension};
    descriptor=await manage(job,'reserve',spec);let validation;
    try{
     const existing=await store.open(fid,{size:response.size,sha256:a.sha256});await existing.close();await response.stream.cancel?.();validation={featureCount:descriptor.feature_count};
     // A persisted file whose ready receipt was lost is validated again below.
    }catch(e){
     if(e.code!=='FILE_UNAVAILABLE')throw e;
     // The deterministic ID is reserved for this task/digest. Only its private,
     // unpublished pending file can be retried after an interrupted stream.
     await store.discard(fid);
     const staged=await store.stage({fileId:fid,role:geo[type]?.[0]??(extension==='glb'?'display':'photo'),size:response.size,mime,extension,stream:response.stream});
     if(staged.sha256!==a.sha256){await store.discard(fid);throw fault('INVALID_FILE');}validation=staged.validation;await store.persist(fid);
    }
    if(geo[type]&&validation?.featureCount==null){const h=await store.open(fid,{size:response.size,sha256:a.sha256});let count=0;try{for await(const _f of geoJSONFeatures(h.stream({start:0,end:h.size-1})))count++;}finally{await h.close();}validation={featureCount:count};}
    descriptor=await manage(job,'ready',{...spec,featureCount:validation?.featureCount??null});prepared.push(descriptor);
   }
   return prepared;
  },
  async importTaskArtifacts(job,descriptors){
   return database.withMaintenance(async c=>{
    const result=await one(c,'SELECT api_private.task_import_begin($1,$2) AS data',[job.id,job.lease]);if(result.existing)return {bundleId:result.bundleId};
    for(const d of descriptors){if(!d.layer_key)continue;const h=await store.open(d.file_id,{size:Number(d.size),sha256:d.sha256});let batch=[],bytes=0;
     const flush=async()=>{if(batch.length){await one(c,'SELECT api_private.task_import_append($1,$2,$3,$4,$5::jsonb) AS data',[job.id,job.lease,result.bundleId,d.layer_key,JSON.stringify(batch)]);batch=[];bytes=0;}};
     try{for await(const f of geoJSONFeatures(h.stream({start:0,end:h.size-1}))){const n=Buffer.byteLength(JSON.stringify(f));if(batch.length>=500||bytes+n>1024**2)await flush();batch.push(f);bytes+=n;}await flush();}finally{await h.close();}
    }
    return one(c,'SELECT api_private.task_import_finish($1,$2,$3) AS data',[job.id,job.lease,result.bundleId]);
   });
  },
  async listTaskArtifacts(identity,requestId){return database.withIdentity(identity,c=>one(c,'SELECT api_private.task_artifacts_read($1,$2) AS data',[requestId,instanceId]));},
  async readTaskArtifact(identity,requestId,artifactType,{sha256}={}){
   const rows=await this.listTaskArtifacts(identity,requestId),f=rows.find(x=>x.artifact_type===artifactType&&(!sha256||x.sha256===sha256));if(!f)throw fault('NOT_FOUND');
   const opened=await store.open(f.file_id,{size:Number(f.size),sha256:f.sha256});return {...opened,mime:f.mime,sha256:f.sha256};
  }
 };
}
