import pg from 'npm:pg@8.23.1';
import {RPC_NAMES,sha256} from './core.mjs';
import {fail,readBounded} from './security.mjs';

export function sourceAdapters(instanceId:string){
 const origin=Deno.env.get('SUPABASE_URL')??'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(origin)||!key)throw Error('BRIDGE_CONFIGURATION_REQUIRED');
 const connectionString=Deno.env.get('ALIYUN_BRIDGE_DATABASE_URL')??'',ca=Deno.env.get('ALIYUN_BRIDGE_DB_CA')??'';
 const url=new URL(connectionString);
 if(url.username!=='village_aliyun_transport'||!ca.includes('BEGIN CERTIFICATE'))throw Error('DEDICATED_BRIDGE_DATABASE_CONFIGURATION_REQUIRED');
 const pool=new pg.Pool({connectionString,ssl:{rejectUnauthorized:true,ca},max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
 const database={async call(operation:string,input:unknown){
  if(!RPC_NAMES.includes(operation))throw fail('INVALID_INPUT');const c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SET LOCAL ROLE village_aliyun_bridge;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='3s'");
   const result=(await c.query('SELECT aliyun_bridge.'+operation+'($1,$2::jsonb) data',[instanceId,JSON.stringify(input)])).rows[0]?.data;await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw fail(error.code==='P0001'?error.message:error.code==='42501'?'FORBIDDEN':['22P02','23514','22003'].includes(error.code)?'INVALID_INPUT':'BRIDGE_UNAVAILABLE');}finally{c.release();}
 }};
 const encoded=(path:string)=>path.split('/').map(encodeURIComponent).join('/');
 const authHeaders={authorization:'Bearer '+key,apikey:key};
 const storageFetch=(path:string,init:RequestInit={})=>fetch(origin+'/storage/v1/'+path,{...init,headers:{...authHeaders,...init.headers},redirect:'error',signal:AbortSignal.timeout(30000)});
 const storage={
  async putInput(path:string,bytes:Uint8Array,mime:string){
   const response=await storageFetch('object/aliyun-task-inputs/'+encoded(path),{method:'POST',headers:{'content-type':mime,'x-upsert':'false'},body:bytes});
   if(response.ok)return;
   if(![400,409].includes(response.status))throw fail('BRIDGE_UNAVAILABLE');
   const old=await storageFetch('object/authenticated/aliyun-task-inputs/'+encoded(path));if(!old.ok)throw fail('BRIDGE_UNAVAILABLE');
   const prior=await readBounded(old,10485760);if(prior.length!==bytes.length||await sha256(prior)!==await sha256(bytes))throw fail('REVISION_CONFLICT');
  },
  async signInput(photo:{path:string,sha256:string,mime:string,size:number}){
   if(!new RegExp('^'+instanceId+'/photos/[a-f0-9-]{36}/[a-f0-9]{64}\\.(jpg|png)$').test(photo.path))throw fail('FORBIDDEN');
   const response=await storageFetch('object/sign/aliyun-task-inputs/'+encoded(photo.path),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expiresIn:120})});
   const body=await response.json();if(!response.ok)throw fail('BRIDGE_UNAVAILABLE');
   const value=String(body.signedURL??body.signedUrl??'');const signed=new URL(value.startsWith('/object/sign/')?'/storage/v1'+value:value,origin);
   if(signed.origin!==origin||signed.pathname!=='/storage/v1/object/sign/aliyun-task-inputs/'+encoded(photo.path)||signed.username||signed.password||signed.hash||[...signed.searchParams.keys()].some(k=>k!=='token')||!signed.searchParams.get('token'))throw fail('FORBIDDEN');return signed.href;
  },
  async openArtifact({ownerId,runId,kind,artifact}:any){
   const path=String(artifact.storage_path??''),bucket=kind==='geo'?'geoprocessing-results':'facade-generation',prefix=kind==='cloud-facade'?`${ownerId}/cloud/${runId}/`:`${ownerId}/${runId}/`;
   if(!path.startsWith(prefix)||path.includes('..')||/[^a-zA-Z0-9_./-]/.test(path)||!/^[a-f0-9]{64}$/.test(artifact.sha256??''))throw fail('FORBIDDEN');
   const response=await storageFetch('object/authenticated/'+bucket+'/'+encoded(path));if(!response.ok)throw fail('NOT_FOUND');
   const size=Number(response.headers.get('content-length')),mime=response.headers.get('content-type')?.split(';')[0]??'',limit=kind==='geo'?52428800:artifact.artifact_type==='model_glb'?52428800:10485760;
   if(!Number.isSafeInteger(size)||size<=0||size>limit||!['application/json','application/geo+json','image/png','image/jpeg','model/gltf-binary','application/octet-stream'].includes(mime)){await response.body?.cancel();throw fail('INVALID_FILE');}
   return new Response(response.body,{headers:{'content-type':mime,'content-length':String(size),'x-bridge-sha256':artifact.sha256,'cache-control':'no-store'}});
  },
  async persistOutput(job:any,output:string){
   const target=new URL(output),allowed=(Deno.env.get('DASHSCOPE_OUTPUT_HOSTS')??'dashscope-result-bj.oss-cn-beijing.aliyuncs.com,dashscope-result-sgp.oss-ap-southeast-1.aliyuncs.com').split(',');
   if(target.protocol!=='https:'||target.port||target.username||target.password||!allowed.includes(target.hostname)||!target.hostname.endsWith('.aliyuncs.com'))throw fail('INVALID_FILE');
   const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw fail('PROVIDER_UNAVAILABLE');
   const mime=response.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg'].includes(mime??''))throw fail('INVALID_FILE');
   const bytes=await readBounded(response,10485760),png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   if(!(mime==='image/png'?png:jpg))throw fail('INVALID_FILE');
   const digest=await sha256(bytes),path=`${job.ownerId}/cloud/${job.runId}/${digest}.${mime==='image/png'?'png':'jpg'}`;
   const stored=await storageFetch('object/facade-generation/'+encoded(path),{method:'POST',headers:{'content-type':mime,'x-upsert':'false'},body:bytes});if(!stored.ok){const prior=await storageFetch('object/authenticated/facade-generation/'+encoded(path));if(!prior.ok||await sha256(await readBounded(prior,10485760))!==digest)throw fail('BRIDGE_UNAVAILABLE');}
   return {path,sha256:digest,size:bytes.length,mime};
  }
 };
 return {database,storage};
}
