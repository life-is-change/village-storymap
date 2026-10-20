import pg from 'pg';
import {UUID} from '../src/contracts.mjs';
import {AUTH_ORIGIN} from '../src/config.mjs';
import {resolveAuthPolicy} from '../auth/policy.mjs';
import {fault} from './contracts.mjs';
import {measure} from './metrics.mjs';

export function poolOptions(config) {
  const allowed=['host','port','database','user','password'];
  if(!config||Object.keys(config).some(k=>!allowed.includes(k))||typeof config.host!=='string'||!/^[a-zA-Z0-9.-]+$/.test(config.host)||
    !Number.isInteger(config.port)||config.port<1||config.port>65535||config.database!=='village_unified_candidate'||config.user!=='village_unified_login'||
    typeof config.password!=='string'||config.password.length<24||config.password.length>256||/\s/.test(config.password))throw Error('INVALID_CONFIGURATION');
  return {...config,max:4,connectionTimeoutMillis:3000,idleTimeoutMillis:30000,allowExitOnIdle:true};
}
function safeError(error){
  if(error?.code==='42501')return fault('FORBIDDEN');
  if(error?.code==='23505')return fault('REVISION_CONFLICT');
  if(['23503','23514','22P02'].includes(error?.code))return fault('INVALID_INPUT');
  if(error?.code==='P0001'){
    if(['CURRENT_VERSION_DELETE_FORBIDDEN','GROUP_MEMBERSHIP_REQUIRED','PROJECT_SPACE_CONTEXT_MISMATCH','FEATURE_LOCK_REQUIRED','SPACE_READONLY','PROJECT_ACCESS_REQUIRED','ADMIN_REQUIRED','STAFF_REQUIRED','VILLAGE_IN_USE','SYSTEM_VILLAGE_PROTECTED','ACTIVE_FORMAL_VILLAGE_REQUIRED'].includes(error.message))return fault('FORBIDDEN');
    if(['INVALID_VILLAGE_BOUNDARY','VILLAGE_BOUNDARY_REQUIRED','INVALID_SOURCE_KIND','INVALID_LAYER_MANIFEST','ARBITRARY_DATASET_URL_FORBIDDEN','INVALID_DATASET_STATUS','DATASET_VALIDATION_REQUIRED','INVALID_ION_ASSET_ID','INVALID_HEIGHT_OFFSET','INVALID_REALITY_MODEL_STATUS'].includes(error.message))return fault('INVALID_INPUT');
  }
  if(error?.code==='P0001'&&['GEOMETRY_REVISION_CONFLICT','FEATURE_REVISION_CONFLICT','BASELINE_VERSION_CONFLICT','PERSONAL_LAYER_VERSION_STALE','CONFLICT_ALREADY_RESOLVED','GROUP_SPACE_BUSY','ACTIVE_FEATURE_LOCKS'].includes(error.message))return fault('REVISION_CONFLICT');
  const known=['PROJECT_SUBMITTED','BASELINE_MISMATCH','FILE_SCOPE_MISMATCH','UNSUPPORTED_MEDIA_TYPE','METHOD_NOT_ALLOWED','UNAUTHORIZED','FORBIDDEN','PROFILE_NOT_SYNCED','PROFILE_DISABLED','REVISION_CONFLICT','INVALID_INPUT','NOT_FOUND','PAYLOAD_TOO_LARGE','NOT_IMPLEMENTED','FILE_IN_USE','UPLOAD_CONFLICT','UPLOAD_EXPIRED','FILES_NOT_READY','FILE_TOO_LARGE','FILE_TYPE_UNSUPPORTED','INVALID_FILE','FILE_BUSY','FILE_UNAVAILABLE','QUOTA_EXCEEDED','RATE_LIMITED'];
  if(error?.code==='P0001'&&['SOURCE_NOT_READY','WORKER_OFFLINE','TOO_MANY_ACTIVE_RUNS','BRIDGE_UNAVAILABLE'].includes(error.message))return Object.assign(Error(error.message),{code:error.message,status:error.message==='SOURCE_NOT_READY'?409:error.message==='TOO_MANY_ACTIVE_RUNS'?429:503});
  if(error?.code==='P0001'&&known.includes(error.message))return fault(error.message);
  if(known.includes(error?.code)){
    const result=fault(error.code);
    if(error.code==='REVISION_CONFLICT'&&Number.isSafeInteger(error.remoteRevision)&&error.remoteRevision>=0)result.remoteRevision=error.remoteRevision;
    return result;
  }
  return fault('DB_UNAVAILABLE');
}
export function createUnifiedDatabase(config,{authPolicy={authOrigin:AUTH_ORIGIN}}={}) {
  const policy=resolveAuthPolicy(authPolicy);
  const supplied=config?.pool;
  if(supplied?.options?.max!==undefined&&supplied.options.max>4)throw Error('INVALID_CONFIGURATION');
  const pool=supplied??new pg.Pool(poolOptions(config));
  const now=config?.now??Date.now;
  pool.on?.('error',()=>{});
  let closing;
  function valid(identity){return typeof identity?.userId==='string'&&UUID.test(identity.userId)&&identity.userId===identity.userId.toLowerCase()&&identity.issuer===policy.issuer&&Number.isSafeInteger(identity.expiry)&&identity.expiry>Math.floor(now()/1000)&&(policy.mode!=='local'||UUID.test(identity.sessionId??''));}
  async function localSession(client,identity){return (await client.query('SELECT api_private.local_auth_session_active($1,$2) AS active',[identity.userId,identity.sessionId])).rows[0]?.active===true;}
  const transaction=(identity,fn,options)=>measure('sql',()=>runTransaction(identity,fn,options));
  async function runTransaction(identity,fn,{readOnly=false}={}){
    if(identity&&!valid(identity))throw fault('UNAUTHORIZED');
    if(closing||typeof fn!=='function')throw fault('DB_UNAVAILABLE');
    let client,discard;
    try{
      client=await pool.connect();
      await client.query(readOnly?'BEGIN READ ONLY':'BEGIN');
      await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='10s'; SET LOCAL search_path=public,extensions");
      if(identity){
        if(policy.mode==='local'&&!await localSession(client,identity))throw fault('UNAUTHORIZED');
        await client.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[
          JSON.stringify({sub:identity.userId,role:'authenticated',aud:'authenticated',iss:identity.issuer}),identity.userId]);
        await client.query('SET LOCAL ROLE authenticated');
        const status=(await client.query('SELECT api_private.profile_status() AS status')).rows[0]?.status;
        if(status!=='active')throw fault(status==='disabled'?'PROFILE_DISABLED':'PROFILE_NOT_SYNCED');
      }
      const result=await fn(client);
      if(identity&&!valid(identity))throw fault('UNAUTHORIZED');
      await client.query('COMMIT');return result;
    }catch(error){
      if(client)try{await client.query('ROLLBACK');}catch{discard=Error('DISCARD_CONNECTION');}
      throw safeError(error);
    }finally{client?.release(discard);}
  }
  return {
    async checkLocalSession(identity){if(policy.mode!=='local'||!valid(identity))return false;return transaction(null,client=>localSession(client,identity),{readOnly:true});},
    withIdentity:async(identity,fn,options)=>{if(!valid(identity))throw fault('UNAUTHORIZED');return transaction(identity,fn,options);},
    withMaintenance:fn=>transaction(null,fn),
    verifyInstallation:()=>transaction(null,async client=>{
      const version=(await client.query('SELECT api_private.installation_version() AS version')).rows[0]?.version;
      if(version!==1)throw fault('DB_UNAVAILABLE');return version;
    },{readOnly:true}),
    close(){return closing??(closing=Promise.resolve().then(()=>pool.end()));}
  };
}
