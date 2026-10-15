import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {parseSpaceQuery,parseSpaceId,publicError,invalid} from './contracts.mjs';
import {failure,safeFailure} from './errors.mjs';
export function createHandler({verifyIdentity,database,repository,requestId=randomUUID,log=()=>{}}){
 return async(req,res)=>{
  const id=requestId();const started=performance.now();let authMs=0,dbMs=0,status=200;
  const send=(s,data)=>{status=s;if(!res.destroyed&&!res.writableEnded){res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':id});res.end(JSON.stringify(data));}};
  try{
   if(req.url.length>8192)throw invalid();
   const url=new URL(req.url,'http://internal');const path=url.pathname;
   if(path==='/healthz'){if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED');return send(200,{status:'ok'});}
   const match=/^\/api\/v1\/spaces\/(group|personal)\/([^/]+)$/.exec(path);
   if(!['/api/v1/me','/api/v1/courses','/api/v1/spaces'].includes(path)&&!match)throw failure('NOT_FOUND');
   if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED');
   const headers=req.rawHeaders??[];
   if(headers.filter((v,i)=>i%2===0&&v.toLowerCase()==='authorization').length>1)throw failure('UNAUTHORIZED');
   const a=performance.now();const identity=await verifyIdentity(req.headers.authorization);authMs=performance.now()-a;
   const query=path==='/api/v1/spaces'?parseSpaceQuery(url.searchParams):null;
   if(!query&&url.search)throw invalid();
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
  }catch(error){const safe=safeFailure(error);send(safe.status,publicError(safe.code,id));}
  finally{log({event:'request',requestId:id,status,authMs:Math.round(authMs),dbMs:Math.round(dbMs),totalMs:Math.round(performance.now()-started)});}
 };
}
