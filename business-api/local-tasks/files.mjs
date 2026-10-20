import {fault} from '../scene-files/contracts.mjs';
import {taskFileSpec,fileCommand} from './file-contracts.mjs';
import {taskFileId,geoJSONFeatures} from '../unified/task-files.mjs';

// Web stream cancellation must close the file even if the caller never reads
// its first byte (the ordinary importer often adopts this same blob directly).
function webStream(opened){
 const iterator=opened.stream()[Symbol.asyncIterator]();let ended=false;
 async function close(){if(ended)return;ended=true;try{await iterator.return?.();}finally{await opened.close();}}
 return new ReadableStream({async pull(controller){try{const {value,done}=await iterator.next();if(done){await close();controller.close();}else controller.enqueue(value);}catch(e){await close();controller.error(e);}},cancel:close});
}
export function createLocalTaskFiles({queue,store,chunks,budget,taskFiles}){
 const committing=new Set();
 const call=(actor,action,rid,lease,p={})=>queue.fileCall(actor,action,rid,lease,p);
 async function session(actor,rid,lease,input){fileCommand('status',rid,lease,input);return call(actor,'status',rid,lease,input);}
 return {
  async begin(actor,rid,lease,input){
   fileCommand('begin',rid,lease,input);const context=await call(actor,'context',rid,lease),{requestId,...spec}=input,checked=taskFileSpec(context.kind,context.phase,spec);
   const fileId=taskFileId(`${queue.instanceId}/${rid}/${spec.artifactType}/${spec.sha256}`);
   return call(actor,'begin',rid,lease,{requestId,...checked,fileId});
  },
  status:session,
  async put(actor,rid,lease,input,stream){
   fileCommand('chunk',rid,lease,input);const prior=await call(actor,'chunk-check',rid,lease,input);if(prior.state==='ready')return {...prior,replayed:true};
   const receipt=await budget.withWrite(()=>chunks.put(input.uploadId,input.index,input.size,input.sha256,stream));
   // The caller drains a duplicate request body; accepted bytes are immutable.
   const state=await call(actor,'chunk',rid,lease,input);return {...state,replayed:receipt.replayed};
  },
  async commit(actor,rid,lease,input){
   const s=await session(actor,rid,lease,input);if(s.state==='ready'){await chunks.remove(s.uploadId);return s;}
   if(committing.has(s.fileId))throw fault('FILE_BUSY');committing.add(s.fileId);
   try{
   const spec=taskFileSpec(s.kind,s.phase,{artifactType:s.artifactType,size:Number(s.size),sha256:s.sha256,mime:s.mime,extension:s.extension});
   if(s.chunks.reduce((n,p)=>n+p.size,0)!==spec.size)throw fault('FILES_NOT_READY');
   let validation;
   try{const opened=await store.open(s.fileId,{size:spec.size,sha256:spec.sha256});await opened.close();}
   catch(e){
    if(e.code!=='FILE_UNAVAILABLE')throw e;
    // A previous crash may leave this upload's private pending file. Never
    // discard a persisted blob: it might already be referenced elsewhere.
    await store.discard(s.fileId);
    const staged=await store.stage({...spec,fileId:s.fileId,stream:chunks.stream(s.uploadId,s.chunks)});
    if(staged.sha256!==spec.sha256){await store.discard(s.fileId);throw fault('INVALID_FILE');}
    validation=staged.validation;await store.persist(s.fileId);
   }
   if(spec.extension==='geojson'&&validation?.featureCount==null){const opened=await store.open(s.fileId,{size:spec.size,sha256:spec.sha256});let featureCount=0;try{for await(const _ of geoJSONFeatures(opened.stream()))featureCount++;}finally{await opened.close();}validation={featureCount};}
   // No connection is held while hashing/validating/fsyncing. The transaction
   // rechecks credential, lease, phase, cancellation and ownership here.
   const ready=await call(actor,'commit',rid,lease,{uploadId:s.uploadId,validation:validation??{}});
   await chunks.remove(s.uploadId);return ready;
   }finally{committing.delete(s.fileId);}
  },
  async abort(actor,rid,lease,input){fileCommand('abort',rid,lease,input);const result=await call(actor,'abort',rid,lease,input);await chunks.remove(input.uploadId);return result;},
  async openInput(actor,rid,lease){
   fileCommand('input',rid,lease,{});const s=await call(actor,'input',rid,lease,{});
   const opened=await taskFiles.readTaskInput({requestId:s.requestId,ownerId:s.ownerId});
   if(opened.fileId!==s.fileId||opened.size!==Number(s.size)||opened.sha256!==s.sha256||opened.mime!==s.mime){await opened.close();throw fault('FILE_UNAVAILABLE');}return {...opened,mime:s.mime,sha256:s.sha256};
  },
  async openArtifact(actor,rid,lease,input){fileCommand('artifact',rid,lease,input);const f=await call(actor,'artifact',rid,lease,input),opened=await store.open(f.fileId,{size:Number(f.size),sha256:f.sha256});return {...opened,mime:f.mime,sha256:f.sha256};},
  async readArtifact(input,type){
   const f=await queue.artifact(input,type),opened=await store.open(f.fileId,{size:Number(f.size),sha256:f.sha256});return {size:opened.size,sha256:f.sha256,mime:f.mime,stream:webStream(opened)};
  }
 };
}
