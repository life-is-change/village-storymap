import pg from 'pg';import {uuid,fault} from './contracts.mjs';
function mapped(e){const source=String(e?.message??'');const codes={FILES_FORBIDDEN:'FORBIDDEN',FILES_CONFLICT:'UPLOAD_CONFLICT',FILES_EXPIRED:'UPLOAD_EXPIRED',SCENE_EDIT_ASSET_SCOPE_INVALID:'FORBIDDEN',SCENE_EDIT_ASSET_PUBLISH_REQUIRED:'FORBIDDEN',SCENE_EDIT_FORBIDDEN:'FORBIDDEN'};return e?.status?e:fault(codes[source]??'DB_UNAVAILABLE');}
export function createSceneFilesDatabase(config){
 const pool=config.pool??new pg.Pool({...config,max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:30000});pool.on?.('error',()=>{});
 async function transaction(identity,fn){let c,discard;try{if(identity&&!uuid(identity.userId))throw fault('UNAUTHORIZED');c=await pool.connect();await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='10s'");
  if(identity){await c.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify({sub:identity.userId,role:'authenticated',aud:'authenticated'}),identity.userId]);await c.query('SET LOCAL ROLE authenticated');if(!(await c.query('SELECT id FROM public.profiles WHERE id=$1',[identity.userId])).rows.length)throw fault('PROFILE_NOT_SYNCED');}
  const value=await fn(c);await c.query('COMMIT');return value;
 }catch(e){if(c)try{await c.query('ROLLBACK');}catch{discard=new Error('discard');}throw mapped(e);}finally{c?.release(discard);}}
 return {withIdentity:(id,fn)=>transaction(id,fn),withMaintenance:fn=>transaction(null,fn),close:()=>pool.end()};
}
export async function queryOne(c,sql,args=[]){return (await c.query(sql,args)).rows[0]?.data;}
