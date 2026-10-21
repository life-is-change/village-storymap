import {randomUUID} from 'node:crypto';import {statfs} from 'node:fs/promises';
import {taskFileId} from '../unified/task-files.mjs';import {fault,uuid} from '../scene-files/contracts.mjs';
export function createCloudFiles({store,taskFiles,instanceId}){
 return {
  async openPhoto(job,input){
   const opened=await taskFiles.readTaskInput(input),p=job.photo;
   if(!p||opened.fileId!==p.fileId||opened.sha256!==p.sha256||opened.size!==Number(p.size)||opened.mime!==p.mime){await opened.close();throw fault('FILE_UNAVAILABLE');}return opened;
  },
  async persistOutput(job,output){
   if(!uuid(job.runId)||!Number.isSafeInteger(output.size)||output.size<1||output.size>10*1024**2||!['image/png','image/jpeg'].includes(output.mime))throw fault('INVALID_FILE');
   const space=await statfs(store.root);if(space.bavail*space.bsize<output.size+2*1024**3)throw fault('QUOTA_EXCEEDED');
   const tempId=randomUUID(),extension=output.mime==='image/png'?'png':'jpg';let published=false;
   try{
    const staged=await store.stage({fileId:tempId,role:'photo',size:output.size,mime:output.mime,extension,stream:output.stream}),fileId=taskFileId(`${instanceId}/${job.runId}/standard_facade/${staged.sha256}`);
    try{await store.persist(tempId,fileId);published=true;}
    catch(e){if(e.code!=='EEXIST')throw e;const existing=await store.open(fileId,{size:staged.size,sha256:staged.sha256});await existing.close();}
    return {fileId,size:staged.size,sha256:staged.sha256,mime:output.mime,extension};
   }finally{if(!published)await store.discard(tempId).catch(()=>{});}
  }
 };
}
