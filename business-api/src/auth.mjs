import {UUID} from './contracts.mjs';
import {failure} from './errors.mjs';
import {AUTH_ORIGIN} from './config.mjs';
export function createIdentityVerifier({authOrigin,publishableKey,fetchImpl=fetch,now=Date.now}){
  if(authOrigin!==AUTH_ORIGIN)throw new Error('INVALID_CONFIGURATION');
  return async function verify(authorization){
    if(typeof authorization!=='string'||authorization.length>16384||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization))throw failure('UNAUTHORIZED');
    const token=authorization.slice(7);let c,h;
    try{[h,c]=token.split('.').slice(0,2).map(s=>JSON.parse(Buffer.from(s,'base64url').toString('utf8')));}catch{throw failure('UNAUTHORIZED');}
    const seconds=Math.floor(now()/1000);
    if(!['HS256','RS256','ES256'].includes(h?.alg)||!UUID.test(c?.sub??'')||c.iss!==authOrigin+'/auth/v1'||c.role!=='authenticated'||!(c.aud==='authenticated'||Array.isArray(c.aud)&&c.aud.includes('authenticated'))||!Number.isSafeInteger(c.exp)||c.exp<=seconds||(c.nbf!==undefined&&(!Number.isSafeInteger(c.nbf)||c.nbf>seconds)))throw failure('UNAUTHORIZED');
    let response,user;
    try{
      response=await fetchImpl(authOrigin+'/auth/v1/user',{headers:{apikey:publishableKey,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(5000)});
      if(response.status===401||response.status===403)throw failure('UNAUTHORIZED');
      if(!response.ok)throw failure('AUTH_UNAVAILABLE');
      user=await response.json();
    }catch(e){throw failure(e?.code==='UNAUTHORIZED'?'UNAUTHORIZED':'AUTH_UNAVAILABLE');}
    if(user?.id!==c.sub||user.deleted_at||user.disabled===true||(user.banned_until&&Date.parse(user.banned_until)>now())||c.exp<=Math.floor(now()/1000))throw failure('UNAUTHORIZED');
    return Object.freeze({userId:user.id,issuer:c.iss,audience:'authenticated',role:'authenticated',expiry:c.exp});
  };
}
