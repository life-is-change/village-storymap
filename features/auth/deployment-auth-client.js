(function(root,factory){
 const mode=typeof module==='object'&&module.exports?require('../data/deployment-mode.js'):root.DeploymentModeModule;
 const api=factory(mode);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.DeploymentAuthClientModule=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(mode){
 const sourceUrl='https://rzmbmwauomzwiyenafha.supabase.co';
 const sourceKey='sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb';
 function resolveAuthClientOptions(config,origin){
  const deployment=mode.resolveDeployment(config,origin),local=deployment.auth?.mode==='local';
  return Object.freeze({url:local?new URL(origin).origin:sourceUrl,key:local?deployment.auth.publicKey:sourceKey,
   options:{auth:{storageKey:local?'village-'+deployment.instanceId+'-auth-v1':'village-storymap-supabase-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:!local}}});
 }
 function createDeploymentAuthClient({sdk,config,origin}){
  const value=resolveAuthClientOptions(config,origin);if(typeof sdk?.createClient!=='function')throw Error('AUTH_SDK_UNAVAILABLE');
  // GoTrue does not authenticate this public SDK marker. Actual access requires
  // a signed user token; privileged keys are never accepted in deployment JSON.
  return sdk.createClient(value.url,value.key,value.options);
 }
 return {resolveAuthClientOptions,createDeploymentAuthClient};
});
