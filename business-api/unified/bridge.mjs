import {UUID} from '../src/contracts.mjs';
import {jsonTree} from './contracts.mjs';
const names={applyContext:'bridge_v1_apply_context',submit:'bridge_v1_enqueue',status:'bridge_v1_status',cancel:'bridge_v1_cancel',confirmCrop:'bridge_v1_confirm_crop',retry:'bridge_v1_retry',artifacts:'bridge_v1_artifacts',availability:'bridge_v1_availability',sourceStatus:'bridge_v1_source_status'};
const code=(v)=>Object.assign(Error(v),{code:v,status:({INVALID_INPUT:400,FORBIDDEN:403,REVISION_CONFLICT:409,NOT_FOUND:404,TOO_MANY_ACTIVE_RUNS:429})[v]??503});
const known=new Set(['FORBIDDEN','INVALID_INPUT','REVISION_CONFLICT','SOURCE_NOT_READY','WORKER_OFFLINE','TOO_MANY_ACTIVE_RUNS','NOT_FOUND']);
const uuid=v=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase();
export function createTaskBridge({remote,instanceId}){
 if(typeof instanceId!=='string'||!/^aliyun-[a-zA-Z0-9_-]{1,92}$/.test(instanceId)||typeof remote?.call!=='function')throw code('INVALID_INPUT');
 async function call(action,input){
  const fields=action==='availability'?['kind']:action==='sourceStatus'?['villageId']:action==='applyContext'?['localKind','localId','version','tombstone','payload']:action==='submit'?['ownerId','requestId','contextId','contextVersion','profileVersion','photoId','photoVersion','kind','input']:action==='confirmCrop'?['ownerId','requestId','cropTop','roofType','buildingWidth','buildingDepth']:['ownerId','requestId'];
  jsonTree(input);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k))||Buffer.byteLength(JSON.stringify(input))>2*1024**2)throw code('INVALID_INPUT');
  if(action==='applyContext'){
   if(!['profile','space','photo'].includes(input.localKind)||typeof input.localId!=='string'||!input.localId||input.localId.length>200||!Number.isSafeInteger(input.version)||input.version<1||typeof input.tombstone!=='boolean'||!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))throw code('INVALID_INPUT');
  }else if(action==='availability'){
   if(!['geoprocessing','facade','cloud-facade'].includes(input.kind))throw code('INVALID_INPUT');
  }else if(action==='sourceStatus'){
   if(typeof input.villageId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(input.villageId))throw code('INVALID_INPUT');
  }else{
   if(!uuid(input.ownerId)||!uuid(input.requestId))throw code('INVALID_INPUT');
   if(action==='submit'&&(!['geo','facade','cloud-facade'].includes(input.kind)||typeof input.contextId!=='string'||!input.contextId||input.contextId.length>200||![input.contextVersion,input.profileVersion].every(v=>Number.isSafeInteger(v)&&v>=1)||!input.input||typeof input.input!=='object'||Array.isArray(input.input)||input.kind!=='geo'&&(typeof input.photoId!=='string'||!Number.isSafeInteger(input.photoVersion)||input.photoVersion<1)))throw code('INVALID_INPUT');
   if(action==='confirmCrop'&&(!Number.isFinite(input.cropTop)||input.cropTop<0||input.cropTop>0.65||!['hip','gable','flat'].includes(input.roofType)||![input.buildingWidth,input.buildingDepth].every(v=>Number.isFinite(v)&&v>0&&v<=500)))throw code('INVALID_INPUT');
  }
  let result;try{
   if(action==='availability'&&input.kind==='cloud-facade')return {instanceId,data:await remote.cloud('capability')};
   if(action==='submit'&&input.kind==='cloud-facade'&&!(await remote.cloud('capability')).available)throw {code:'SOURCE_NOT_READY'};
   result=await remote.call(names[action],{p_instance_id:instanceId,p_request:structuredClone(input)});
   if(action==='submit'&&input.kind==='cloud-facade')await remote.cloud('submit',{ownerId:input.ownerId,requestId:input.requestId});
   if(action==='status'&&result?.kind==='cloud-facade'&&!['failed','succeeded'].includes(result.run?.status)){
    await remote.cloud('poll',input);result=await remote.call(names[action],{p_instance_id:instanceId,p_request:structuredClone(input)});
   }
  }catch(e){throw code(known.has(e?.code)?e.code:'BRIDGE_UNAVAILABLE');}
  if(!result||result.instanceId!==instanceId)throw code('BRIDGE_UNAVAILABLE');return result;
 }
 return {instanceId,...Object.fromEntries(Object.keys(names).map(action=>[action,input=>call(action,input)])),
  uploadPhoto:input=>remote.uploadPhoto(input),downloadArtifact:(input,type)=>remote.downloadArtifact(input,type)};
}
