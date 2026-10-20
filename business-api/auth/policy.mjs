import {AUTH_ORIGIN} from '../src/config.mjs';

// These are deployment authorities, never values taken from an HTTP request.
const LOCAL_ORIGIN='https://8.148.248.237';
const INTERNAL_ORIGIN='http://auth:9999';
export function resolveAuthPolicy(config={}) {
 const mode=config.authMode??'source';
 if(mode==='source'&&config.authOrigin===AUTH_ORIGIN&&config.authInternalOrigin===undefined)
  return Object.freeze({mode,issuer:AUTH_ORIGIN+'/auth/v1',userEndpoint:AUTH_ORIGIN+'/auth/v1/user',profileMode:'source'});
 if(mode==='local'&&config.authOrigin===LOCAL_ORIGIN&&config.authInternalOrigin===INTERNAL_ORIGIN)
  return Object.freeze({mode,issuer:LOCAL_ORIGIN+'/auth/v1',userEndpoint:INTERNAL_ORIGIN+'/user',profileMode:'local'});
 throw Error('INVALID_CONFIGURATION');
}
