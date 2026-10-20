import {mapSceneFilesError} from '../scene-files/database.mjs';
import {createLocalQueueService} from '../local-tasks/service.mjs';
import {createLocalTaskTransport} from '../local-tasks/transport.mjs';
import {createUnifiedDatabase} from './database.mjs';import {createIdentityGateway,createIdentityService} from './identity.mjs';import {createCatalogService} from './catalog.mjs';import {createSurveyService} from './survey.mjs';import {createCommunityService} from './community.mjs';import {createPlanningService} from './planning.mjs';import {createModelsService} from './models.mjs';import {createMcService} from './mc.mjs';import {createEventService} from './events.mjs';import {createBusinessFilesService} from './files.mjs';import {createBusinessFileStore} from './file-store.mjs';import {createStorageReader} from '../src/storage.mjs';import {createFileStore} from '../scene-files/file-store.mjs';import {createUploadService} from '../scene-files/uploads.mjs';import {createSceneFilesService} from '../scene-files/scene.mjs';import {createTaskFiles} from './task-files.mjs';import {createTaskService} from './tasks.mjs';import {createTaskBridge} from './bridge.mjs';import {createBridgeRemote} from './bridge-remote.mjs';import {createFileBudget} from './budgets.mjs';import {fault} from './contracts.mjs';
export async function createUnifiedServices(config){
 const database=createUnifiedDatabase(config.database,{authPolicy:config});
 try{
  await database.verifyInstallation();const gateway=createIdentityGateway({...config,checkLocalSession:database.checkLocalSession}),identity=createIdentityService({database,sourceProfileReader:gateway.sourceProfileReader,verifyIdentity:gateway.verifyIdentity,authPolicy:config});
  const budget=createFileBudget(),store=budget.wrap(await createBusinessFileStore({root:config.filesRoot,instanceId:config.instanceId})),sceneStore=budget.wrap(await createFileStore({root:config.sceneRoot})),legacyReader=budget.wrap(await createStorageReader(config.legacy));
  const taskFiles=createTaskFiles({database,store,legacyReader,instanceId:config.instanceId});
  const workerQueue=config.authMode==='local'?createLocalQueueService({database,instanceId:config.instanceId}):null;
  if(workerQueue)await workerQueue.verifyInstallation();
  const remote=config.bridge.enabled?createBridgeRemote(config.bridge):{call:async()=>{throw Object.assign(Error('SOURCE_NOT_READY'),{code:'SOURCE_NOT_READY'});}},bridge=workerQueue?createLocalTaskTransport({queue:workerQueue}):createTaskBridge({remote,instanceId:config.instanceId});
  const tasks=createTaskService({database,bridge,files:taskFiles}),files=createBusinessFilesService({database,store,legacyReader}),catalog=createCatalogService({database}),planning=createPlanningService({database}),survey=createSurveyService({database,files,taskReferences:tasks}),community=createCommunityService({database}),models=createModelsService({database}),mc=createMcService({database}),events=createEventService({database});
  // The existing C2a validators and transaction code borrow this same database facade; no additional pg.Pool is constructed.
  const sceneDatabase={withIdentity:(actor,fn)=>database.withIdentity(actor,async client=>{try{return await fn(client);}catch(e){throw mapSceneFilesError(e);}}),withMaintenance:fn=>database.withMaintenance(fn)};
  const legacyObjectReader=async(c,id)=>(await c.query('SELECT api_private.scene_legacy_file($1,NULL) AS data',[id])).rows[0]?.data,legacyPathReader=async(c,path)=>(await c.query('SELECT api_private.scene_legacy_file(NULL,$1) AS data',[path])).rows[0]?.data;
  const scene=createSceneFilesService({database:sceneDatabase,store:sceneStore,legacyReader,legacyObjectReader,legacyPathReader}),sceneUploads=createUploadService({database:sceneDatabase,store:sceneStore,legacyReader,legacyObjectReader,commitPreview:scene.commitPreview,authorizeContext:async(c,spec)=>{if(!(await c.query('SELECT api_private.scene_upload_context($1::jsonb) AS ok',[JSON.stringify({purpose:spec.purpose,context:spec.context})])).rows[0]?.ok)throw fault('FORBIDDEN');}});
  const domains={catalog,admin:catalog,planning,personal:planning,survey,community,models,mc,tasks};
  return {database,identity,files,taskFiles,tasks,events,scene,sceneUploads,budget,workerQueue,verifyIdentity:gateway.verifyIdentity,
   async execute(actor,action,input){
    if(action==='identity.me')return identity.me(actor);if(action==='identity.ensureProfile')return identity.ensureProfile(actor);if(action==='identity.updateProfile')return identity.updateProfile(actor,input);if(action==='identity.bootstrap')return catalog.bootstrap(actor);
    if(!workerQueue&&!config.bridge.enabled&&['tasks.submitGeo','tasks.submitFacade','tasks.availability','tasks.sourceStatus','tasks.retry','tasks.confirmCrop'].includes(action))throw Object.assign(Error('SOURCE_NOT_READY'),{code:'SOURCE_NOT_READY',status:409});
    const service=domains[action.split('.')[0]];if(!service)throw fault('NOT_FOUND');return service.execute(actor,action,input);
   }
  };
 }catch(e){await database.close();throw e;}
}
