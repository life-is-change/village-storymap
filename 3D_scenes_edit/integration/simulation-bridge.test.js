const test=require('node:test'),assert=require('node:assert/strict'),Studio=require('../index'),Documents=require('../domain/scene-document');
test('the scene studio opens simulation on the same Cesium viewer and persists config with conflict handling',async()=>{
 const context={userId:'u',teachingProjectId:'tp',courseId:'c',villageId:'v',spaceId:'s',groupId:'g',baselineRevision:2,baselineFeatures:[],projectId:'p',seedAssets:[]};
 let doc=Documents.create({...context,selectionBoundary:{type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23.001],[113,23]]]},scopeKind:'group'}),workspaceOptions,disposed=false,conflict=false;
 const viewer={marker:'existing Cesium'},root={innerHTML:'',dataset:{},classList:{add(){},remove(){}},setAttribute(){},addEventListener(){},removeEventListener(){},focus(){}};
 const client={loadProject:async()=>({ok:true,data:structuredClone(doc)}),listVersions:async()=>({ok:true,data:[]}),saveDraft:async d=>{if(conflict)return {ok:false,code:'REVISION_CONFLICT',remoteRevision:99};doc={...structuredClone(d),revision:d.revision+1};return {ok:true,data:{revision:doc.revision}};}};
 const studio=await Studio.create({root,context,services:{client,adapter:{mount(){},render(){},setAssets(){},dispose(){}},preview:{async render(){},select(){},dispose(){}},interactions:{activate(){},cancel(){},dispose(){}},localStore:{read(){return null;},write(){}}},ensure3D:async()=>({viewer,Cesium:{}}),simulationApi:{open(o){workspaceOptions=o;return {dispose(){disposed=true;}};}}});
 assert.equal((await studio.dispatch({type:'simulation'})).ok,true);assert.equal(workspaceOptions.environment.viewer,viewer);
 assert.equal(studio.dispatch({type:'undo'}).code,'SIMULATION_ACTIVE','editing is suspended while a frozen simulation is open');
 const config={version:1,test:'stored through normal document metadata'};workspaceOptions.writeConfig(config);assert.equal((await workspaceOptions.save()).ok,true);assert.deepEqual(doc.metadata.simulation,config);assert.equal(doc.metadata.scopeKind,'group');
 workspaceOptions.writeConfig({...config,test:'conflict stays local'});conflict=true;assert.equal((await workspaceOptions.save()).code,'REVISION_CONFLICT');assert.equal(doc.metadata.simulation.test,'stored through normal document metadata');studio.dispose();assert.equal(disposed,true);assert.throws(()=>workspaceOptions.readDocument(),/场景已关闭/);
});
