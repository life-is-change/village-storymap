const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('successful deletion refreshes toolbar after clearing the draft, including saving flag',async()=>{
 const window={PersonalEditVersionModule:{withFeatureVersion:x=>x}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/geometry-editor.js','utf8'),{window,console});
 const api=window.GeometryEditorModule, snapshots=[];
 const feature={get:key=>({layerKey:'building',sourceCode:'b',baseRow:{}}[key])};
 const state={mode:'idle',dirtyCodes:new Set(),deletedCodes:new Set(),pendingDeletedFeatures:[feature],originalGeoms:new Map()};
 api.getFeaturesOnMapByLayer=()=>[];
 api.clearBuildingInteractions=()=>api.updateBuildingEditorToolbarState();
 api.updateBuildingEditorToolbarState=()=>snapshots.push([state.pendingDeletedFeatures.length,!!state.isSaving]);
 const deps={getBuildingEditState:()=>state,isEditableSpace:()=>true,isEditableGeometryLayer:()=>true,getLayerLabel:()=>'',getCurrent2DBuildingSpaceId:()=> 's',getLayerCodeField:()=> 'id',getLayerNameField:()=> 'name',normalizeCode:String,olFeatureToDbGeometry:()=>({}),cloneJson:x=>x,summarizeFeatureChanges:()=>({text:'删除'}),requestFeatureSaveNote:async()=>'',saveFeatureEditBatch:async()=>({success:true}),getCurrentUserName:()=>'',refresh2DOverlay:async()=>{},sync2DSpaceStateTo3D:()=>{},getVillage3D:()=>null,showToast:()=>{}};
 assert.equal((await api.saveDirtyBuildings(deps)).success,true);
 assert.deepEqual(snapshots.at(-1),[0,false]);
});
