import {randomUUID} from 'node:crypto';import {taskFault,uuid} from './contracts.mjs';
import {pipeline} from 'node:stream/promises';import {byteRange} from '../src/storage.mjs';
async function body(req){
 if(req.headers['content-type']?.split(';')[0].trim()!=='application/json'||req.headers['content-encoding'])throw taskFault('UNSUPPORTED_MEDIA_TYPE');
 const length=req.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>8192))throw taskFault('PAYLOAD_TOO_LARGE');
 let count=0;const chunks=[];for await(const chunk of req.iterator({destroyOnReturn:false})){if((count+=chunk.length)>8192)throw taskFault('PAYLOAD_TOO_LARGE');chunks.push(chunk);}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw taskFault('INVALID_INPUT');}
}
export function createLocalWorkerHandler({queue,files,log=()=>{}}){
 let active=0;
 return async(req,res)=>{
  const requestId=randomUUID();let action='unmatched',status=200,counted=false;
  const send=(code,value)=>{status=code;if(!res.headersSent&&!res.destroyed){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId});res.end(JSON.stringify(value));}};
  try{
   if(typeof req.url!=='string'||req.url.length>512)throw taskFault('INVALID_INPUT');const url=new URL(req.url,'http://internal');if(url.search)throw taskFault('INVALID_INPUT');
   const plain=/^\/api\/worker\/v1\/(identity|heartbeat|claim|sources|source-status)$/.exec(url.pathname),run=/^\/api\/worker\/v1\/runs\/([a-f0-9-]{36})\/(renew|progress|fail|cancel|cancel-status|complete|publish-rectification|retry-failure)$/.exec(url.pathname);
   const file=files&&/^\/api\/worker\/v1\/runs\/([a-f0-9-]{36})\/(input|artifacts\/(rectified_preview|rectified_source|building_mask)|uploads(?:\/([a-f0-9-]{36})(?:\/(commit|chunks\/(\d{1,2})))?)?)$/.exec(url.pathname);
   if(!plain&&!run&&!file)throw taskFault('NOT_FOUND');action=plain?.[1]??run?.[2]??(file[2]==='input'?'input':file[3]?'artifact':file[6]?'chunk':file[5]==='commit'?'commit':!file[4]?'begin':req.method==='DELETE'?'abort':'status');
   const method=['identity','sources','cancel-status','input','artifact','status'].includes(action)?'GET':action==='chunk'?'PUT':action==='abort'?'DELETE':'POST';
   if(req.method!==method)throw taskFault('METHOD_NOT_ALLOWED');
   if((req.rawHeaders??[]).filter((v,i)=>i%2===0&&v.toLowerCase()==='authorization').length!==1)throw taskFault('UNAUTHORIZED');
   if(active>=8)throw taskFault('DB_UNAVAILABLE');active++;counted=true;
   const actor=await queue.authenticate(req.headers.authorization);let runId=null,leaseToken=null;
   if(run||file){runId=(run??file)[1];leaseToken=req.headers['x-village-lease'];if(!uuid(runId)||!uuid(leaseToken)||(req.rawHeaders??[]).filter((v,i)=>i%2===0&&v.toLowerCase()==='x-village-lease').length!==1)throw taskFault('INVALID_INPUT');}
   if(file){
    if(['input','artifact'].includes(action)){
     const opened=action==='input'?await files.openInput(actor,runId,leaseToken):await files.openArtifact(actor,runId,leaseToken,{artifactType:file[3]});
     try{const range=byteRange(req.headers.range,opened.size);if(!range){status=416;res.writeHead(416,{'Content-Range':'bytes */'+opened.size,'Cache-Control':'no-store'});res.end();return;}
      status=range.status;res.writeHead(status,{'Content-Type':opened.mime,'Content-Length':range.end-range.start+1,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','ETag':'"'+opened.sha256+'"','X-Request-Id':requestId,...(status===206?{'Content-Range':`bytes ${range.start}-${range.end}/${opened.size}`}:{})});await pipeline(opened.stream(range),res);return;
     }finally{await opened.close();}
    }
    let input;
    if(action==='chunk'){
     if(req.headers['content-type']!=='application/octet-stream'||req.headers['content-encoding'])throw taskFault('UNSUPPORTED_MEDIA_TYPE');
     const length=req.headers['content-length'];if(typeof length!=='string'||!/^\d{1,7}$/.test(length)||Number(length)<1||Number(length)>8388608)throw taskFault('PAYLOAD_TOO_LARGE');
     input={uploadId:file[4],index:Number(file[6]),size:Number(length),sha256:req.headers['x-village-sha256']};
     const value=await files.put(actor,runId,leaseToken,input,req.iterator({destroyOnReturn:false}));req.resume();send(200,{data:value});return;
    }
    input=action==='begin'?await body(req):{uploadId:file[4]};if(action==='commit'){const parsed=await body(req);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'||Object.keys(parsed).length)throw taskFault('INVALID_INPUT');}
    send(200,{data:await files[action](actor,runId,leaseToken,input)});return;
   }
   const payload=req.method==='GET'?{}:await body(req);send(200,{data:await queue.workerCall(actor,action,runId,leaseToken,payload)});
  }catch(error){const safe=taskFault(error?.code);send(safe.status,{error:{code:safe.code,requestId}});if(req.readable&&!req.complete){req.setTimeout(1000,()=>req.destroy());req.resume();}}
  finally{if(counted)active--;log({requestId,action,status});}
 };
}
