import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {parseSpaceQuery,parseSpaceId,publicError,invalid} from './contracts.mjs';
import {failure,safeFailure} from './errors.mjs';
import {UUID} from './contracts.mjs';
import {byteRange,fileType} from './storage.mjs';
import {pipeline} from 'node:stream/promises';
export function createHandler({verifyIdentity,database,repository,storage,requestId=randomUUID,log=()=>{}}){
 return async(req,res)=>{
  const id=requestId();const started=performance.now();let authMs=0,dbMs=0,status=200;
  const send=(s,data)=>{status=s;if(!res.destroyed&&!res.writableEnded){res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':id});res.end(JSON.stringify(data));}};
  try{
   if(req.url.length>8192)throw invalid();
   const url=new URL(req.url,'http://internal');const path=url.pathname;
   if(path==='/healthz'){if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED');return send(200,{status:'ok'});}
   const match=/^\/api\/v1\/spaces\/(group|personal)\/([^/]+)$/.exec(path);
   const file=storage&&/^\/api\/v1\/files\/([^/]+)$/.exec(path);
   if(!['/api/v1/me','/api/v1/courses','/api/v1/spaces'].includes(path)&&!match&&!file)throw failure('NOT_FOUND');
   if(req.method!=='GET'&&!(file&&req.method==='HEAD'))throw failure('METHOD_NOT_ALLOWED');
   const headers=req.rawHeaders??[];
   if(headers.filter((v,i)=>i%2===0&&v.toLowerCase()==='authorization').length>1)throw failure('UNAUTHORIZED');
   const a=performance.now();const identity=await verifyIdentity(req.headers.authorization);authMs=performance.now()-a;
   const query=path==='/api/v1/spaces'?parseSpaceQuery(url.searchParams):null;
   if(!query&&url.search)throw invalid();
   if(file){
    if(!UUID.test(file[1]))throw invalid();
    const d=performance.now();
    const object=await database.withIdentity(identity,async client=>{await repository.getMe(client,identity.userId);return repository.getStorageObject(client,file[1].toLowerCase());});dbMs=performance.now()-d;
    if(!object)throw failure('NOT_FOUND');
    const content=await storage.open(object);
    try{
     const range=byteRange(req.headers.range,content.size);
     const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':id,'Accept-Ranges':'bytes',
      'Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':'attachment; filename="object"',
      'Content-Type':fileType(content.name),'ETag':'"sha256-'+content.sha256+'"'};
     if(!range){status=416;res.writeHead(416,{...headers,'Content-Range':'bytes */'+content.size,'Content-Length':'0'});res.end();return;}
     status=range.status;headers['Content-Length']=String(Math.max(0,range.end-range.start+1));
     if(status===206)headers['Content-Range']=`bytes ${range.start}-${range.end}/${content.size}`;
     if(res.destroyed)return;
     res.writeHead(status,headers);
     if(req.method==='HEAD'){res.end();return;}
     await pipeline(content.stream(range),res);return;
    }finally{await content.close();}
   }
   let key;if(match){try{key=parseSpaceId(match[1],decodeURIComponent(match[2]));}catch{throw invalid();}}
   const d=performance.now();
   const data=await database.withIdentity(identity,async client=>{
    const me=await repository.getMe(client,identity.userId);
    if(path==='/api/v1/me')return me;
    if(path==='/api/v1/courses')return repository.listCourses(client);
    if(query)return repository.listSpaces(client,query,identity.userId);
    const value=await repository.getSpace(client,match[1],key,identity.userId);
    if(!value)throw failure('NOT_FOUND');return value;
   });dbMs=performance.now()-d;send(200,{data});
  }catch(error){const safe=safeFailure(error);if(res.headersSent){status=safe.status;res.destroy();}else send(safe.status,publicError(safe.code,id));}
  finally{log({event:'request',requestId:id,status,authMs:Math.round(authMs),dbMs:Math.round(dbMs),totalMs:Math.round(performance.now()-started)});}
 };
}
