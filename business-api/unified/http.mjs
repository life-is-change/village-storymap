import {randomUUID} from 'node:crypto';import {pipeline} from 'node:stream/promises';
import {requestMetrics,measure,snapshot,serverTiming} from './metrics.mjs';
import {OPERATIONS,parseOperation,MAX_JSON_BYTES,fault} from './contracts.mjs';import {byteRange} from '../src/storage.mjs';
const paths=new Map(Object.entries(OPERATIONS).map(([action,value])=>[value.path,{action,...value}]));
const statuses={METHOD_NOT_ALLOWED:405,UNSUPPORTED_MEDIA_TYPE:415,API_BUSY:503,UNAUTHORIZED:401,FORBIDDEN:403,NOT_FOUND:404,INVALID_INPUT:400,PAYLOAD_TOO_LARGE:413,DB_UNAVAILABLE:503,AUTH_UNAVAILABLE:503,PROFILE_NOT_SYNCED:403,PROFILE_DISABLED:403,PROJECT_SUBMITTED:409,BASELINE_MISMATCH:409,FILE_SCOPE_MISMATCH:403,REVISION_CONFLICT:409,NOT_IMPLEMENTED:501,RATE_LIMITED:429,FILE_IN_USE:409,UPLOAD_CONFLICT:409,UPLOAD_EXPIRED:410,FILES_NOT_READY:409,FILE_TOO_LARGE:413,FILE_TYPE_UNSUPPORTED:415,INVALID_FILE:422,FILE_BUSY:503,FILE_UNAVAILABLE:503,QUOTA_EXCEEDED:507,SOURCE_NOT_READY:409,WORKER_OFFLINE:503,TOO_MANY_ACTIVE_RUNS:429,BRIDGE_UNAVAILABLE:503};
const fail=code=>Object.assign(Error(code),{code,status:statuses[code]??503});
async function jsonBody(req){
 if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json'||req.headers['content-encoding'])throw fail('UNSUPPORTED_MEDIA_TYPE');
 const length=req.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_JSON_BYTES))throw fail('PAYLOAD_TOO_LARGE');
 let size=0;const parts=[];for await(const chunk of req.iterator({destroyOnReturn:false})){if((size+=chunk.length)>MAX_JSON_BYTES)throw fail('PAYLOAD_TOO_LARGE');parts.push(chunk);}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{throw fail('INVALID_INPUT');}
}
async function sendFile(req,res,opened,requestId){
 try{const range=byteRange(req.headers.range,opened.size);if(!range){res.writeHead(416,{'Content-Range':'bytes */'+opened.size,'Cache-Control':'private, no-store'});res.end();return;}
  const headers={'Content-Type':opened.mime,'Content-Length':range.end-range.start+1,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','X-Request-Id':requestId};
  if(opened.sha256)headers.ETag='"'+opened.sha256+'"';if(range.status===206)headers['Content-Range']=`bytes ${range.start}-${range.end}/${opened.size}`;
  if(['original','low-original'].includes(opened.role))headers['Content-Disposition']='attachment; filename="original.'+opened.extension+'"';
  res.writeHead(range.status,headers);if(req.method==='HEAD'){res.end();return;}await pipeline(opened.stream(range),res);
 }finally{await opened.close();}
}
export function createUnifiedHandler({services,verifyIdentity,release,sceneHandler,log=()=>{}}){
 let requests=0;
 return (req,res)=>requestMetrics(async()=>{
  const requestId=randomUUID(),started=performance.now();let status=200,action='unmatched',counted=false;
  const originalWriteHead=res.writeHead;res.writeHead=function(code,...args){status=code;this.setHeader('Server-Timing',serverTiming());return originalWriteHead.call(this,code,...args);};
  const send=(code,value)=>{status=code;if(!res.headersSent&&!res.destroyed){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId});res.end(JSON.stringify(value));}};
  try{
   if(typeof req.url!=='string'||req.url.length>8192)throw fail('INVALID_INPUT');const url=new URL(req.url,'http://internal'),path=url.pathname;
   if(req.url==='/healthz'){if(req.method!=='GET')throw fail('METHOD_NOT_ALLOWED');return send(200,{status:'ok',releaseId:release.releaseId,instanceId:release.instanceId});}
   const route=paths.get(path),file=/^\/api\/v1\/files\/([a-f0-9-]{36})$/.exec(path),taskFile=/^\/api\/v1\/tasks\/([a-f0-9-]{36})\/artifacts\/([a-z_]+)$/.exec(path),session=/^\/api\/v1\/files\/sessions(?:\/([a-f0-9-]{36})(?:\/(commit|[a-zA-Z0-9_.-]+))?)?$/.exec(path),resolve=path==='/api/v1/files/resolve-path',events=path==='/api/v1/events';
   if(path.startsWith('/api/v1/scene-files/')){
    if(!sceneHandler||path==='/api/v1/scene-files/scene/version'||url.search)throw fail('NOT_FOUND');
    if(requests>=32)throw fail('API_BUSY');requests++;counted=true;action='scene';return await sceneHandler(req,res);
   }
   if(!route&&!file&&!taskFile&&!session&&!resolve&&!events)throw fail('NOT_FOUND');
   if(!events){if(requests>=32)throw fail('API_BUSY');requests++;counted=true;}
   const allowed=route?[route.method]:(file||taskFile?['GET','HEAD']:events?['GET']:session?.[1]?(session[2]==='commit'?['POST']:session[2]?['PUT']:['GET']):['POST']);if(!allowed.includes(req.method))throw fail('METHOD_NOT_ALLOWED');
   const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length||keys.some(key=>!(events?['contexts','cursor']:taskFile?['sha256']:[]).includes(key)))throw fail('INVALID_INPUT');
   if((req.rawHeaders??[]).filter((v,i)=>i%2===0&&v.toLowerCase()==='authorization').length!==1)throw fail('UNAUTHORIZED');
   const identity=await measure('auth',()=>verifyIdentity(req.headers.authorization));
   if(route){action=route.action;const input=req.method==='GET'?{}:await jsonBody(req);parseOperation(action,input);return send(200,{data:await services.execute(identity,action,input)});}
   if(file){action='files.read';return await sendFile(req,res,await services.files.read(identity,file[1]),requestId);}
   if(taskFile){action='tasks.file';const hash=url.searchParams.get('sha256');if(hash!==null&&!/^[a-f0-9]{64}$/.test(hash))throw fail('INVALID_INPUT');return await sendFile(req,res,await services.taskFiles.readTaskArtifact(identity,taskFile[1],taskFile[2],hash?{sha256:hash}:{}),requestId);}
   if(resolve){action='files.resolve';const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['bucket','path'].includes(k)))throw fail('INVALID_INPUT');return send(200,{data:await services.files.resolvePath(identity,input.bucket,input.path)});}
   if(session){action='files.session';const [,id,tail]=session;
    if(!id)return send(200,{data:await services.files.begin(identity,await jsonBody(req))});
    if(!tail)return send(200,{data:await services.files.status(identity,id)});
    if(tail==='commit')return send(200,{data:await services.files.commit(identity,id,await jsonBody(req))});
    if(req.headers['content-encoding']||req.headers['content-type']!=='application/octet-stream')throw fail('UNSUPPORTED_MEDIA_TYPE');
    const size=req.headers['content-length'];if(!/^\d+$/.test(size??'')||Number(size)>50*1024**2)throw fail('PAYLOAD_TOO_LARGE');return send(200,{data:await services.files.put(identity,id,tail,req)});
   }
   action='events';let contexts;try{contexts=JSON.parse(url.searchParams.get('contexts'));}catch{throw fail('INVALID_INPUT');}const stream=await services.events.open(identity,contexts,url.searchParams.get('cursor'));
   const stop=()=>void stream.return();res.once('close',stop);
   try{res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'});res.flushHeaders();for await(const event of stream){if(res.destroyed)break;if(!res.write(`event: ${event.event}\nid: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}}finally{res.off('close',stop);await stream.return();if(!res.writableEnded)res.end();}
  }catch(e){const code=Object.hasOwn(statuses,e?.code)?e.code:'DB_UNAVAILABLE';send(statuses[code],{error:{code,requestId,...(code==='REVISION_CONFLICT'&&Number.isSafeInteger(e.remoteRevision)&&e.remoteRevision>=0?{remoteRevision:e.remoteRevision}:{})}});if(res.headersSent&&!res.writableEnded)res.destroy();if(req.readable&&!req.complete){req.setTimeout(1000,()=>req.destroy());req.resume();}}
  finally{if(counted)requests--;log({requestId,action,status,durationMs:Math.round(performance.now()-started),...snapshot()});}
 });
}
export function closeUnifiedServices(services){let pending;return ()=>pending??(pending=(async()=>{await services.events.close();await services.tasks.close();await services.database.close();})());}
