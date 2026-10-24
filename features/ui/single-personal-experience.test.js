const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
function fn(name){const start=app.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);const next=app.slice(start+1).search(/^\s*(?:async )?function [a-zA-Z_]/m);return next<0?app.slice(start):app.slice(start,start+1+next);}

test('Aliyun initializes internal result storage without adding another selectable personal workspace',async()=>{
 const own={id:'own',actualSpaceId:'own',spaceType:'practice_personal',ownerId:'me',teachingProjectId:'p',villageId:'v'};
 const ctx={spaces:[own],currentSpaceId:'own',supabaseClient:{},coursePersonalSpaceInitToken:0,personalSpaceClient:null,coursePersonalSpace:null,
  activeVillageContext:{teachingProjectId:'p',villageId:'v',villageRole:'practice'},getCourseUser:()=>({name:'Me'}),getSpaceById:id=>ctx.spaces.find(s=>s.id===id),
  window:{VillageBusinessServices:{mode:'aliyun'},PersonalSpaceClientModule:{createPersonalSpaceClient:()=>({ensure:async()=>({id:'internal',owner_id:'me',experience_space_id:'own'}),listSelections:async()=>[]})},
   GeoprocessingContextModule:{resolveGeoprocessingContext:()=>({personalVillageId:'v'})},CourseModelModule:{DEFAULT_COURSE:{id:'course'}},
   CourseWorkspaceAdapterModule:require('../course/course-workspace-adapter.js')},saveSpacesToStorage(){},renderSpaceList(){}};
 await vm.runInNewContext(fn('isPersonalLayerVersionSpace')+'\n'+fn('initializeCoursePersonalSpace')+';initializeCoursePersonalSpace',ctx)();
 assert.equal(ctx.spaces.length,1);assert.equal(ctx.spaces[0].id,'own');assert.equal(ctx.coursePersonalSpace.id,'internal');
});

test('shared catalog preserves server readonly projection and applied personal layer metadata',()=>{
 const ctx={spaces:[],BASE_SPACE_ID:'current',getSpaceById:()=>null};
 const map=vm.runInNewContext(fn('mapContextSpaceToWorkspace')+';mapContextSpaceToWorkspace',ctx);
 const own=map({id:'own',spaceType:'practice_personal',appliedResultLayers:['building','contours'],readonly:false},'practice');
 assert.deepEqual(Array.from(own.appliedResultLayers||[]),['building','contours']);
 const shared=map({id:'shared',spaceType:'practice_shared',readonly:true},'practice');assert.equal(shared.readonly,true);assert.equal(shared.editEnabled,false);
});

test('only an administrator bypasses shared membership; a readonly catalog cannot be made editable by a display name',()=>{
 const read=vm.runInNewContext(fn('canManageSpace')+';canManageSpace',{buildingEditState:{},BASE_SPACE_ID:'current',currentUserName:'User',surveyRealtimeState:'connected',
  normalizeIdentityName:x=>x,isAdminIdentity:x=>x==='Admin',getSpaceCreatorName:()=>'',getSpaceById:()=>null,window:{},courseWorkbench:null});
 assert.equal(read({id:'current',spaceType:'practice_shared',readonly:true},'User'),false);
 assert.equal(read({id:'current',spaceType:'practice_shared',readonly:false},'User'),true);
});

test('completed imported results remain explicitly applicable to experience space and offer clearing the preview',()=>{
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync('features/geoprocessing/geoprocessing-panel.js','utf8'),ctx);
 const html=ctx.window.GeoprocessingPanelModule.renderRunStatus({id:'run',status:'completed',imported:true},{personalExperience:true});
 assert.ok(html.includes('data-save-run'));assert.ok(html.includes('应用到个人体验空间'));assert.ok(html.includes('data-discard-preview'));
});

test('result application refreshes the canonical workspace and fences a changed village before selecting a version',async()=>{
 for(const stale of [false,true]){
  const calls=[],own={id:'own',selectedLayers:['road']};
  const ctx={coursePersonalSpace:{id:'internal',experience_space_id:'own'},activeVillageContext:{villageId:'v'},
   personalSpaceClient:{invalidateCache(){},async listSelections(){if(stale)ctx.activeVillageContext={villageId:'different'};return [{layer_key:'building',current_version_id:'version'},{layer_key:'road',current_version_id:'unrelated'}];},async setCurrentVersion(...args){calls.push(['apply',...args]);}},
   window:{VillageBusinessServices:{mode:'aliyun'}},async syncSpacesFromSupabase(options){assert.equal(options.application,true);calls.push(['refresh']);},
   geoprocessingResultPreview:{clear(){calls.push(['clear']);}},getSpaceById:id=>id==='own'?own:null,setCurrentSpaceIdAndRemember:id=>calls.push(['select',id]),saveSpacesToStorage(){},renderSpaceList(){},handleSpaceSelect:async()=>{},showToast(){}};
  const run=vm.runInNewContext(fn('applyImportedPersonalResults')+';applyImportedPersonalResults',ctx);
  if(stale){await assert.rejects(run('clicked-bundle'),/CONTEXT_CHANGED/);assert.equal(calls.filter(x=>x[0]==='select').length,0);}
  else{await run('clicked-bundle');assert.deepEqual(calls,[['apply','internal','bundle','clicked-bundle'],['refresh'],['clear'],['select','own']]);assert.deepEqual(Array.from(own.selectedLayers),['road','building']);}
 }
});
