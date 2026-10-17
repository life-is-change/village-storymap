import {randomUUID} from 'node:crypto';
import {parseOperation} from './contracts.mjs';
import {error,safeError} from './errors.mjs';
const MAX=2*1024*1024;
async function readBody(req){
 if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json'||req.headers['content-encoding'])throw error('UNSUPPORTED_MEDIA_TYPE');
 if(Number(req.headers['content-length']??0)>MAX)throw error('PAYLOAD_TOO_LARGE');
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>MAX)throw error('PAYLOAD_TOO_LARGE');chunks.push(chunk);}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw error('INVALID_INPUT');}
}
export function createSceneHandler({verifyIdentity,database}){
 return async(req,res)=>{
  const requestId=randomUUID();
  const send=(status,value)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId});res.end(JSON.stringify(value));}};
  try{
   if(req.url==='/healthz'){if(req.method!=='GET')throw error('METHOD_NOT_ALLOWED');return send(200,{status:'ok'});}
   const match=/^\/api\/v1\/scene\/(find|create|load|save|versions|branch|version|restore|submit)$/.exec(req.url??'');if(!match)throw error('NOT_FOUND');
   if(req.method!=='POST')throw error('METHOD_NOT_ALLOWED');
   if((req.rawHeaders??[]).filter((v,i)=>i%2===0&&v.toLowerCase()==='authorization').length!==1)throw error('UNAUTHORIZED');
   const identity=await verifyIdentity(req.headers.authorization);
   const input=await readBody(req);parseOperation(match[1],input);
   send(200,{data:await database.run(identity,match[1],input)});
  }catch(e){const safe=safeError(e);send(safe.status,{error:{code:safe.code,requestId,...(safe.remoteRevision!==undefined?{remoteRevision:safe.remoteRevision}:{})}});}
 };
}
