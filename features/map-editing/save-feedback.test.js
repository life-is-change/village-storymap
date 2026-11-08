const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('a newly saved building can be deleted before its review appears in the local list',async()=>{
 const window={PersonalEditVersionModule:{withFeatureVersion:x=>x}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/geometry-editor.js','utf8'),{window,console});
 const api=window.GeometryEditorModule, snapshots=[];
 const feature={get:key=>({layerKey:'building',sourceCode:'b',baseRow:{}}[key])};
 const state={mode:'idle',dirtyCodes:new Set(['building::b']),deletedCodes:new Set(),pendingAddedFeatures:[feature],pendingDeletedFeatures:[],originalGeoms:new Map()};
 const featureKey = (layer, code) => layer + '::' + code;
 const locks = new Map([['building::b', {lockToken:'add-lock'}]]);
 let serverReview = null;
 let reviewReads = 0;
 api.getFeaturesOnMapByLayer=()=>state.pendingAddedFeatures;
 api.clearBuildingInteractions=()=>api.updateBuildingEditorToolbarState();
 api.updateBuildingEditorToolbarState=()=>snapshots.push([state.pendingDeletedFeatures.length,!!state.isSaving]);
 const deps={getBuildingEditState:()=>state,isEditableSpace:()=>true,isEditableGeometryLayer:()=>true,getLayerLabel:()=>'',getCurrent2DBuildingSpaceId:()=> 's',getLayerCodeField:()=> 'id',getLayerNameField:()=> 'name',normalizeCode:String,buildDirtyFeatureKey:featureKey,olFeatureToDbGeometry:()=>({}),cloneJson:x=>({...x}),summarizeFeatureChanges:()=>({text:'保存'}),requestFeatureSaveNote:async()=>'',saveFeatureEditBatch:async({changes})=>{
   const [change] = changes;
   assert.equal(changes.length, 1);
   assert.equal(change.objectCode, 'b');
   if (serverReview) {
     assert.equal(change.action, 'delete');
     assert.equal(change.lockToken, 'delete-lock');
     assert.equal(change.expectedGeometryRevision, 1);
     serverReview = null;
   } else {
     assert.equal(change.action, 'add');
     assert.equal(change.lockToken, 'add-lock');
     assert.equal(change.expectedGeometryRevision, 0);
     serverReview = {geometryRevision: 1};
   }
   return {success:true};
 },getCurrentUserName:()=>'',refresh2DOverlay:async()=>{},sync2DSpaceStateTo3D:()=>{},getVillage3D:()=>null,releaseAllFeatureEditLocks:async()=>locks.clear(),showToast:()=>{}};
 const app = fs.readFileSync(__dirname+'/../../app.js','utf8');
 deps.getSurveyGeometryEvidence = vm.runInNewContext(
   app.slice(app.indexOf('async function getSurveyGeometryEvidence('), app.indexOf('\nfunction applyCurrentSurveyReviewOverlay(')) + ';getSurveyGeometryEvidence',
   {
     usesSharedSurveyGeometryWorkflow: () => true,
     buildingEditState: {activeFeatureLocks: locks},
     buildDirtyFeatureKey: featureKey,
     surveyReviewKey: (layer, code) => layer + ':' + code,
     surveyReviewByKey: new Map(),
     getSurveyReviewClient: () => ({getReview: async (layer, code) => {
       assert.equal(layer, 'building');
       assert.equal(code, 'b');
       reviewReads += 1;
       return serverReview;
     }}),
     window: {SurveyReviewModelModule:{normalizeReviewRow: row => row}}
   }
 );
 assert.equal((await api.saveDirtyBuildings(deps)).success,true);
 assert.equal(reviewReads, 0);
 assert.equal(locks.size, 0);
 locks.set('building::b', {lockToken:'delete-lock'});
 state.pendingDeletedFeatures.push(feature);
 assert.equal((await api.saveDirtyBuildings(deps)).success,true);
 assert.equal(reviewReads, 1);
 assert.equal(serverReview, null);
 assert.deepEqual(snapshots.at(-1),[0,false]);
});
