import {taskFault} from './contracts.mjs';
// Compatibility with the existing outbox driver is internal only. Every
// operation below stays inside the same local ownership/database domain.
export function createLocalTaskTransport({queue,artifactReader}){
 return {instanceId:queue.instanceId,local:true,
  async applyContext(){throw taskFault('INVALID_INPUT');},
  submit:input=>queue.control('enqueue',{ownerId:input.ownerId,requestId:input.requestId,...(input.photo?{photo:input.photo}:{})}),
  ...Object.fromEntries(['status','cancel','retry','confirmCrop','artifacts','availability','sourceStatus'].map(action=>[action,input=>queue.control(action,input)])),
  async downloadArtifact(input,type){if(!artifactReader)throw taskFault('FILE_UNAVAILABLE');return artifactReader(input,type);}
 };
}
