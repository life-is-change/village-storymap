import {parseOperation,fault} from './contracts.mjs';

const safeCodes=new Set(['FORBIDDEN','REVISION_CONFLICT','INVALID_INPUT','SOURCE_NOT_READY','WORKER_OFFLINE','TOO_MANY_ACTIVE_RUNS','NOT_FOUND','BRIDGE_UNAVAILABLE','FILE_UNAVAILABLE']);
const one=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.data;
export function createTaskService({database,bridge,files,now=Date.now}){
 if(!/^aliyun-[a-zA-Z0-9_-]{1,92}$/.test(bridge?.instanceId??''))throw Error('INVALID_CONFIGURATION');
 let active=null,closed=false,timer=null;
 const maintenance=(sql,args)=>database.withMaintenance(c=>one(c,sql,args));
 async function deliver(job){
  for(const snapshot of job.snapshots??[])await bridge.applyContext(snapshot);
  if(job.revoked)return {revoked:true};
  if(job.operation==='submit'){
   const input={...job.bridgeInput};
   if(job.photo){
    const opened=await files.readTaskInput(job);try{
     const photo=await bridge.uploadPhoto({...job.photo,size:opened.size,sha256:opened.sha256,mime:opened.mime,stream:opened.stream});
     await bridge.applyContext({...job.photo.snapshot,payload:{...job.photo.snapshot.payload,...photo}});
    }finally{await opened.close();}
   }
   await maintenance('SELECT api_private.task_before_submit($1,$2) AS data',[job.id,job.lease]);
   return bridge.submit(input);
  }
  const request={ownerId:job.ownerId,requestId:job.requestId};
  if(job.operation==='poll'){
   const result=await bridge.status(request);
   if(['completed','succeeded','awaiting_crop'].includes(result.run?.status)&&files.prepareTaskArtifacts){const artifacts=await bridge.artifacts(request);await files.prepareTaskArtifacts(job,artifacts.artifacts??[],bridge);}
   return result;
  }
  if(['cancel','retry','confirmCrop'].includes(job.operation))return bridge[job.operation]({...request,...job.input});
  if(job.operation==='import'){
   const result=await bridge.artifacts(request);
   if(!Array.isArray(result.artifacts)||!result.artifacts.length)throw Object.assign(Error(),{code:'SOURCE_NOT_READY'});
   // Download and validation are outside the database transaction. The fixed
   // import function rechecks current local authorization before committing.
   const descriptors=await files.prepareTaskArtifacts(job,result.artifacts,bridge);
   return files.importTaskArtifacts(job,descriptors);
  }
  throw Object.assign(Error(),{code:'INVALID_INPUT'});
 }
 return {
  async execute(identity,action,input){
   if(closed)throw fault('DB_UNAVAILABLE');if(!action.startsWith('tasks.'))throw fault('NOT_FOUND');const parsed=parseOperation(action,input);
   const result=await database.withIdentity(identity,c=>one(c,'SELECT api_private.task_execute($1,$2::jsonb,$3) AS data',[action,JSON.stringify(parsed.input),bridge.instanceId]));
   if(action==='tasks.availability')return (await bridge.availability({kind:input.kind})).data;
   if(action==='tasks.sourceStatus')return (await bridge.sourceStatus({villageId:result.workerVillageId})).data;
   return result;
  },
  async assertPhotoMutable(client,_identity,photoId){return one(client,'SELECT api_private.task_assert_photo_mutable($1) AS data',[photoId]);},
  async tick(){
   if(closed||active)return false;
   active=(async()=>{
    const job=await maintenance('SELECT api_private.task_next($1) AS data',[bridge.instanceId]);if(!job)return false;
    try{const result=await deliver(job);await maintenance('SELECT api_private.task_finish($1,$2,$3::jsonb) AS data',[job.id,job.lease,JSON.stringify(result)]);}
    catch(error){const code=safeCodes.has(error?.code)?error.code:'BRIDGE_UNAVAILABLE',delay=Math.min(30000,1000*2**Math.min(Number(job.attempts??0),5));await maintenance('SELECT api_private.task_fail($1,$2,$3,$4) AS data',[job.id,code,delay,job.lease]);}
    return true;
   })();try{return await active;}finally{active=null;}
  },
  start(){if(closed||timer)return;timer=setInterval(()=>this.tick().catch(()=>{}),1000);timer.unref?.();},
  async close(){closed=true;clearInterval(timer);await active;},
  get diagnostics(){return {active:Boolean(active),closed,observedAt:now()};}
 };
}
