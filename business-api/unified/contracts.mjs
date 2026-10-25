import {UUID} from '../src/contracts.mjs';

export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_BATCH_ITEMS = 500;
const statuses = {PROJECT_SUBMITTED:409,BASELINE_MISMATCH:409,FILE_SCOPE_MISMATCH:403,METHOD_NOT_ALLOWED:405,UNSUPPORTED_MEDIA_TYPE:415,INVALID_INPUT:400,NOT_FOUND:404,PAYLOAD_TOO_LARGE:413,UNAUTHORIZED:401,FORBIDDEN:403,DB_UNAVAILABLE:503,AUTH_UNAVAILABLE:503,PROFILE_NOT_SYNCED:403,PROFILE_DISABLED:403,REVISION_CONFLICT:409,NOT_IMPLEMENTED:501,RATE_LIMITED:429,FILE_IN_USE:409,UPLOAD_CONFLICT:409,UPLOAD_EXPIRED:410,FILES_NOT_READY:409,FILE_TOO_LARGE:413,FILE_TYPE_UNSUPPORTED:415,INVALID_FILE:422,FILE_BUSY:503,FILE_UNAVAILABLE:503,QUOTA_EXCEEDED:507};
export const fault = code => Object.assign(Error(Object.hasOwn(statuses,code)?code:'DB_UNAVAILABLE'), {code:Object.hasOwn(statuses,code)?code:'DB_UNAVAILABLE',status:statuses[code]??503});
const invalid = () => { throw fault('INVALID_INPUT'); };
const plain = value => value !== null && typeof value === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const sampleUuid = 'a0000000-0000-4000-8000-000000000001';
const field = (check,example,required=true) => Object.freeze({check,example,required});
const optional = f => field(f.check,f.example,false);
const str = (max=200,example='TEST') => field(value=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value),example);
const displayField = max => field(value=>typeof value==='string'&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value),'');
const id = field(value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value),'test-id');
const uuid = field(value=>typeof value==='string'&&UUID.test(value)&&value===value.toLowerCase(),sampleUuid);
const integer = (min=0,max=Number.MAX_SAFE_INTEGER) => field(value=>Number.isSafeInteger(value)&&value>=min&&value<=max,min);
const bool = field(value=>typeof value==='boolean',false);
const json = field(plain,{});
const choice = (...values) => field(value=>values.includes(value),values[0]);
const nullable = f => field(value=>value===null||f.check(value),null);
const list = (f,max=500,min=0) => field(value=>Array.isArray(value)&&value.length>=min&&value.length<=max&&value.every(f.check),min?[f.example]:[]);
const multiline = (max=4000) => field(value=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value),'TEST');
const context = {teachingProjectId:uuid,villageId:uuid,spaceId:id};
const replay = {requestId:uuid};
const definitions = Object.create(null);
function add(action,fields,readOnly,source,path) {
  if(Object.hasOwn(definitions,action)) throw Error('DUPLICATE_OPERATION');
  const [domain,name]=action.split('.');
  const prefix={identity:'identity',catalog:'spaces',survey:'survey',planning:'planning',personal:'personal',models:'models',community:'community',mc:'mc',tasks:'tasks',admin:'admin'}[domain];
  definitions[action]=Object.freeze({fields:Object.freeze({...fields}),readOnly,source,path:'/api/v1'+(path??('/'+prefix+'/'+name.replace(/[A-Z]/g,v=>'-'+v.toLowerCase()))),method:domain==='identity'&&readOnly?'GET':'POST'});
}
add('identity.me',{},true,'auth-system.js:loadProfile','/me');
add('identity.bootstrap',{},true,'app.js:startup; auth-system.js:loadProfile','/bootstrap');
add('identity.ensureProfile',{},false,'auth-system.js:register');
add('identity.updateProfile',{displayName:optional(str(20)),gender:optional(displayField(12)),className:optional(displayField(30)),grade:optional(displayField(20))},false,'auth-system.js:updateProfile');
add('admin.listPhotos',{},true,'admin.js;object_photos');
add('admin.listMessages',{},true,'admin.js;community_tasks');
add('admin.listUsers',{},true,'supabase/functions/admin-delete-user; auth-system.js');
add('admin.disableUser',{userId:uuid,...replay},false,'supabase/functions/admin-delete-user (local business disable only)');

for(const [name,fields,readOnly,source] of [
 ['listCourses',{},true,'courses'],['getCourseContext',{courseId:id},true,'courses;group_memberships;task_progress'],['listGroups',{courseId:id},true,'course_groups'],
 ['createGroup',{courseId:id,name:str(100),...replay},false,'course_groups'],
 ['joinGroup',{courseId:id,code:str(32),...replay},false,'group_memberships'],
 ['lockGroup',{groupId:id,locked:bool,...replay},false,'course_groups'],
 ['getProgress',{courseId:id},true,'task_progress'],['setProgress',{courseId:id,taskId:id,complete:bool,...replay},false,'task_progress'],
 ['listActivity',{courseId:id,limit:optional(integer(1,200))},true,'activity_events'],
 ['recordActivity',{courseId:id,...context,taskId:optional(id),action:str(100),targetType:optional(displayField(100)),targetId:optional(displayField(200)),viewMode:optional(displayField(30)),metadata:optional(json),...replay},false,'activity_events'],
 ['getActiveContext',{},true,'get_active_project_context'],['listVillages',{},true,'villages'],
 ['listSpaces',{teachingProjectId:uuid,villageId:uuid},true,'planning_spaces;course_personal_spaces'],
 ['getSpace',context,true,'planning_spaces;course_personal_spaces'],
 ['ensureSpace',{teachingProjectId:uuid,villageId:uuid,spaceType:choice('practice_personal','formal_personal'),title:optional(str(100)),...replay},false,'ensure_context_space']
]) add('catalog.'+name,fields,readOnly,'features/course/course-service.js;features/villages/village-client.js -> '+source,name.endsWith('Groups')||['listCourses','createGroup','joinGroup','lockGroup','getProgress','setProgress','listActivity','recordActivity'].includes(name)?'/courses/'+name.replace(/[A-Z]/g,v=>'-'+v.toLowerCase()):undefined);
for(const [name,fields,readOnly,source] of [
 ['createVillage',{name:str(80),isPractice:optional(bool),boundary:optional(nullable(json)),defaultCrs:optional(choice('EPSG:4326')),...replay},false,'create_village_draft'],
 ['createTeachingProject',{courseId:id,name:str(100),practiceVillageId:uuid,...replay},false,'create_teaching_project'],
 ['archiveTeachingProject',{teachingProjectId:uuid,...replay},false,'archive_teaching_project'],
 ['previewVillageRemoval',{villageId:uuid},true,'get_village_removal_preview'],
 ...['archiveVillage','restoreVillage','deleteVillage'].map((n,i)=>[n,{villageId:uuid,...replay},false,['archive_village','restore_village','delete_unused_village'][i]]),
 ['saveDataset',{villageId:uuid,sourceKind:choice('platform_generated','uploaded_bundle'),imageryConfig:optional(nullable(json)),layerManifest:json,validationSummary:optional(json),status:optional(choice('draft','validating','ready','failed')),datasetId:optional(nullable(uuid)),versionLabel:optional(nullable(str(100))),...replay},false,'save_village_dataset_draft'],
 ['publishDataset',{datasetId:uuid,...replay},false,'publish_village_dataset'],
 ['bindFormalVillage',{teachingProjectId:uuid,villageId:uuid,...replay},false,'bind_formal_village'],
 ['saveRealityModel',{villageId:uuid,ionAssetId:integer(1),title:str(100),heightOffset:optional(field(v=>Number.isFinite(v)&&Math.abs(v)<=1000,0)),terrainEnabled:optional(bool),status:optional(choice('draft','validating','ready')),modelId:optional(nullable(uuid)),...replay},false,'save_village_reality_model_draft'],
 ['publishRealityModel',{modelId:uuid,...replay},false,'publish_village_reality_model'],
 ['groupDashboard',{teachingProjectId:uuid,villageId:uuid},true,'get_group_plan_admin_dashboard'],
 ['groupContext',{...context},true,'get_group_plan_admin_context'],
 ['ensureGroupSpace',{teachingProjectId:uuid,villageId:uuid,groupId:id,snapshotId:optional(nullable(uuid)),...replay},false,'ensure_group_plan_space']
]) add('admin.'+name,fields,readOnly,'features/admin;features/villages/village-client.js -> '+source);

const objectTarget={...context,objectCode:str(200),objectType:str(100)};
const featureTarget={...context,layerKey:choice('building','road','water','cropland','openSpace'),objectCode:str(200)};
for(const [name,fields,readOnly,source] of [
 ['activity',context,true,'survey activity overlays'],
 ['listAttributes',{...context,objectType:str(100)},true,'object_attribute_edits'], ['getAttributes',objectTarget,true,'object_attribute_edits'],['saveAttributes',{...objectTarget,data:json,surveyLayerKey:optional(nullable(choice('building','road','water'))),...replay},false,'object_attribute_edits'],
 ['listComments',objectTarget,true,'object_comments'],['addComment',{...objectTarget,surveyLayerKey:optional(nullable(choice('building','road','water'))),body:multiline(200),...replay},false,'object_comments'],
 ['editComment',{commentId:integer(1),body:multiline(200),...replay},false,'object_comments'],['deleteComment',{commentId:integer(1),...replay},false,'object_comments'],
 ['likeComment',{...context,commentId:integer(1),...replay},false,'object_comment_interactions'],
 ['replyComment',{...context,commentId:integer(1),body:multiline(200),...replay},false,'object_comment_interactions'],
 ['react',{...objectTarget,reaction:choice('like','dislike','none'),...replay},false,'object_attribute_edits'],
 ['listPhotos',objectTarget,true,'object_photos;list_object_photo_facade_usage'],
 ['deletePhoto',{photoId:integer(1),...replay},false,'delete_object_photo_safely'],
 ['listReviews',context,true,'survey_feature_reviews'],['getReview',featureTarget,true,'survey_feature_reviews'],
 ['initializeReviews',{...context,datasetId:uuid,items:list(json),...replay},false,'initialize_shared_survey_reviews'],
 ['confirmGeometry',{...featureTarget,revision:integer(),lockToken:uuid,...replay},false,'confirm_survey_feature_geometry'],
 ['dashboard',context,true,'get_shared_survey_dashboard'],
 ['listFeatures',{...context,layerKey:optional(nullable(choice('building','road','water'))),geometryStatus:optional(nullable(choice('pending','confirmed_unchanged','modified','deleted','added'))),actorId:optional(nullable(uuid)),limit:optional(integer(1,200))},true,'list_shared_survey_features'],
 ['history',featureTarget,true,'feature_versions'],['restoreVersion',{...featureTarget,versionId:uuid,revision:integer(),...replay},false,'restore_survey_feature_version'],
 ['freezeSnapshot',{...context,label:str(100),description:optional(displayField(2000)),recommendedForGroups:optional(bool),...replay},false,'freeze_shared_survey_snapshot']
]) add('survey.'+name,fields,readOnly,'features/data/data-service.js;features/survey;features/object-collaboration;features/admin/survey-admin.js -> '+source);

const editableLayer=choice('building','road','water','cropland','openSpace');
const change=field(value=>plain(value)&&Object.keys(value).every(k=>['action','layerKey','objectCode','objectName','baseObjectCode','afterGeom','afterProps','beforeGeom','beforeProps','expectedRevision','expectedGeometryRevision','lockToken','layerVersionId'].includes(k))&&['add','update','delete'].includes(value.action)&&editableLayer.check(value.layerKey)&&str(200).check(value.objectCode)
 && ['afterProps','beforeProps','afterGeom','beforeGeom'].every(k=>value[k]===undefined||value[k]===null||plain(value[k]))
 && ['expectedRevision','expectedGeometryRevision'].every(k=>value[k]===undefined||integer().check(value[k]))
 && ['lockToken','layerVersionId'].every(k=>value[k]===undefined||uuid.check(value[k]))
 && ['objectName','baseObjectCode'].every(k=>value[k]===undefined||str(200).check(value[k])),{action:'update',layerKey:'building',objectCode:'B1',afterGeom:{type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23]]]},afterProps:{}});
const lockTarget={...context,layerKey:editableLayer,objectCode:str(200)};
for(const [name,fields,readOnly,source] of [
 ['listFeatures',{...context,layerKey:id,includeDeleted:optional(bool)},true,'planning_features;resolve_group_plan_features'],
 ['renameBuilding',{...context,objectCode:str(200),newCode:str(200),expectedRevision:integer(),lockToken:uuid,newLockToken:uuid,...replay},false,'app.js:renameBuildingCodeInDb'],
 ['acquireLock',{...lockTarget},false,'acquire_feature_edit_lock'],['heartbeatLock',{...lockTarget,lockToken:uuid},false,'heartbeat_feature_edit_lock'],['releaseLock',{...lockTarget,lockToken:uuid},false,'release_feature_edit_lock'],
 ['saveBatch',{...context,changes:list(change,500,1),summary:optional(displayField(200)),note:optional(displayField(2000)),...replay},false,'save_feature_edit_batch;save_group_plan_edit_batch'],
 ['versions',{...context,limit:optional(integer(1,200))},true,'feature_versions;feature_snapshots'],
 ['snapshots',context,true,'feature_snapshots'],['snapshotItems',{snapshotId:uuid},true,'feature_snapshot_items'],
 ['freezeSnapshot',{...context,label:str(100),description:optional(displayField(2000)),versionType:optional(choice('initial','published')),...replay},false,'freeze_feature_snapshot'],
 ['baselineState',context,true,'get_group_plan_baseline_state'],['previewBaseline',{...context,targetSnapshotId:uuid},true,'preview_group_baseline_update'],
 ['applyBaseline',{...context,targetSnapshotId:uuid,expectedBaseSnapshotId:uuid,...replay},false,'apply_group_baseline_update'],
 ['conflicts',{...context,includeResolved:optional(bool)},true,'group_baseline_conflicts'],
 ['resolveConflict',{conflictId:uuid,resolution:choice('keep_group','use_new_baseline','manual_merge'),payload:optional(json),...replay},false,'resolve_group_baseline_conflict'],
 ['restorePoints',context,true,'group_plan_restore_points'],['restorePoint',{restorePointId:uuid,...replay},false,'restore_group_plan_restore_point']
]) add('planning.'+name,fields,readOnly,'features/data/feature-db.js;feature-edit-session.js;group-baseline-client.js -> '+source);
for(const [name,fields,readOnly,source] of [
 ['ensure',{courseId:id,teachingProjectId:uuid,villageId:uuid,spaceType:choice('practice_personal','formal_personal'),title:optional(str(100)),...replay},false,'ensure_course_personal_space'],
 ['listVersions',{spaceId:id},true,'personal_layer_versions'],['listSelections',{spaceId:id},true,'personal_layer_selections'],['listFeatures',{versionId:uuid},true,'personal_layer_features'],
 ['deleteFeature',{versionId:uuid,objectCode:str(200),...replay},false,'save_personal_feature_edit_batch'],
 ['saveBatch',{spaceId:id,changes:list(change,500,1),...replay},false,'save_personal_feature_edit_batch'],
 ['setVersion',{spaceId:id,layerKey:id,versionId:uuid,...replay},false,'set_personal_layer_version'],
 ['deleteVersion',{versionId:uuid,...replay},false,'delete_personal_layer_version']
]) add('personal.'+name,fields,readOnly,'features/data/personal-space-client.js -> '+source);
for(const [name,fields,readOnly,source] of [
 ['list',{...context},true,'group_model_assets'],['bindings',context,true,'building_model_bindings'],
 ['place',{...context,assetId:uuid,objectCode:str(200),transform:optional(json),...replay},false,'place_group_model'],
 ['restoreWhiteModel',{...context,objectCode:str(200),...replay},false,'restore_building_white_model'],
 ['delete',{assetId:uuid,...replay},false,'delete_group_model']
]) add('models.'+name,fields,readOnly,'features/models/group-model-library.js -> '+source);
for(const kind of ['Tasks','Messages']){
 add('community.list'+kind,context,true,'app.js;community_tasks;message-edits');
 add('community.create'+kind.slice(0,-1),{...context,body:multiline(),category:optional(displayField(100)),lng:optional(nullable(field(v=>Number.isFinite(v)&&Math.abs(v)<=180,113))),lat:optional(nullable(field(v=>Number.isFinite(v)&&Math.abs(v)<=90,23))),targetLayerKey:optional(nullable(choice('building','road','water'))),targetObjectCode:optional(nullable(str(200))),...replay},false,'app.js;community_tasks;object_attribute_edits');
 add('community.update'+kind.slice(0,-1),{...context,id:integer(1),body:multiline(),revision:integer(),...replay},false,'app.js;community_tasks;object_attribute_edits');
 add('community.delete'+kind.slice(0,-1),{...context,id:integer(1),...replay},false,'app.js;community_tasks;object_attribute_edits');
}
add('community.react',{...context,id:integer(1),reaction:choice('like','none','toggle'),...replay},false,'app.js:message-edits');
for(const [name,fields,readOnly] of [
 ['listReplies',{id:integer(1)},true],['addReply',{id:integer(1),body:multiline(200),...replay},false],['deleteReply',{id:integer(1),replyId:id,...replay},false],
 ['likeReply',{id:integer(1),replyId:id,...replay},false],['listLikes',{id:integer(1)},true],
 ['transition',{id:integer(1),status:choice('resolved','archived'),...replay},false],['stats',{},true]
])add('community.'+name,{...context,...fields},readOnly,'community-tasks.js');
add('mc.getConfig',context,true,'features/mc/mc-bridge.js;mc_sync_config');
add('mc.exportBuildings',{...context,...replay},false,'features/mc/mc-bridge.js;mc_building_state');
for(const [name,fields,readOnly,source] of [
 ['availability',{kind:choice('geoprocessing','facade','cloud-facade')},true,'get_worker_availability;get_facade_worker_availability;facade-cloud:capability'],
 ['sourceStatus',{villageId:uuid},true,'get_geoprocessing_source_status'],
 ['submitGeo',{...context,courseId:id,requestedSteps:list(choice('buildings','roads_water','contours'),3,1),aoi:json,parameters:json,...replay},false,'submit_geoprocessing_run'],
 ['submitFacade',{...context,courseId:id,objectCode:str(200),photoId:integer(1),kind:choice('facade','cloud-facade'),generationMethod:optional(choice('texture','components')),modelPurpose:optional(choice('existing','design')),buildingWidth:optional(field(v=>Number.isFinite(v)&&v>=3&&v<=40,12)),buildingDepth:optional(field(v=>Number.isFinite(v)&&v>=2&&v<=30,8)),footprintRectangularity:optional(field(v=>Number.isFinite(v)&&v>=0&&v<=1,1)),...replay},false,'submit_facade_run;facade-cloud:submit'],
 ['get',{requestId:uuid},true,'geoprocessing_runs;facade_generation_runs;cloud_facade_runs'],
 ['list',{villageId:uuid},true,'geoprocessing_runs;facade_generation_runs;cloud_facade_runs'],
 ['artifacts',{requestId:uuid},true,'geoprocessing_artifacts;facade_generation_artifacts'],
 ['cancel',{taskId:uuid,...replay},false,'request_geoprocessing_cancel;request_facade_cancel'],
 ['retry',{taskId:uuid,...replay},false,'retry_failed_facade_run'],
 ['confirmCrop',{taskId:uuid,cropTop:field(v=>Number.isFinite(v)&&v>=0&&v<=0.65,0.1),roofType:choice('hip','gable','flat'),buildingWidth:field(v=>Number.isFinite(v)&&v>0&&v<=500,10),buildingDepth:field(v=>Number.isFinite(v)&&v>0&&v<=500,10),floors:optional(integer(1,6)),roofCount:optional(integer(1,2)),...replay},false,'confirm_facade_crop'],
 ['importResult',{taskId:uuid,spaceId:id,...replay},false,'import_geoprocessing_result'],
 ['isImported',{taskId:uuid,spaceId:id},true,'personal_result_bundles']
]) add('tasks.'+name,fields,readOnly,'features/geoprocessing/geoprocessing-client.js;rural_house_generator/facade-queue-client.js;facade-cloud-client.js -> '+source);

export const OPERATIONS = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([name,d])=>[name,Object.freeze({path:d.path,method:d.method,readOnly:d.readOnly,replaySafe:Object.hasOwn(d.fields,'requestId')&&!d.readOnly,source:d.source,fields:Object.freeze(Object.keys(d.fields)),proof:'business-api/test/unified-contracts.test.mjs:all fixed action contracts'})])));
export function exampleInput(action) {
  const d=definitions[action];if(!d)throw fault('NOT_FOUND');
  return structuredClone(Object.fromEntries(Object.entries(d.fields).map(([key,f])=>[key,f.example])));
}
export function jsonTree(value,depth=0,budget={nodes:0}) {
  if(depth>32||++budget.nodes>100000)invalid();
  if(Array.isArray(value)){for(const item of value)jsonTree(item,depth+1,budget);}
  else if(plain(value)){
    for(const key of Reflect.ownKeys(value)){
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)invalid();
      jsonTree(descriptor.value,depth+1,budget);
    }
  }else if(value!==null&&(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)))invalid();
}
export function parseOperation(action,input) {
  if(typeof action!=='string'||!Object.hasOwn(definitions,action))throw fault('NOT_FOUND');
  const d=definitions[action];if(!plain(input))invalid();jsonTree(input);
  if(Buffer.byteLength(JSON.stringify(input),'utf8')>MAX_JSON_BYTES)throw fault('PAYLOAD_TOO_LARGE');
  if(Object.keys(input).some(key=>!Object.hasOwn(d.fields,key)))invalid();
  for(const [key,f] of Object.entries(d.fields))if(Object.hasOwn(input,key)?!f.check(input[key]):f.required)invalid();
  if(action==='tasks.submitFacade'&&input.generationMethod==='components'&&
     (input.kind!=='facade'||!['buildingWidth','buildingDepth','footprintRectangularity'].every(key=>Object.hasOwn(input,key))))invalid();
  return {action,input:structuredClone(input),readOnly:d.readOnly};
}
