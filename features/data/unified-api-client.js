(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./deployment-mode.js'):root.DeploymentModeModule,common?require('./unified-operation-routes.js'):root.UnifiedOperationRoutesModule);if(common)module.exports=api;if(root)root.UnifiedApiClientModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(mode,routes){
 const fault=code=>Object.assign(Error(code),{code});
 function createUnifiedApiClient({deployment,origin=globalThis.location?.origin,authClient,contextProvider=()=>null,fetchImpl=globalThis.fetch,onIdentityChange}){
  const config=mode.resolveDeployment(deployment,origin);if(config.mode!=='aliyun')throw fault('LOCAL_API_REQUIRED');
  let disposed=false,epoch=0,userId=null,token=null,authRevision=0;const controllers=new Set();
  const scope=()=>JSON.stringify(contextProvider());
  function invalidate(){epoch++;for(const c of controllers)c.abort();controllers.clear();}
  function update(session){const next=session?.user?.id??null;token=session?.access_token??null;if(next!==userId){userId=next;invalidate();onIdentityChange?.(next);}}
  const subscription=authClient?.auth?.onAuthStateChange?.((_event,session)=>{authRevision++;update(session);})?.data?.subscription;
  const initialRevision=authRevision;
  const ready=Promise.resolve(authClient?.auth?.getSession?.()).then(value=>{if(!disposed&&authRevision===initialRevision)update(value?.data?.session);});
  async function getAccessToken(){await ready;if(disposed||!userId||!token)throw fault('UNAUTHORIZED');return token;}
  function getIdentityKey(){if(disposed||!userId)return '';return JSON.stringify([config.instanceId,userId,contextProvider()]);}
  async function request(path,{method='GET',input,binary=false,identityOnly=false}={}){
   await ready;const access=await getAccessToken(),before=epoch,context=scope(),controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),30000);timer.unref?.();
   const stale=()=>disposed||before!==epoch||!identityOnly&&context!==scope();
   try{
    const body=input===undefined?undefined:JSON.stringify(input);if(body&&new TextEncoder().encode(body).length>2*1024**2)throw fault('PAYLOAD_TOO_LARGE');
    const response=await fetchImpl(new URL(path,origin).href,{method,headers:{Authorization:'Bearer '+access,...(body===undefined?{}:{'Content-Type':'application/json'})},credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,...(body===undefined?{}:{body})});
    if(stale())throw fault('CONTEXT_CHANGED');
    if(!response.ok){let value;try{value=await response.json();}catch{}const code=value?.error?.code;throw fault(typeof code==='string'&&/^[A-Z_]{2,64}$/.test(code)?code:'API_UNAVAILABLE');}
    let value;if(binary){value=await response.blob();if(value.size>50*1024**2)throw fault('PAYLOAD_TOO_LARGE');}else{const text=await response.text();if(new TextEncoder().encode(text).length>2*1024**2)throw fault('PAYLOAD_TOO_LARGE');value=JSON.parse(text).data;}
    if(stale())throw fault('CONTEXT_CHANGED');return value;
   }catch(e){if(stale())throw fault('CONTEXT_CHANGED');if(e.code)throw e;throw fault('API_UNAVAILABLE');}finally{clearTimeout(timer);controllers.delete(controller);}
  }
  return {getAccessToken,getIdentityKey,invalidate,
   async execute(action,input={}){const route=Object.hasOwn(routes.ROUTES,action)&&routes.ROUTES[action];if(!route)throw fault('UNKNOWN_OPERATION');return request(route.path,{method:route.method,input:route.method==='GET'?undefined:input,identityOnly:action.startsWith('identity.')});},
   readTaskArtifact(id,type,{sha256}={}){if(!/^[a-f0-9-]{36}$/.test(id)||!['buildings','roads','waterways','water_areas','contours','rectified_preview','rectified_source','building_mask','building_glb','standard_facade'].includes(type)||sha256!==undefined&&!/^[a-f0-9]{64}$/.test(sha256))throw fault('INVALID_INPUT');return request('/api/v1/tasks/'+id+'/artifacts/'+type+(sha256?'?sha256='+sha256:''),{binary:true});},
   dispose(){disposed=true;invalidate();subscription?.unsubscribe();token=null;userId=null;}
  };
 }
 return {createUnifiedApiClient};
});
