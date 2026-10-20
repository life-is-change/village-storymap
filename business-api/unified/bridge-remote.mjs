import {AUTH_ORIGIN} from '../src/config.mjs';
import {jsonTree} from './contracts.mjs';
const fault=code=>Object.assign(Error(code),{code});
export function createBridgeRemote({token,origin=AUTH_ORIGIN,fetchImpl=fetch}){
 if(origin!==AUTH_ORIGIN||typeof token!=='string'||token.length<32||token.length>256||/\s/.test(token))throw Error('INVALID_CONFIGURATION');
 async function request(endpoint,body,headers={},binary=false){
  let response;try{response=await fetchImpl(origin+'/functions/v1/'+endpoint,{method:'POST',headers:{authorization:'Bearer '+token,...headers},body,duplex:'half',cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw fault('BRIDGE_UNAVAILABLE');}
  if(!response.ok){let error;try{error=await response.json();}catch{}throw fault(['FORBIDDEN','INVALID_INPUT','REVISION_CONFLICT','SOURCE_NOT_READY','WORKER_OFFLINE','TOO_MANY_ACTIVE_RUNS','NOT_FOUND','INVALID_FILE','PAYLOAD_TOO_LARGE'].includes(error?.error?.code)?error.error.code:'BRIDGE_UNAVAILABLE');}
  if(binary)return response;
  const length=Number(response.headers.get('content-length'));if(length>2*1024**2)throw fault('BRIDGE_UNAVAILABLE');
  const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>2*1024**2)throw fault('BRIDGE_UNAVAILABLE');parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fault('BRIDGE_UNAVAILABLE');}
 }
 const json=(endpoint,input)=>{jsonTree(input);return request(endpoint,JSON.stringify(input),{'content-type':'application/json'});};
 return {
  call:(operation,{p_request})=>json('aliyun-task-bridge',{action:'call',operation,input:p_request}),
  cloud:(action,input={})=>json('aliyun-facade-cloud',{action,...input}),
  uploadPhoto:async({fileId,sha256,size,mime,stream})=>{
   if(!/^[a-f0-9]{64}$/.test(sha256??'')||!Number.isSafeInteger(size)||size<=0||size>10485760||!['image/png','image/jpeg'].includes(mime))throw fault('INVALID_INPUT');
   return request('aliyun-task-bridge',stream(),{'content-type':mime,'content-length':String(size),'x-bridge-photo':JSON.stringify({fileId,sha256,size,mime})});
  },
  downloadArtifact:async(input,artifactType)=>{
   const response=await request('aliyun-task-bridge',JSON.stringify({action:'artifact',...input,artifactType}),{'content-type':'application/json'},true);
   const size=Number(response.headers.get('content-length')),sha256=response.headers.get('x-bridge-sha256'),mime=response.headers.get('content-type')?.split(';')[0];
   if(!Number.isSafeInteger(size)||size<=0||size>52428800||!/^[a-f0-9]{64}$/.test(sha256??'')){await response.body?.cancel();throw fault('INVALID_FILE');}
   return {size,sha256,mime,stream:response.body};
  }
 };
}
