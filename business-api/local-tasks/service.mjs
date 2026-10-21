import {parseWorkerAuthorization} from './worker-auth.mjs';import {workerCommand,taskFault,uuid} from './contracts.mjs';
const one=async(c,sql,args)=>(await c.query(sql,args)).rows[0]?.data;
export function createLocalQueueService({database,instanceId}){
 if(!/^aliyun-[a-zA-Z0-9_-]{1,92}$/.test(instanceId??''))throw Error('INVALID_CONFIGURATION');
 const proofs=new WeakMap();
 function result(value){if(value?.error)throw taskFault(value.error);if(value===undefined)throw taskFault('DB_UNAVAILABLE');return value;}
 return {
  instanceId,
  async verifyInstallation(){const value=await database.withMaintenance(c=>one(c,'SELECT api_private.local_queue_version() AS data',[]));if(value?.schemaVersion!==1)throw taskFault('DB_UNAVAILABLE');return value;},
  async verifyFilesInstallation(){const value=await database.withMaintenance(c=>one(c,'SELECT api_private.local_task_files_version() AS data',[]));if(value?.schemaVersion!==1)throw taskFault('DB_UNAVAILABLE');return value;},
  async authenticate(header){
   const proof=parseWorkerAuthorization(header),row=await database.withMaintenance(c=>one(c,'SELECT api_private.local_worker_auth($1,$2,$3) AS data',[proof.workerId,proof.tokenDigest,instanceId]));
   if(!row||row.workerId!==proof.workerId||!['geo','facade'].includes(row.kind))throw taskFault('UNAUTHORIZED');
   const actor=Object.freeze({workerId:row.workerId,kind:row.kind});proofs.set(actor,proof);return actor;
  },
  async workerCall(actor,action,runId=null,leaseToken=null,payload={}){
   const proof=proofs.get(actor);if(!proof)throw taskFault('UNAUTHORIZED');const parsed=workerCommand(actor.kind,action,runId,leaseToken,payload);
   return result(await database.withMaintenance(c=>one(c,'SELECT api_private.local_worker_call($1,$2,$3,$4,$5,$6,$7::jsonb) AS data',[proof.workerId,proof.tokenDigest,instanceId,action,runId,leaseToken,JSON.stringify(parsed)])));
  },
  async control(action,input){
   if(!['enqueue','status','cancel','retry','confirmCrop','artifacts','availability','sourceStatus'].includes(action)||Buffer.byteLength(JSON.stringify(input))>2*1024**2)throw taskFault('INVALID_INPUT');
   return result(await database.withMaintenance(c=>one(c,'SELECT api_private.local_task_control($1,$2,$3::jsonb) AS data',[action,instanceId,JSON.stringify(input)])));
  },
  async fileCall(actor,action,runId,leaseToken,payload={}){
   const proof=proofs.get(actor);if(!proof)throw taskFault('UNAUTHORIZED');
   if(!['context','input','artifact','begin','status','chunk-check','chunk','commit','abort'].includes(action)||!uuid(runId)||!uuid(leaseToken)||!payload||Array.isArray(payload)||typeof payload!=='object'||Buffer.byteLength(JSON.stringify(payload))>8192)throw taskFault('INVALID_INPUT');
   return result(await database.withMaintenance(c=>one(c,'SELECT api_private.local_worker_file($1,$2,$3,$4,$5,$6,$7::jsonb) AS data',[proof.workerId,proof.tokenDigest,instanceId,action,runId,leaseToken,JSON.stringify(payload)])));
  },
  async artifact(input,type){
   if(!uuid(input?.ownerId)||!uuid(input?.requestId)||!['buildings','roads','waterways','water_areas','contours','rectified_preview','rectified_source','building_mask','building_glb','standard_facade'].includes(type))throw taskFault('INVALID_INPUT');
   return result(await database.withMaintenance(c=>one(c,'SELECT api_private.local_task_artifact($1,$2,$3,$4) AS data',[input.ownerId,input.requestId,instanceId,type])));
  }
 };
}
