import {UUID} from '../src/contracts.mjs';
const statuses={UNAUTHORIZED:401,FORBIDDEN:403,INVALID_INPUT:400,NOT_FOUND:404,METHOD_NOT_ALLOWED:405,UNSUPPORTED_MEDIA_TYPE:415,PAYLOAD_TOO_LARGE:413,LEASE_LOST:409,STALE_CLAIM:409,REVISION_CONFLICT:409,FILES_NOT_READY:409,WORKER_OFFLINE:503,DB_UNAVAILABLE:503,TOO_MANY_ACTIVE_RUNS:429,SOURCE_NOT_READY:409,FILE_UNAVAILABLE:503,INVALID_FILE:422,FILE_TYPE_UNSUPPORTED:415,FILE_TOO_LARGE:413,FILE_BUSY:503,UPLOAD_CONFLICT:409,UPLOAD_EXPIRED:410,QUOTA_EXCEEDED:507};
export const taskFault=code=>Object.assign(Error(Object.hasOwn(statuses,code)?code:'DB_UNAVAILABLE'),{code:Object.hasOwn(statuses,code)?code:'DB_UNAVAILABLE',status:statuses[code]??503});
export const uuid=value=>typeof value==='string'&&UUID.test(value)&&value===value.toLowerCase();
const code=value=>typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value);
const plain=v=>v!==null&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
export function workerCommand(kind,action,runId,leaseToken,payload){
 const fields={heartbeat:['protocol','state'],claim:['requestId'],renew:[],progress:['state','stage','progress'],fail:['errorCode'],cancel:[],'cancel-status':[],complete:['warnings'],'publish-rectification':[],'retry-failure':['errorCode'],sources:[],'source-status':['villageId','ready','bounds','errorCode']};
 if(!['geo','facade'].includes(kind)||!Object.hasOwn(fields,action)||!plain(payload)||Object.keys(payload).some(k=>!fields[action].includes(k))||Buffer.byteLength(JSON.stringify(payload))>8192)throw taskFault('INVALID_INPUT');
 const noRun=['heartbeat','claim','sources','source-status'].includes(action);
 if(noRun?(runId!==null||leaseToken!==null):(!uuid(runId)||!uuid(leaseToken)))throw taskFault('INVALID_INPUT');
 if(action==='heartbeat'&&(![kind+'-aliyun-local-v1',...(kind==='facade'?['facade-aliyun-local-v2']:[])].includes(payload.protocol)||!['idle','busy','error','starting'].includes(payload.state)))throw taskFault('INVALID_INPUT');
 if(action==='claim'&&!uuid(payload.requestId))throw taskFault('INVALID_INPUT');
 if(action==='progress'&&(!['running','rectifying','generating'].includes(payload.state)||!Number.isInteger(payload.progress)||payload.progress<1||payload.progress>99||typeof payload.stage!=='string'||!/^[a-z0-9_-]{1,80}$/.test(payload.stage)))throw taskFault('INVALID_INPUT');
 if(['fail','retry-failure'].includes(action)&&!code(payload.errorCode))throw taskFault('INVALID_INPUT');
 if(action==='complete'&&payload.warnings!==undefined&&(!Array.isArray(payload.warnings)||payload.warnings.length>20||payload.warnings.some(v=>!code(v))))throw taskFault('INVALID_INPUT');
 if(action==='source-status'&&(kind!=='geo'||typeof payload.villageId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(payload.villageId)||typeof payload.ready!=='boolean'||payload.errorCode!==undefined&&payload.errorCode!==null&&!code(payload.errorCode)||payload.bounds!==null&&(!Array.isArray(payload.bounds)||payload.bounds.length!==4||payload.bounds.some(v=>!Number.isFinite(v))||payload.bounds[0]>=payload.bounds[2]||payload.bounds[1]>=payload.bounds[3]||Math.abs(payload.bounds[0])>180||Math.abs(payload.bounds[2])>180||Math.abs(payload.bounds[1])>90||Math.abs(payload.bounds[3])>90)))throw taskFault('INVALID_INPUT');
 return structuredClone(payload);
}
