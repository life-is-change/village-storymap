(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BusinessApiClientModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const CODES=new Set(['INVALID_INPUT','UNAUTHORIZED','NOT_FOUND','METHOD_NOT_ALLOWED','PROFILE_NOT_SYNCED','AUTH_UNAVAILABLE','DB_UNAVAILABLE']);
 function createBusinessApiClient({baseUrl='/api/v1',getAccessToken,fetchImpl=globalThis.fetch}){
  const current=globalThis.location?.origin;
  const base=new URL(baseUrl,current||'http://invalid.local');
  const loopback=['127.0.0.1','localhost','[::1]'].includes(base.hostname)&&['http:','https:'].includes(base.protocol);
  if(base.username||base.password||base.search||base.hash||!(loopback||(current&&base.origin===current&&base.protocol==='https:'))||base.pathname.replace(/\/$/,'')!=='/api/v1')throw Error('INVALID_API_ORIGIN');
  const error=(code,status)=>Object.assign(Error(code),{code,status});
  async function request(path){
   const token=await getAccessToken();if(!token)throw error('UNAUTHORIZED',401);
   let response;
   try{response=await fetchImpl(base.href.replace(/\/$/,'')+path,{method:'GET',headers:{Authorization:'Bearer '+token},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{throw error('API_UNAVAILABLE',503);}
   let result;try{result=await response.json();}catch{throw error('API_UNAVAILABLE',503);}
   if(!response.ok)throw error(CODES.has(result?.error?.code)?result.error.code:'API_UNAVAILABLE',response.status);
   if(!Object.hasOwn(result,'data'))throw error('API_UNAVAILABLE',503);return result.data;
  }
  return {getMe:()=>request('/me'),listCourses:()=>request('/courses'),listSpaces:(query={})=>request('/spaces?'+new URLSearchParams(query)),getSpace:(kind,id)=>request('/spaces/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id))};
 }
 return {createBusinessApiClient};
});
