(function(root,factory){
  const mode=typeof module==='object'&&module.exports?require('../data/deployment-mode.js'):root.DeploymentModeModule;
  const api=factory(mode);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.DeploymentProfileModule=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(mode){
  const codes=new Set(['UNAUTHORIZED','FORBIDDEN','PROFILE_NOT_SYNCED','PROFILE_DISABLED','AUTH_UNAVAILABLE','DB_UNAVAILABLE','INVALID_INPUT']);
  const fail=code=>Object.assign(Error(code),{code});
  function createDeploymentProfileClient({config,origin,getAccessToken,fetchImpl=globalThis.fetch}){
    if(!mode)throw Error('INVALID_DEPLOYMENT');const deployment=mode.resolveDeployment(config,origin);if(deployment.mode==='source')return null;
    const prefix=new URL(deployment.apiBase,origin).href;
    async function request(path,body){
      const token=await getAccessToken();if(!token)throw fail('UNAUTHORIZED');let response,value;
      try{response=await fetchImpl(prefix+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),...(body===undefined?{}:{body:JSON.stringify(body)})});value=await response.json();}catch{throw fail('AUTH_UNAVAILABLE');}
      if(!response.ok)throw fail(codes.has(value?.error?.code)?value.error.code:'DB_UNAVAILABLE');
      if(!value?.data||typeof value.data.id!=='string')throw fail('DB_UNAVAILABLE');return value.data;
    }
    return {instanceId:deployment.instanceId,
      async load(authUser){let profile;try{profile=await request('/me');}catch(e){if(e.code!=='PROFILE_NOT_SYNCED')throw e;profile=await request('/identity/ensure-profile',{});}if(profile.id!==authUser?.id)throw fail('UNAUTHORIZED');return profile;},
      update(input){const map={display_name:'displayName',gender:'gender',class_name:'className',grade:'grade'};if(!input||Object.keys(input).some(k=>!Object.hasOwn(map,k)))throw fail('INVALID_INPUT');return request('/identity/update-profile',Object.fromEntries(Object.entries(input).map(([k,v])=>[map[k],v])));}
    };
  }
  return {createDeploymentProfileClient};
});
