import {authorized,json,readJSON,readBounded,UUID,fail,checkedRequest} from './security.mjs';
export const RPC_NAMES=Object.freeze(['bridge_v1_apply_context','bridge_v1_enqueue','bridge_v1_status','bridge_v1_cancel','bridge_v1_confirm_crop','bridge_v1_retry','bridge_v1_artifacts','bridge_v1_availability','bridge_v1_source_status','bridge_v1_cloud_claim','bridge_v1_cloud_record']);
export const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export function createBridgeHandler({token,instanceId,database,storage}){
 if(!/^aliyun-[a-zA-Z0-9_-]{1,92}$/.test(instanceId))throw Error('INVALID_CONFIGURATION');
 return async request=>{
  if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED'}},405);
  if(!await authorized(request,token))return json({error:{code:'UNAUTHORIZED'}},401);
  try{
   if(request.headers.has('x-bridge-photo')){
    const header=request.headers.get('x-bridge-photo');if(header.length>2048)throw fail('INVALID_INPUT');let photo;try{photo=JSON.parse(header);}catch{throw fail('INVALID_INPUT');}
    if(!photo||Object.keys(photo).some(k=>!['fileId','sha256','size','mime'].includes(k))||!UUID.test(photo.fileId??'')||!/^[a-f0-9]{64}$/.test(photo.sha256??'')||!Number.isSafeInteger(photo.size)||photo.size<1||photo.size>10485760||!['image/jpeg','image/png'].includes(photo.mime))throw fail('INVALID_INPUT');
    const bytes=await readBounded(request,10485760);
    const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(bytes.length!==photo.size||await sha256(bytes)!==photo.sha256||!(photo.mime==='image/png'?png:jpg))throw fail('INVALID_FILE');
    const path=`${instanceId}/photos/${photo.fileId}/${photo.sha256}.${photo.mime==='image/png'?'png':'jpg'}`;
    await storage.putInput(path,bytes,photo.mime);return json({path,sha256:photo.sha256,size:bytes.length,mime:photo.mime});
   }
   const body=await readJSON(request,2*1024**2);
   if(body.action==='call'){
    if(Object.keys(body).some(k=>!['action','operation','input'].includes(k))||!RPC_NAMES.includes(body.operation)||!body.input||typeof body.input!=='object'||Array.isArray(body.input))throw fail('INVALID_INPUT');
    return json(await database.call(body.operation,body.input));
   }
   if(body.action==='artifact'){
    const input=checkedRequest(body,['action','ownerId','requestId','artifactType']);
    if(typeof body.artifactType!=='string'||!/^[-a-z_]{1,80}$/.test(body.artifactType))throw fail('INVALID_INPUT');
    const receipt=await database.call('bridge_v1_status',input);
    if(receipt.instanceId!==instanceId||!['completed','succeeded','awaiting_crop','queued_generation','generating'].includes(receipt.run?.status))throw fail('SOURCE_NOT_READY');
    const result=await database.call('bridge_v1_artifacts',input),artifact=result.artifacts?.find(a=>a.artifact_type===body.artifactType);
    if(!artifact)throw fail('NOT_FOUND');
    return storage.openArtifact({instanceId,ownerId:input.ownerId,runId:receipt.runId,kind:receipt.kind,artifact});
   }
   throw fail('INVALID_INPUT');
  }catch(e){
   const code=['FORBIDDEN','INVALID_INPUT','REVISION_CONFLICT','SOURCE_NOT_READY','WORKER_OFFLINE','TOO_MANY_ACTIVE_RUNS','NOT_FOUND','PAYLOAD_TOO_LARGE','INVALID_FILE'].includes(e?.code)?e.code:'BRIDGE_UNAVAILABLE';
   return json({error:{code}},({FORBIDDEN:403,INVALID_INPUT:400,REVISION_CONFLICT:409,TOO_MANY_ACTIVE_RUNS:429,NOT_FOUND:404,PAYLOAD_TOO_LARGE:413,INVALID_FILE:422})[code]??503);
  }
 };
}
