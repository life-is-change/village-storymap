const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
function fn(name){const start=app.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);const tail=app.slice(start+1),next=tail.search(/^\s*(?:async )?function [a-zA-Z_]/m);return next<0?app.slice(start):app.slice(start,start+1+next);}
const model=require('../villages/village-model.js');
function spaceSync({result=false}={}){
 const ordinary={id:'own',actualSpaceId:'own',spaceType:'practice_personal',ownerId:'me',teachingProjectId:'p',villageId:'v'};
 const produced={id:'result',spaceType:'practice_personal',personalLayerVersionSpace:true,ownerId:'me',teachingProjectId:'p',villageId:'v',selectedLayers:['building']};
 const s={spaces:[ordinary,...(result?[produced]:[])],currentSpaceId:result?'result':'own',BASE_SPACE_ID:'current',lastPlanningSpaceId:'own',
  coursePersonalSpace:result?{id:'result',owner_id:'me',teaching_project_id:'p',village_id:'v'}:null,
  activeVillageContext:{teachingProjectId:'p',villageId:'v',villageRole:'practice',actor:{userId:'me'}},courseWorkbench:null,
  loadSpacesFromSupabase:async()=>[ordinary],getCourseUser:()=>({name:'Me'}),hasUnsavedGeometryEdits:()=>false,
  saveAppState(){},getDefaultSpaces:()=>[{id:'current',title:'fake shared'}],ensureUniqueSpaceTitles:x=>x,renderSpaceList(){},sync2DSpaceStateTo3D(){},
  window:{VillageModelModule:model,VillageAuth:{getCurrentUser:()=>({id:'me'})},VillageBusinessServices:{mode:'aliyun'}},localStorage:{setItem(){}},getAccountStorageKey:x=>x,SPACE_STORAGE_KEY:'spaces',console,
  getSpaceById:id=>s.spaces.find(x=>x.id===id),getCurrentSpace:()=>s.spaces.find(x=>x.id===s.currentSpaceId),getValidSpaceId:(id,fallback)=>s.spaces.some(x=>x.id===id)?id:fallback};
 const run=vm.runInNewContext(fn('mapContextSpaceToWorkspace')+'\n'+fn('syncSpacesFromSupabase')+';syncSpacesFromSupabase',s);return {s,run};
}
test('authorized personal-only catalog never manufactures an inaccessible shared BASE space',async()=>{
 const f=spaceSync();await f.run();assert.deepEqual(f.s.spaces.map(x=>x.id),['own']);assert.equal(f.s.currentSpaceId,'own');
});
test('catalog refresh retains the authenticated result-version space and current selection',async()=>{
 const f=spaceSync({result:true});await f.run();assert.equal(f.s.spaces.find(x=>x.id==='result')?.personalLayerVersionSpace,true);assert.equal(f.s.currentSpaceId,'result');
});
test('a user without a shared catalog space enters their authorized experience space',async()=>{
 const selected=[],own={id:'own',spaceType:'practice_personal'};
 const run=vm.runInNewContext(fn('openCoursePlanningWorkspace')+';openCoursePlanningWorkspace',{BASE_SPACE_ID:'current',getSpaceById:()=>null,getCurrentSpace:()=>own,showToast(){},setCurrentSpaceIdAndRemember:id=>selected.push(id),saveSpacesToStorage(){},saveAppState(){},sync2DSpaceStateTo3D(){},handleSpaceSelect:async id=>selected.push(id)});
 await run('2d',null);assert.deepEqual(selected,['own','own']);
});
function eventFixture(state){
 const events=[];let callback,scheduled;let space={id:'own'};
 const s={businessEventClient:null,businessEventContextKey:'',activeVillageContext:{teachingProjectId:'p',villageId:'v'},buildingEditState:state,
  window:{VillageAuth:{getCurrentUser:()=>({id:'me'})},VillageBusinessServices:{events:{createClient(options){callback=options.onInvalidate;return {start:async()=>{},stop:async()=>{}};}}}},getCurrentSpace:()=>space,
  getAccountStorageKey:x=>x,setSurveyRealtimeState(){},scheduleRealtimeRefresh:run=>scheduled=run,hasUnsavedGeometryEdits:()=>state.isDrawingActive||state.isSaving||state.dirtyCodes.size||state.pendingDeletedFeatures.length||state.pendingAddedFeatures?.length,
  invalidateBuildingDbCache(){},invalidateRoadDbCache(){},invalidateCroplandDbCache(){},invalidateOpenSpaceDbCache(){},invalidateWaterDbCache(){},invalidateCommunityTaskCache(){},currentSpaceId:'own',
  syncSpacesFromSupabase:async()=>events.push('spaces'),renderSpaceList:()=>events.push('render'),refreshCommunityTasksOnMapAsync:async()=>{},refreshCommunityScoreBadge:async()=>{},refreshCommunityMessageBoard:async()=>{},refreshSurveyReviewState:async()=>{},
  showToast:message=>events.push(message),plan2dView:{classList:{contains:()=>true}},model3dView:{classList:{contains:()=>false}},refresh2DOverlay:async()=>events.push('overlay')};
 const start=vm.runInNewContext(fn('syncBusinessEventSubscription')+';syncBusinessEventSubscription',s);
 return {events,async fire(){await start();callback({kind:'refresh'});await scheduled();},async late(){await start();callback({kind:'planning'});space={id:'different'};await scheduled();}};
}
for(const mode of ['drawing','saving','dirty'])test(`event reconnect leaves a ${mode} draft and space list untouched`,async()=>{
 const state={isDrawingActive:mode==='drawing',isSaving:mode==='saving',dirtyCodes:new Set(mode==='dirty'?['building::52']:[]),pendingDeletedFeatures:[],pendingAddedFeatures:[]};
 const f=eventFixture(state);await f.fire();assert.deepEqual(f.events,[]);
});
test('an event queued for a previous space cannot refresh the newly selected space',async()=>{
 const f=eventFixture({dirtyCodes:new Set(),pendingDeletedFeatures:[],pendingAddedFeatures:[]});await f.late();assert.deepEqual(f.events,[]);
});

test('a background overlay response cannot commit if drawing starts while its data is loading',async()=>{
 let busy=false,committed=false,finish;
 const s={overlayRefreshController:null,activeVillageContext:{villageId:'v'},getAccountStorageKey:()=> 'me',hasUnsavedGeometryEdits:()=>busy,
  buildOverlayRendererDeps:()=>({}),applyCurrentSurveyReviewOverlay(){},getOverlayRendererModule:()=>({
   createLatestOverlayRefreshController({render}){return {request:payload=>render({payload,isCurrent:()=>true})};},
   async refresh2DOverlay(deps,request){await new Promise(resolve=>finish=resolve);committed=request.isCurrent();return {stale:!committed};}
  })};
 const run=vm.runInNewContext(fn('refresh2DOverlay')+';refresh2DOverlay',s);
 const pending=run({preserveGeometryDraft:true});busy=true;finish();await pending;assert.equal(committed,false);
});

test('group background refresh protects drawings begun while overlay data is loading',async()=>{
 let busy=false,committed=false,finish;
 const space={id:'group',spaceType:'group_plan'};
 const s={overlayRefreshController:null,activeVillageContext:{villageId:'v'},getAccountStorageKey:()=> 'me',hasUnsavedGeometryEdits:()=>busy,
  getCurrentSpace:()=>space,groupPlanLoader:null,buildingEditState:{dirtyCodes:new Set(),pendingDeletedFeatures:[]},groupBaselinePanel:null,
  plan2dView:{classList:{contains:()=>true}},model3dView:{classList:{contains:()=>false}},window:{},showToast(){},
  buildOverlayRendererDeps:()=>({}),applyCurrentSurveyReviewOverlay(){},getOverlayRendererModule:()=>({
   createLatestOverlayRefreshController({render}){return {request:payload=>render({payload,isCurrent:()=>true})};},
   async refresh2DOverlay(deps,request){await new Promise(resolve=>finish=resolve);committed=request.isCurrent();return {stale:!committed};}
  })};
 const run=vm.runInNewContext(fn('refresh2DOverlay')+'\n'+fn('refreshActiveGroupPlan')+';refreshActiveGroupPlan',s);
 const pending=run();busy=true;finish();await pending;assert.equal(committed,false);
});
test('numeric static building identifiers are strings before crossing the typed HTTP API boundary',()=>{
 const ctx={getFeatureProperties:f=>f.properties,layerConfigs:{building:{codeFields:['ID']}}};
 const read=vm.runInNewContext(fn('getFirstMatchingField')+'\n'+fn('getFeatureCode')+';getFeatureCode',ctx);
 assert.equal(read({properties:{ID:52}},'building'),'52');assert.equal(read({properties:{ID:0}},'building'),'0');
});


async function geometrySave({fail=false,refreshFail=false}={}){
 const {parseOperation}=await import('../../business-api/unified/contracts.mjs');
 const feature={get:key=>({layerKey:'building',sourceCode:'HNEW',baseRow:{},displayName:'HNEW'}[key])};
 const state={mode:'idle',editLayerKey:'building',dirtyCodes:new Set(['building::HNEW']),pendingAddedFeatures:[feature],pendingDeletedFeatures:[],deletedCodes:new Set(),originalGeoms:new Map()};
 const messages=[],window={PersonalEditVersionModule:require('../data/personal-edit-version.js')};
 vm.runInNewContext(fs.readFileSync('features/map-editing/geometry-editor.js','utf8'),{window,console:{error(){},warn(){}},setTimeout});
 const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'owned'};
 const edit=require('../data/feature-edit-session.js');let busy;
 const deps={getBuildingEditState:()=>state,isEditableSpace:()=>true,isEditableGeometryLayer:()=>true,getLayerLabel:()=> '建筑',getCurrent2DBuildingSpaceId:()=>c.spaceId,
  getPlanVectorSource:()=>({getFeatures:()=>[feature]}),getPlanMap:()=>null,getPlanVectorLayer:()=>null,buildDirtyFeatureKey:(k,c)=>k+'::'+c,
  getLayerCodeField:()=> 'code',getLayerNameField:()=> 'name',normalizeCode:String,cloneJson:x=>JSON.parse(JSON.stringify(x)),
  olFeatureToDbGeometry:()=>({type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23]]]}),getFeatureEditLockToken:()=>null,
  summarizeFeatureChanges:()=>({text:'新增建筑'}),requestFeatureSaveNote:async()=>'',getCurrentUserName:()=> 'Me',
  saveFeatureEditBatch:input=>edit.saveFeatureEditBatch({getContext:()=>c,services:{planning:{async execute(action,input){busy=state.isSaving;parseOperation(action,JSON.parse(JSON.stringify(input)));if(fail)throw Error('DB_UNAVAILABLE');return 'batch';}}}}, {...input,requestId:'c0000000-0000-4000-8000-000000000001'}),
  refresh2DOverlay:async()=>{if(refreshFail)throw Error('REFRESH_FAILED');},sync2DSpaceStateTo3D(){},getVillage3D:()=>null,showToast:message=>messages.push(message)};
 const result=await window.GeometryEditorModule.saveDirtyBuildings(deps);return {state,result,busy,messages};
}
test('ordinary personal add omits a null optional lock UUID and marks saving busy through the API request',async()=>{
 const f=await geometrySave();assert.equal(f.result.success,true);assert.equal(f.busy,true);assert.equal(f.state.dirtyCodes.size,0);assert.equal(f.state.isSaving,false);
});
test('failed personal saves retain the added feature and dirty state for retry',async()=>{
 const f=await geometrySave({fail:true});assert.equal(f.result.success,false);assert.equal(f.busy,true);assert.equal(f.state.dirtyCodes.size,1);assert.equal(f.state.pendingAddedFeatures.length,1);assert.equal(f.state.isSaving,false);
});
test('a committed personal save is not reported as rejected when only the subsequent view refresh fails',async()=>{
 const f=await geometrySave({refreshFail:true});assert.equal(f.result.success,true);assert.equal(f.state.dirtyCodes.size,0);assert.ok(f.messages.some(x=>x.includes('已保存')));
});
