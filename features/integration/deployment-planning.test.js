const test=require('node:test'),assert=require('node:assert/strict');
const sessions=require('../data/feature-edit-session.js');
const c={teachingProjectId:'p',villageId:'v',spaceId:'s',spaceType:'formal_shared'};
test('local edit locks never report offline success or call the source client',async()=>{
 const calls=[],d={services:{planning:{async execute(a,p){calls.push([a,p]);throw Object.assign(Error('DB_UNAVAILABLE'),{code:'DB_UNAVAILABLE'});}}},getContext:()=>c,getSupabaseClient(){throw Error('SOURCE_TOUCHED');}};
 await assert.rejects(sessions.acquireFeatureEditLock(d,{spaceId:'s',layerKey:'building',objectCode:'B1'},'Forged'),{code:'DB_UNAVAILABLE'});assert.equal(calls[0][0],'planning.acquireLock');assert.equal(Object.hasOwn(calls[0][1],'editorName'),false);
});
test('local personal edits retain version guard and avoid source table upserts',async()=>{
 const {createPersonalSpaceClient}=require('../data/personal-space-client.js'),calls=[];
 const client=createPersonalSpaceClient({services:{planning:{async execute(a,p){calls.push([a,p]);return a==='personal.listSelections'?[{layer_key:'building',current_version_id:'version'}]:1;}}},uuid:()=> 'request'});
 await client.upsertFeature({spaceId:'space',versionId:'version',layerKey:'building',objectCode:'B1',geom:{type:'Polygon'},props:{}});
 assert.equal(calls.at(-1)[0],'personal.saveBatch');assert.equal(calls.at(-1)[1].changes[0].layerVersionId,'version');assert.equal(calls.at(-1)[1].changes[0].afterGeom.type,'Polygon');
 await assert.rejects(client.upsertFeature({spaceId:'space',versionId:'version',layerKey:'contours',objectCode:'C1',geom:{}}),/CONTOURS_READ_ONLY/);
});

test('local feature reads never fall back to unscoped source cache and raw writes require an edit session',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),window={},sandbox={window,console};vm.runInNewContext(fs.readFileSync('features/data/feature-db.js','utf8'),sandbox);const calls=[];
 const deps={getContext:()=>c,services:{planning:{async execute(a,p){calls.push([a,p]);throw Object.assign(Error('DB_UNAVAILABLE'),{code:'DB_UNAVAILABLE'});}}},getSupabaseClient(){throw Error('SOURCE_TOUCHED');}};
 await assert.rejects(window.FeatureDbModule.listBuildingFeaturesFromDb(deps,'s'),{code:'DB_UNAVAILABLE'});
 await assert.rejects(window.FeatureDbModule.upsertBuildingFeatureToDb(deps,{spaceId:'s',objectCode:'B1',geom:{}}),/EDIT_SESSION_REQUIRED/);
 assert.equal(calls[0][0],'planning.listFeatures');
});
test('local baseline operations map fixed actions and preserve optimistic base revision',async()=>{
 const {createGroupBaselineClient}=require('../data/group-baseline-client.js');const calls=[];
 const client=createGroupBaselineClient({services:{planning:{async execute(a,p){calls.push([a,p]);return [];}}},getContext:()=>({...c,spaceType:'group_plan'}),uuid:()=> 'request'});
 await client.applyUpdate({targetSnapshotId:'target',expectedBaseSnapshotId:'old'});await client.listConflicts();
 assert.equal(calls[0][0],'planning.applyBaseline');assert.equal(calls[0][1].expectedBaseSnapshotId,'old');assert.equal(calls[1][0],'planning.conflicts');
});
