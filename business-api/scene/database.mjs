import pg from 'pg';
import {UUID} from '../src/contracts.mjs';
import {parseOperation,validateDocument} from './contracts.mjs';
import {error,safeError} from './errors.mjs';
async function one(client,sql,args){return (await client.query(sql,args)).rows[0]?.data;}
async function load(client,id){return one(client,'SELECT public.scene_edit_load_project($1::uuid) AS data',[id]);}
async function lock(client,id){await client.query('SELECT public.scene_candidate_lock($1::uuid)',[id]);return load(client,id);}
async function version(client,id){
 const row=(await client.query('SELECT project_id,document,preview_path FROM public.scene_edit_versions WHERE id=$1::uuid',[id])).rows[0];
 if(!row)throw error('FORBIDDEN');return row;
}
export async function executeOperation(c,op,i,identity){
 if(op==='find')return (await c.query(`SELECT id,revision,updated_at FROM public.scene_edit_projects
  WHERE teaching_project_id=$1::uuid AND village_id=$2::uuid AND space_id=$3 AND scope_kind=$4
  AND group_id IS NOT DISTINCT FROM $5::text AND ($4<>'admin_sandbox' OR created_by=$6::uuid)
  AND status='draft' ORDER BY updated_at DESC,id LIMIT 1`,[i.teachingProjectId,i.villageId,i.spaceId,i.scopeKind,i.groupId,identity.userId])).rows[0]??null;
 if(op==='load')return load(c,i.projectId);
 if(op==='versions')return (await c.query('SELECT * FROM public.scene_edit_versions WHERE project_id=$1::uuid ORDER BY created_at DESC,id LIMIT 100',[i.projectId])).rows;
 if(op==='create')return one(c,'SELECT public.scene_edit_create_project($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::bigint,$7::jsonb,$8::text) AS data',
  [i.teachingProjectId,i.villageId,i.spaceId,i.groupId,i.title,i.baselineRevision,JSON.stringify(i.selectionBoundary??null),i.scopeKind]);
 let current;
 if(op==='restore'||op==='submit'){
  const v=await version(c,i.versionId);current=await lock(c,v.project_id);
  // A legacy preview lives outside document JSON. Do not submit an unreadable
  // reference or silently drop it while restoring in this file-free stage.
  if(v.preview_path!==null)throw error('FILES_NOT_READY');
  validateDocument(v.document);
 }else current=await lock(c,op==='save'?i.document.projectId:i.projectId);
 // C1 supports built-in scene elements only. Existing file-backed documents
 // must not become writable before the C2 resolver/upload lifecycle is ready.
 validateDocument(current);
 if(op==='save'){
  const d=i.document;
  for(const key of ['villageId','groupId'])if(d[key]!==current[key])throw error('BASELINE_MISMATCH');
  if(d.baselineRef.spaceId!==current.baselineRef.spaceId||d.baselineRef.revision!==current.baselineRef.revision||
   d.metadata.scopeKind!==current.metadata.scopeKind||d.metadata.ownerId!==current.metadata.ownerId)throw error('BASELINE_MISMATCH');
  return one(c,'SELECT public.scene_edit_save_draft($1::uuid,$2::bigint,$3::jsonb) AS data',[d.projectId,d.revision,JSON.stringify(d)]);
 }
 if(op==='branch')return one(c,'SELECT public.scene_edit_branch_project($1::uuid,$2::bigint,$3::text) AS data',[i.projectId,i.baselineRevision,i.title]);
 if(op==='version')return one(c,'SELECT public.scene_edit_create_version($1::uuid,$2::bigint,$3::text,$4::text,NULL::text) AS data',[i.projectId,i.revision,i.label,i.description??'']);
 if(op==='restore')return one(c,'SELECT public.scene_edit_restore_version($1::uuid,$2::text) AS data',[i.versionId,i.title]);
 if(op==='submit')return one(c,'SELECT public.scene_edit_submit_version($1::uuid) AS data',[i.versionId]);
 throw error('NOT_FOUND');
}
export function createSceneDatabase(config){
 const pool=config.pool??new pg.Pool({...config,max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:30000});pool.on?.('error',()=>{});
 return {async run(identity,op,input){
  if(!UUID.test(identity?.userId??''))throw error('UNAUTHORIZED');
  const {readOnly}=parseOperation(op,input);let c,discard;
  try{
   c=await pool.connect();await c.query(readOnly?'BEGIN READ ONLY':'BEGIN');
   await c.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='10s'");
   await c.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify({sub:identity.userId,role:'authenticated',aud:'authenticated'}),identity.userId]);
   await c.query('SET LOCAL ROLE authenticated');
   const me=(await c.query('SELECT id FROM public.profiles WHERE id=$1::uuid',[identity.userId])).rows[0];if(!me)throw error('PROFILE_NOT_SYNCED');
   const result=await executeOperation(c,op,input,identity);await c.query('COMMIT');return result;
  }catch(e){if(c)try{await c.query('ROLLBACK');}catch{discard=new Error('DISCARD_CONNECTION');}throw safeError(e);}
  finally{c?.release(discard);}
 },close:()=>pool.end()};
}
