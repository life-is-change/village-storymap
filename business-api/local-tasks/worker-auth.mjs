import {createHash} from 'node:crypto';import {taskFault,uuid} from './contracts.mjs';
export function parseWorkerAuthorization(header){
 if(typeof header!=='string'||header.length>200)throw taskFault('UNAUTHORIZED');
 const match=/^Bearer village_worker_([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(header);
 if(!match||!uuid(match[1]))throw taskFault('UNAUTHORIZED');
 return {workerId:match[1],tokenDigest:createHash('sha256').update(match[2]).digest('hex')};
}
