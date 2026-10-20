import {authorized,json,readJSON,checkedRequest,fail} from '../aliyun-task-bridge/security.mjs';
// No Supabase browser identity or photo ID is accepted here. The one instance's
// server token unlocks fixed operations against its private bridge receipts.
export function createCloudFacadeHandler({token,instanceId,repository,provider,storage}){
 if(!/^aliyun-[a-zA-Z0-9_-]{1,92}$/.test(instanceId))throw Error('INVALID_CONFIGURATION');
 return async request=>{
  if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED'}},405);
  if(!await authorized(request,token))return json({error:{code:'UNAUTHORIZED'}},401);
  let input,job,submitted=false;
  try{
   const body=await readJSON(request);
   if(body.action==='capability'){
    if(Object.keys(body).some(k=>k!=='action'))throw fail('INVALID_INPUT');
    return json({available:Boolean(provider.available),reason:provider.available?'':'not_configured',provider:'dashscope'});
   }
   if(!['submit','poll'].includes(body.action))throw fail('INVALID_INPUT');
   input=checkedRequest(body,['action','ownerId','requestId']);
   if(!provider.available)return json({error:{code:'CLOUD_FACADE_NOT_CONFIGURED'}},503);
   job=await repository.claim(input);
   if(job.operation==='wait')return json({state:'pending'},202);
   if(job.operation==='complete')return json({state:'completed'});
   if(job.operation==='failed')return json({state:'failed',errorCode:job.errorCode??'PROVIDER_FAILED'});
   if(job.operation==='submit'){
    const imageUrl=await storage.signInput(job.photo);submitted=true;
    const result=await provider.submit({imageUrl,requestId:job.runId});
    if(typeof result?.jobId!=='string'||!result.jobId||result.jobId.length>200)throw fail('PROVIDER_UNAVAILABLE');
    submitted=false;
    await repository.record(input,{status:'queued',jobId:result.jobId,lease:job.lease});return json({state:'queued'},202);
   }
   if(job.operation!=='poll')throw fail('SOURCE_NOT_READY');
   const result=await provider.poll(job.jobId);
   if(result.status==='succeeded'){
    const artifact=await storage.persistOutput(job,result.output);
    await repository.record(input,{status:'succeeded',artifact,lease:job.lease});return json({state:'completed'});
   }
   const status=['queued','running','failed'].includes(result.status)?result.status:'failed';
   await repository.record(input,{status,lease:job.lease});return json({state:status});
  }catch(e){
   // A lost provider response must not cause a second billable submission.
   if(submitted)await repository.record(input,{status:'submission_unknown',lease:job.lease}).catch(()=>{});
   const code=['INVALID_INPUT','PAYLOAD_TOO_LARGE','FORBIDDEN','NOT_FOUND','SOURCE_NOT_READY'].includes(e?.code)?e.code:'PROVIDER_UNAVAILABLE';
   return json({error:{code}},({INVALID_INPUT:400,PAYLOAD_TOO_LARGE:413,FORBIDDEN:403,NOT_FOUND:404})[code]??503);
  }
 };
}
