import {taskFault,uuid} from './contracts.mjs';
const one=async(c,sql,args)=>(await c.query(sql,args)).rows[0]?.data;
export function createCloudRepository({database,instanceId}){
 async function call(action,input,p={}){
  if(action!=='version'&&(!uuid(input?.ownerId)||!uuid(input?.requestId)))throw taskFault('INVALID_INPUT');
  const value=await database.withMaintenance(c=>one(c,'SELECT api_private.local_cloud_call($1,$2,$3,$4,$5::jsonb) AS data',[input?.ownerId??null,input?.requestId??null,instanceId,action,JSON.stringify(p)]));
  if(value?.error)throw taskFault(value.error);if(!value)throw taskFault('DB_UNAVAILABLE');return value;
 }
 return {async verifyInstallation(){if((await call('version')).schemaVersion!==1)throw taskFault('DB_UNAVAILABLE');},claim:input=>call('claim',input),intent:(input,job)=>call('intent',input,{lease:job.lease}),record:(input,result)=>call('record',input,result)};
}
