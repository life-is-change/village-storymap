const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let api;try{api=require('../data/scene-services.js');}catch{api={};}
const context={userId:'10000000-0000-4000-8000-000000000001',teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',courseId:'course',groupId:'g',spaceId:'A',baselineRevision:0,baselineFeatures:[]};
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),keys:()=>[...m.keys()]};}
test('real platform open options inject the local scene client and callbacks',()=>{
 const source=fs.readFileSync('app.js','utf8'),start=source.indexOf('function buildSceneStudioOpenOptions('),fn=source.slice(start,source.indexOf('\n}',start)+2);const local={client:{},dispose(){},resolveAssetUrl(){},createObjectURL(){}};
 const sandbox={window:{SceneStudioStartupModule:{create3DReadiness:()=>async()=>({})},VillageBusinessServices:{scene:{createServices(){return local;}}}},ensureVillage3DLoaded(){},sceneStudioMount:{},supabaseClient:{},planMap:{},localStorage:storage(),renderSceneStudioViewport(){},closeSceneStudioWorkspace(){},uploadSceneStudioAsset(){},createSceneStudioMilestone(){},downloadSceneStudioLocalCopy(){},resolveSceneStudioAssetUrl(){}};
 vm.createContext(sandbox);vm.runInContext(fn+';this.build=buildSceneStudioOpenOptions',sandbox);
 const options=sandbox.build(context);assert.equal(options.services,local);assert.equal(typeof options.onMilestone,'function');
});
test('milestones use the atomic preview session and cancelled or failed captures never create versions',async()=>{
 assert.equal(typeof api.createSceneServices,'function');let commits=0;
 const service=api.createSceneServices({api:{dataClient:{createVersion(){throw Error('OLD_VERSION_ROUTE');}},async uploadPreview(input){commits++;assert.equal(input.purpose,'version-preview');assert.deepEqual(input.context,{projectId:'p',revision:3});return {ok:true,data:{id:'version'}};},dispose(){}},contextProvider:()=>context,instanceId:'aliyun-test',storage:storage()});
 const input={document:{projectId:'p',revision:3},label:'Milestone',description:''};
 assert.equal((await service.createMilestone({...input,previewBlob:null})).ok,false);assert.equal(commits,0);
 assert.equal((await service.createMilestone({...input,previewBlob:new Blob(['png'],{type:'image/png'})})).ok,true);assert.equal(commits,1);
 assert.equal((await service.client.createVersion(input)).ok,false);service.dispose();
});
test('private variant resolution uses asset identity, local drafts include instance and context, and disposal revokes owned blobs',async()=>{
 assert.equal(typeof api.createSceneServices,'function');const calls=[],revoked=[],s=storage();let current=context;
 const service=api.createSceneServices({api:{dataClient:{},resolveAsset:async(id,variant)=>(calls.push([id,variant]),{ok:true,url:'blob:private'}),dispose:()=>calls.push('disposed')},contextProvider:()=>current,instanceId:'aliyun-test',storage:s,createObjectURL:()=> 'blob:owned',revokeObjectURL:u=>revoked.push(u)});
 assert.equal(await service.resolveAssetUrl({id:'asset',storagePath:'malicious/ignored'}, {variant:'top'}),'blob:private');assert.deepEqual(calls[0],['asset','top']);
 await assert.rejects(service.resolveAssetUrl({storagePath:'private/no-id'}),/ASSET_ID_REQUIRED/);
 assert.equal(await service.resolveAssetUrl({id:'seed:bench:wood',url:'3D_scenes_edit/assets/models/bench.glb?v=1'}),'3D_scenes_edit/assets/models/bench.glb?v=1');
 await assert.rejects(service.resolveAssetUrl({id:'seed:bench:wood',url:'https://foreign.invalid/a.glb'}));
 service.localStore.write({...context,projectId:'p'},{revision:1,document:{}});assert.match(s.keys()[0],/aliyun-test/);assert.match(s.keys()[0],/a0000000/);assert.match(s.keys()[0],/b0000000/);
 service.createObjectURL(new Blob(['top']));service.dispose();assert.deepEqual(revoked,['blob:owned']);current={...context,userId:'other'};await assert.rejects(service.resolveAssetUrl({id:'asset'}));
});
test('the real studio saves, creates atomic milestones, reloads/restores and retains a conflicted local draft',async()=>{
 const Studio=require('../../3D_scenes_edit/index.js'),documents=require('../../3D_scenes_edit/domain/scene-document.js');
 let document=documents.create({projectId:'project',villageId:context.villageId,groupId:context.groupId,spaceId:context.spaceId,baselineRevision:0,selectionBoundary:{type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23.001],[113,23]]]}}),failSave=false,milestones=0,restored=0;
 const versions=[],savedStorage=storage();const service=api.createSceneServices({api:{
  dataClient:{async loadProject(){return {ok:true,data:structuredClone(document)};},async saveDraft(next){if(failSave)return {ok:false,code:'REVISION_CONFLICT',remoteRevision:99};document={...structuredClone(next),revision:next.revision+1};return {ok:true,data:{revision:document.revision}};},async listVersions(){return {ok:true,data:versions};},async restoreVersionAsDraft(){restored++;return {ok:true,data:{id:'restored'}};}},
  async uploadPreview(input){milestones++;versions.push({id:'milestone',document:structuredClone(document),label:input.record.label});return {ok:true,data:{id:'milestone'}};},dispose(){}
 },contextProvider:()=>context,instanceId:'local-studio',storage:savedStorage});
 const root={innerHTML:'',dataset:{},setAttribute(){},focus(){},addEventListener(){},removeEventListener(){}};
 const studio=await Studio.create({root,context:{...context,projectId:'project',seedAssets:[]},services:{...service,adapter:{mount(){},render(){},setAssets(){},dispose(){}},interactions:{activate(){},dispose(){}},preview:{async render(){},select(){},dispose(){}}},onMilestone:({document})=>service.createMilestone({document,label:'Verified',previewBlob:new Blob(['preview'],{type:'image/png'})}),confirmAction:async()=>true});
 assert.equal(studio.ok,true);studio.createObject({kind:'asset',category:'bench',geometry:{type:'Point',coordinates:[113.0005,23.0005]},properties:{assetRef:'seed:bench:wood'}});
 assert.equal((await studio.dispatch({type:'milestone'})).ok,true);assert.equal(document.objects.length,1);assert.equal(milestones,1);assert.equal(studio.getState().versions.length,1);
 await studio.dispatch({type:'restore-version',value:'milestone'});assert.equal(restored,1);assert.equal((await service.client.loadProject('project')).data.objects.length,1);
 failSave=true;studio.createObject({kind:'asset',category:'bench',geometry:{type:'Point',coordinates:[113.0006,23.0005]},properties:{assetRef:'seed:bench:wood'}});assert.equal((await studio.dispatch({type:'milestone'})).code,'REVISION_CONFLICT');assert.equal(milestones,1);assert.equal(studio.getState().save.status,'conflict');assert.ok(savedStorage.keys().length);studio.dispose();
});
test('real GLB processing hands high, low, original and top bytes to the C2a bundle protocol',async()=>{
 const normalization=require('../models/glb-normalization.js'),positions=new Float32Array([-2,-3,-1,2,7,1,2,-3,-1]),bytes=normalization.writeGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-2,-3,-1],max:[2,7,1]}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],buffers:[{byteLength:positions.byteLength}]},positions);
 const {parseCommitInput}=await import('../../business-api/scene-files/uploads.mjs');let uploaded;
 const service=api.createSceneServices({api:{dataClient:{},async uploadBundle(input){uploaded=input;parseCommitInput(input.record);return {ok:true,data:{id:'asset',metadata:input.record.metadata}};},dispose(){}},contextProvider:()=>context,instanceId:'uploaded-scene',storage:storage()});
 assert.equal((await service.uploadAsset({file:new File([bytes],'Bench.glb',{type:'application/octet-stream'}),displayName:'Bench',kind:'model',topViewBlob:new Blob(['preview'],{type:'image/png'}),metadata:{category:'bench'},license:'student-provided'})).ok,true);
 assert.deepEqual(uploaded.files.map(f=>f.role),['original','display','low','top']);assert.equal(uploaded.context.scopeKind,'group');assert.equal(uploaded.record.metadata.normalized,true);service.dispose();
});
