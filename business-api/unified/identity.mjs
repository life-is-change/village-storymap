import {createIdentityVerifier} from '../src/auth.mjs';
import {AUTH_ORIGIN} from '../src/config.mjs';
import {UUID} from '../src/contracts.mjs';
import {fault,parseOperation} from './contracts.mjs';
import {resolveAuthPolicy} from '../auth/policy.mjs';
import {localProfileFromUser} from '../auth/local-identity.mjs';

export function createIdentityGateway(config){
  const policy=resolveAuthPolicy(config);
  if(policy.mode==='source'&&(typeof config.publishableKey!=='string'||!config.publishableKey.startsWith('sb_publishable_')))throw Error('INVALID_CONFIGURATION');
  const verify=createIdentityVerifier(config),headers=new WeakMap(),fetchImpl=config.fetchImpl??fetch,now=config.now??Date.now;
  return {
    async verifyIdentity(authorization){const identity=await verify(authorization);headers.set(identity,authorization);return identity;},
    async sourceProfileReader(identity){
      const authorization=headers.get(identity);if(!authorization||identity.expiry<=Math.floor(now()/1000))throw fault('UNAUTHORIZED');
      if(policy.mode==='local'){
        let response,user;try{
          response=await fetchImpl(policy.userEndpoint,{headers:{Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(5000)});
          if(response.status===401||response.status===403)throw fault('UNAUTHORIZED');
          if(!response.ok)throw fault('AUTH_UNAVAILABLE');user=await response.json();
        }catch(e){throw fault(e?.code==='UNAUTHORIZED'?'UNAUTHORIZED':'AUTH_UNAVAILABLE');}
        if(!await config.checkLocalSession(identity))throw fault('UNAUTHORIZED');
        return localProfileFromUser(user,identity.userId);
      }
      const url=new URL(AUTH_ORIGIN+'/rest/v1/profiles');url.searchParams.set('id','eq.'+identity.userId);url.searchParams.set('select','id,student_id,display_name,gender,class_name,grade');url.searchParams.set('limit','1');
      let response,rows;try{
        response=await fetchImpl(url.href,{headers:{apikey:config.publishableKey,Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(5000)});
        if(response.status===401||response.status===403)throw fault('UNAUTHORIZED');
        if(!response.ok)throw fault('AUTH_UNAVAILABLE');rows=await response.json();
      }catch(e){throw fault(e?.code==='UNAUTHORIZED'?'UNAUTHORIZED':'AUTH_UNAVAILABLE');}
      if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==identity.userId)throw fault('PROFILE_NOT_SYNCED');
      return rows[0];
    }
  };
}
export function createIdentityService({database,sourceProfileReader,verifyIdentity,authPolicy={authOrigin:AUTH_ORIGIN}}){
  const policy=resolveAuthPolicy(authPolicy);
  function assertIdentity(identity){if(!UUID.test(identity?.userId??'')||identity.issuer!==policy.issuer||!Number.isSafeInteger(identity.expiry)||identity.expiry<=Math.floor(Date.now()/1000)||(policy.mode==='local'&&!UUID.test(identity.sessionId??'')))throw fault('UNAUTHORIZED');}
  const data=result=>result.rows[0]?.data;
  return {
    verifyIdentity,
    me(identity){return database.withIdentity(identity,async c=>data(await c.query('SELECT api_private.profile_self() AS data')),{readOnly:true});},
    async ensureProfile(identity){
      assertIdentity(identity);let source;try{source=await sourceProfileReader(identity);}catch(e){throw fault(['UNAUTHORIZED','PROFILE_NOT_SYNCED'].includes(e?.code)?e.code:'AUTH_UNAVAILABLE');}
      if(source?.id!==identity.userId)throw fault('UNAUTHORIZED');
      const profile=Object.fromEntries(['id','student_id','display_name','gender','class_name','grade'].map(k=>[k,source[k]??'']));
      return database.withMaintenance(async c=>{assertIdentity(identity);const sql=policy.mode==='local'?'SELECT api_private.ensure_local_profile($1,$2::jsonb) AS data':'SELECT api_private.ensure_profile($1,$2::jsonb) AS data';const result=data(await c.query(sql,[identity.userId,JSON.stringify(profile)]));assertIdentity(identity);return result;});
    },
    async updateProfile(identity,input){const parsed=parseOperation('identity.updateProfile',input);return database.withIdentity(identity,async c=>data(await c.query('SELECT api_private.update_profile($1::jsonb) AS data',[JSON.stringify(parsed.input)])));},
    async disableLocalProfile(identity,userId){if(typeof userId!=='string'||!UUID.test(userId))throw fault('INVALID_INPUT');return database.withIdentity(identity,async c=>data(await c.query('SELECT api_private.disable_profile($1) AS data',[userId])));}
  };
}
