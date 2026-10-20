import {createHmac} from 'node:crypto';
import {SignJWT} from 'jose';
import {UUID} from '../src/contracts.mjs';
import {createIdentityVerifier} from '../src/auth.mjs';
import {fault} from '../unified/contracts.mjs';

const policy=Object.freeze({authMode:'local',authOrigin:'https://8.148.248.237',authInternalOrigin:'http://auth:9999'});
const unknown=()=>Object.assign(Error('RECOVERY_UNKNOWN'),{code:'RECOVERY_UNKNOWN'});
const validStudent=value=>typeof value==='string'&&/^[a-z0-9_-]{2,32}$/.test(value);
const email=student=>'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co';
const one=async(c,sql,args)=>(await c.query(sql,args)).rows[0]?.data;

// Used only by the short-lived private operator command. The ordinary API
// process receives neither this signing key nor a recovery HTTP route.
export function createRecoveryAuth({jwtSecret,checkLocalSession,fetchImpl=fetch}){
 if(typeof jwtSecret!=='string'||jwtSecret.length<48||jwtSecret.length>128||/\s/.test(jwtSecret)||typeof checkLocalSession!=='function')throw Error('INVALID_CONFIGURATION');
 const key=new TextEncoder().encode(jwtSecret),authorizations=new WeakMap();
 const verify=createIdentityVerifier({...policy,checkLocalSession,fetchImpl});
 async function call(path,body,authorization){
  let response,value;try{
   response=await fetchImpl('http://auth:9999'+path,{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000)});
   if(response.status===400||response.status===401||response.status===403)throw fault('UNAUTHORIZED');
   if(!response.ok)throw fault('AUTH_UNAVAILABLE');value=response.status===204?null:await response.json();
  }catch(e){throw fault(e?.code==='UNAUTHORIZED'?'UNAUTHORIZED':'AUTH_UNAVAILABLE');}
  return value;
 }
 async function login(student,password){
  if(!validStudent(student)||typeof password!=='string'||!password||Buffer.byteLength(password)>4096)throw fault('INVALID_INPUT');
  const session=await call('/token?grant_type=password',{email:email(student),password});
  const authorization='Bearer '+session?.access_token,identity=await verify(authorization);authorizations.set(identity,authorization);return identity;
 }
 async function release(identity){const authorization=authorizations.get(identity);authorizations.delete(identity);if(authorization)try{await call('/logout?scope=local',{},authorization);}catch{}}
 return {
  login,release,
  fingerprint(actor,target,requestId,password){return createHmac('sha256',key).update(JSON.stringify([actor,target,requestId,password])).digest('hex');},
  async changePassword(userId,password){
   if(!UUID.test(userId??''))throw fault('INVALID_INPUT');
   const token=await new SignJWT({role:'service_role'}).setProtectedHeader({alg:'HS256'}).setIssuer(policy.authOrigin+'/auth/v1').setAudience('authenticated').setIssuedAt().setExpirationTime('30s').sign(key);
   let response;try{response=await fetchImpl('http://auth:9999/admin/users/'+userId,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({password}),redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw fault('AUTH_UNAVAILABLE');}
   if(!response.ok)throw fault('AUTH_UNAVAILABLE');
  },
  async checkNewPassword(student,password,userId){
   let session;try{
    // Pending recovery deliberately blocks business sessions. Reconciliation
    // proves the new password with GoTrue only; it grants no business access.
    session=await call('/token?grant_type=password',{email:email(student),password});return session?.user?.id===userId;
   }catch(e){if(e?.code==='UNAUTHORIZED')return false;throw e;}
   finally{if(typeof session?.access_token==='string')try{await call('/logout?scope=local',{},'Bearer '+session.access_token);}catch{}}
  }
 };
}

export function createRecoveryService({database,auth}){
 return {async reset(input){
  const fields=['adminStudentId','adminPassword','targetStudentId','newPassword','requestId','reconcile'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k))||!validStudent(input.adminStudentId)||!validStudent(input.targetStudentId)||typeof input.adminPassword!=='string'||!input.adminPassword||Buffer.byteLength(input.adminPassword)>4096||typeof input.newPassword!=='string'||input.newPassword.length<8||Buffer.byteLength(input.newPassword)>72||!UUID.test(input.requestId??'')||input.reconcile!==undefined&&typeof input.reconcile!=='boolean')throw fault('INVALID_INPUT');
  let actor;
  try{
   // A fresh password grant is mandatory on every invocation, including replay.
   actor=await auth.login(input.adminStudentId,input.adminPassword);
   const binding=auth.fingerprint(actor.userId,input.targetStudentId,input.requestId,input.newPassword);
   const reservation=await database.withIdentity(actor,c=>one(c,'SELECT api_private.begin_auth_recovery($1,$2,$3) AS data',[input.targetStudentId,input.requestId,binding]));
   if(!reservation||!UUID.test(reservation.targetId??'')||!UUID.test(reservation.finishToken??''))throw fault('DB_UNAVAILABLE');
   if(reservation.state==='completed')return {status:'local_password_reset_completed',accounts:1};
   const finish=state=>database.withMaintenance(c=>one(c,'SELECT api_private.finish_auth_recovery($1,$2,$3,$4) AS data',[actor.userId,input.requestId,reservation.finishToken,state]));
   if(!reservation.fresh){
    if(input.reconcile!==true||!await auth.checkNewPassword(input.targetStudentId,input.newPassword,reservation.targetId))throw unknown();
   }else{
    try{await auth.changePassword(reservation.targetId,input.newPassword);}
    catch{try{await finish('unknown');}catch{}throw unknown();}
   }
   try{await finish('completed');}catch{try{await finish('unknown');}catch{}throw unknown();}
   return {status:'local_password_reset_completed',accounts:1};
  }finally{if(actor)await auth.release?.(actor);}
 }};
}
