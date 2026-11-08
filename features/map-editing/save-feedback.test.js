const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('a newly saved building can be deleted before its review appears in the local list',async()=>{
 const window={PersonalEditVersionModule:{withFeatureVersion:x=>x}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/geometry-editor.js','utf8'),{window,console});
 const api=window.GeometryEditorModule, snapshots=[];
 let objectCode = 'H001';
 const persistedCode = 'B-N-abc123';
 const feature={get:key=>({layerKey:'building',sourceCode:objectCode,baseRow:{}}[key])};
 const state={mode:'idle',dirtyCodes:new Set(['building::H001']),deletedCodes:new Set(),pendingAddedFeatures:[feature],pendingDeletedFeatures:[],originalGeoms:new Map()};
 const normalizeCode = code => String(code).replace(/-/g, '').toUpperCase();
 const featureKey = (layer, code) => layer + '::' + normalizeCode(code);
 const locks = new Map([[featureKey('building', objectCode), {lockToken:'add-lock'}]]);
 let serverReview = null;
 let reviewReads = 0;
 api.getFeaturesOnMapByLayer=()=>state.pendingAddedFeatures;
 api.clearBuildingInteractions=()=>api.updateBuildingEditorToolbarState();
 api.updateBuildingEditorToolbarState=()=>snapshots.push([state.pendingDeletedFeatures.length,!!state.isSaving]);
 const deps={getBuildingEditState:()=>state,isEditableSpace:()=>true,isEditableGeometryLayer:()=>true,usesSharedSurveyGeometryWorkflow:()=>true,getLayerLabel:()=>'',getCurrent2DBuildingSpaceId:()=> 's',getLayerCodeField:()=> 'id',getLayerNameField:()=> 'name',normalizeCode,buildDirtyFeatureKey:featureKey,olFeatureToDbGeometry:()=>({}),cloneJson:x=>({...x}),summarizeFeatureChanges:()=>({text:'保存'}),requestFeatureSaveNote:async()=>'',saveFeatureEditBatch:async({changes})=>{
   const [change] = changes;
   assert.equal(changes.length, 1);
   assert.equal(change.objectCode, objectCode);
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
       reviewReads += 1;
       return code === persistedCode ? serverReview : null;
     }}),
     window: {SurveyReviewModelModule:{normalizeReviewRow: row => row}}
   }
 );
 assert.equal((await api.saveDirtyBuildings(deps)).success,true);
 assert.equal(reviewReads, 0);
 assert.equal(locks.size, 0);
 objectCode = persistedCode;
 locks.set(featureKey('building', objectCode), {lockToken:'delete-lock'});
 state.pendingDeletedFeatures.push(feature);
 assert.equal((await api.saveDirtyBuildings(deps)).success,true);
 assert.equal(reviewReads, 1);
 assert.equal(serverReview, null);
 assert.deepEqual(snapshots.at(-1),[0,false]);
});
