import {taskFault} from './contracts.mjs';
// Compatibility with the existing outbox driver is internal only. Every
// operation below stays inside the same local ownership/database domain.
export function createLocalTaskTransport({queue,artifactReader,cloud}){
 return {instanceId:queue.instanceId,local:true,
  async applyContext(){throw taskFault('INVALID_INPUT');},
  async submit(input){if(input.kind==='cloud-facade'&&!cloud?.available)throw taskFault('SOURCE_NOT_READY');return queue.control('enqueue',{ownerId:input.ownerId,requestId:input.requestId,...(input.photo?{photo:input.photo}:{})});},
  ...Object.fromEntries(['cancel','retry','confirmCrop','artifacts','sourceStatus'].map(action=>[action,input=>queue.control(action,input)])),
  availability:input=>input.kind==='cloud-facade'?{instanceId:queue.instanceId,data:cloud?.capability()??{available:false,provider:'dashscope',reason:'not_configured'}}:queue.control('availability',input),
  async status(input){let result=await queue.control('status',input);if(result.kind==='cloud-facade'&&cloud?.available){await cloud.drive(input);result=await queue.control('status',input);}return result;},
  async downloadArtifact(input,type){if(!artifactReader)throw taskFault('FILE_UNAVAILABLE');return artifactReader(input,type);}
 };
}
