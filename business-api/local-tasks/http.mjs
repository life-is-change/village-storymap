import {randomUUID} from 'node:crypto';import {taskFault,uuid} from './contracts.mjs';
async function body(req){
 if(req.headers['content-type']?.split(';')[0].trim()!=='application/json'||req.headers['content-encoding'])throw taskFault('UNSUPPORTED_MEDIA_TYPE');
 const length=req.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>8192))throw taskFault('PAYLOAD_TOO_LARGE');
 let count=0;const chunks=[];for await(const chunk of req.iterator({destroyOnReturn:false})){if((count+=chunk.length)>8192)throw taskFault('PAYLOAD_TOO_LARGE');chunks.push(chunk);}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw taskFault('INVALID_INPUT');}
}
export function createLocalWorkerHandler({queue,log=()=>{}}){
 let active=0;
 return async(req,res)=>{
  const requestId=randomUUID();let action='unmatched',status=200,counted=false;
  const send=(code,value)=>{status=code;if(!res.headersSent&&!res.destroyed){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId});res.end(JSON.stringify(value));}};
  try{
   if(typeof req.url!=='string'||req.url.length>512)throw taskFault('INVALID_INPUT');const url=new URL(req.url,'http://internal');if(url.search)throw taskFault('INVALID_INPUT');
   const plain=/^\/api\/worker\/v1\/(heartbeat|claim|sources|source-status)$/.exec(url.pathname),run=/^\/api\/worker\/v1\/runs\/([a-f0-9-]{36})\/(renew|progress|fail|cancel|cancel-status|complete|publish-rectification|retry-failure)$/.exec(url.pathname);
   if(!plain&&!run)throw taskFault('NOT_FOUND');action=plain?.[1]??run[2];
   if(req.method!==(['sources','cancel-status'].includes(action)?'GET':'POST'))throw taskFault('METHOD_NOT_ALLOWED');
   if((req.rawHeaders??[]).filter((v,i)=>i%2===0&&v.toLowerCase()==='authorization').length!==1)throw taskFault('UNAUTHORIZED');
   if(active>=8)throw taskFault('DB_UNAVAILABLE');active++;counted=true;
   const actor=await queue.authenticate(req.headers.authorization);let runId=null,leaseToken=null;
   if(run){runId=run[1];leaseToken=req.headers['x-village-lease'];if(!uuid(runId)||!uuid(leaseToken)||(req.rawHeaders??[]).filter((v,i)=>i%2===0&&v.toLowerCase()==='x-village-lease').length!==1)throw taskFault('INVALID_INPUT');}
   const payload=req.method==='GET'?{}:await body(req);send(200,{data:await queue.workerCall(actor,action,runId,leaseToken,payload)});
  }catch(error){const safe=taskFault(error?.code);send(safe.status,{error:{code:safe.code,requestId}});if(req.readable&&!req.complete){req.setTimeout(1000,()=>req.destroy());req.resume();}}
  finally{if(counted)active--;log({requestId,action,status});}
 };
}
