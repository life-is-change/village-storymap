const fault=code=>Object.assign(Error(code),{code});
export function createLocalCloudFacade({repository,provider,files}){
 let active=false;
 return {available:provider.available,capability:()=>provider.capability?.()??({available:provider.available,provider:'dashscope',reason:provider.available?'':'not_configured'}),
  async drive(input){
   if(!provider.available)throw fault('SOURCE_NOT_READY');if(active)return;active=true;let job,intended=false,image;
   try{
    job=await repository.claim(input);if(!job||['wait','unknown','complete','failed','canceled'].includes(job.operation))return;
    if(job.operation==='submit'){
     image=await files.openPhoto(job,input);
     // The durable intent precedes the potentially billable network call. A
     // crash at any point from here is reconciled, never blindly resubmitted.
     await repository.intent(input,job);intended=true;
     const result=await provider.submit({image,requestId:job.runId});
     await repository.record(input,{status:'accepted',jobId:result.jobId,lease:job.lease});return;
    }
    if(job.operation!=='poll')throw fault('SOURCE_NOT_READY');
    const result=await provider.poll(job.jobId);
    if(result.status==='succeeded'){
     const output=await provider.openOutput(result.output);let artifact;
     try{artifact=await files.persistOutput(job,output);}finally{try{await output.stream.cancel?.();}catch{}}
     await repository.record(input,{status:'completed',artifact,lease:job.lease});
    }else await repository.record(input,{status:result.status==='failed'?'failed':result.status,lease:job.lease});
   }catch{
    if(job)await repository.record(input,{status:intended?'submission_unknown':job.operation==='submit'?'failed':'poll_error',lease:job.lease}).catch(()=>{});
   }finally{try{await image?.close();}finally{active=false;}}
  }
 };
}
