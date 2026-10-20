(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?{
 mode:require('./deployment-mode.js'),api:require('./unified-api-client.js'),files:require('./business-files-client.js'),tasks:require('./business-task-client.js'),events:require('../sync/business-event-client.js'),scene:require('./scene-services.js'),sceneApi:require('../../3D_scenes_edit/persistence/scene-files-api-client.js')
 }:{mode:root.DeploymentModeModule,api:root.UnifiedApiClientModule,files:root.BusinessFilesClientModule,tasks:root.BusinessTaskClientModule,events:root.BusinessEventClientModule,scene:root.SceneServicesModule,sceneApi:root.SceneFilesApiClientModule});if(common)module.exports=api;if(root)root.PlatformServicesModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(modules){
 function guardBusinessClient(client){return new Proxy({}, {get(_target,key){if(key==='auth')return client?.auth;if(['from','rpc','channel','removeChannel','removeAllChannels'].includes(key))return ()=>{throw Error('SOURCE_BUSINESS_DISABLED');};if(['storage','functions'].includes(key))throw Error('SOURCE_BUSINESS_DISABLED');return undefined;}});}
 function createPlatformServices({deployment,authClient,fetchImpl=globalThis.fetch,storage=globalThis.localStorage,origin=globalThis.location?.origin,contextProvider=()=>({})}){
  const config=modules.mode.resolveDeployment(deployment,origin);
  if(config.mode==='source')return Object.freeze({mode:'source',deployment:config,sourceClient:authClient,dispose(){}});
  const scenes=new Set(),events=new Set();let disposed=false,files;
  const api=modules.api.createUnifiedApiClient({deployment:config,authClient,origin,fetchImpl,contextProvider,onIdentityChange(){files?.clear();for(const scene of scenes)scene.dispose();scenes.clear();for(const event of events)void event.stop();}});
  const domain=name=>Object.freeze({async execute(action,input){if(disposed)throw Error('CLIENT_DISPOSED');if(!action.startsWith(name+'.')&&!(name==='catalog'&&action.startsWith('admin.')))throw Error('UNKNOWN_OPERATION');return api.execute(action,input);}});
  files=modules.files.createBusinessFilesClient({origin,fetchImpl,storage,getAccessToken:api.getAccessToken,getIdentityKey:api.getIdentityKey});
  const tasks=modules.tasks.createBusinessTaskClient({api,contextProvider,storage});
  return Object.freeze({mode:'aliyun',deployment:config,businessClient:guardBusinessClient(authClient),api,
   identity:Object.freeze({...domain('identity'),me:()=>api.execute('identity.me',{}),bootstrap:()=>api.execute('identity.bootstrap',{}),ensureProfile:()=>api.execute('identity.ensureProfile',{})}),catalog:domain('catalog'),survey:domain('survey'),planning:Object.freeze({execute(action,input){if(!/^(planning|personal)\./.test(action))throw Error('UNKNOWN_OPERATION');return api.execute(action,input);}}),models:domain('models'),admin:domain('admin'),community:domain('community'),mc:domain('mc'),files,tasks,
   scene:Object.freeze({createServices({context,storage:sceneStorage=storage}){
    if(disposed)throw Error('CLIENT_DISPOSED');const parentScope=JSON.stringify(contextProvider());
    const sceneContext=()=>{if(parentScope!==JSON.stringify(contextProvider())||!api.getIdentityKey())throw Error('CONTEXT_CHANGED');return {...context,userId:contextProvider().userId};};
    const sceneApi=modules.sceneApi.createSceneFilesClient({baseUrl:new URL('/api/v1/scene-files',origin).href,getAccessToken:api.getAccessToken,getIdentityKey:api.getIdentityKey,fetchImpl});
    const scene=modules.scene.createSceneServices({api:sceneApi,getAccessToken:api.getAccessToken,contextProvider:sceneContext,instanceId:config.instanceId,storage:sceneStorage});scenes.add(scene);return scene;
   }}),
   events:Object.freeze({createClient(options){if(disposed)throw Error('CLIENT_DISPOSED');const client=modules.events.createBusinessEventClient({...options,origin,fetchImpl,storage,getAccessToken:api.getAccessToken});events.add(client);return client;}}),
   dispose(){if(disposed)return;disposed=true;api.dispose();files.clear();tasks.dispose();for(const scene of scenes)scene.dispose();for(const event of events)void event.stop();scenes.clear();events.clear();}
  });
 }
 return {createPlatformServices,guardBusinessClient};
});
