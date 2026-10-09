// Controlled API-delay experiment; these numbers are not GPU frame rates or live Supabase latency.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'../..');
const beforeRoot=process.argv[2];
if(!beforeRoot)throw Error('Pass untouched baseline checkout path');
const afterQueue=require(path.join(root,'features/data/effective-building-features'));
const beforeSource=fs.readFileSync(path.join(beforeRoot,'app-3d.js'),'utf8');
const afterSource=fs.readFileSync(path.join(root,'app-3d.js'),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function modelRun(source) {
 const start=source.indexOf('  async function applyCurrent3DSpaceToScene()'),end=source.indexOf('\n  async function loadRoads()',start);
 const entityMap=new Map(Array.from({length:100},(_,i)=>[String(i),{}]));
 const s={window:{EffectiveBuildingFeaturesModule:afterQueue},console,viewer:null,
 resetSceneToBaseHeights(){},getActualLinkedSpaceIdFor3D:()=> 'space',normalizeCode:x=>x,entityMap,
 fetchCurrentSpaceAllEdits:async()=>Array.from({length:100},(_,i)=>({object_code:String(i),data:{modelUrl:'model'}})),
 getGroupModelLibrary:()=>({listBindings:async()=>[]}),applyHeightToEntity(){},
 applyModelStateToEntity:async()=>delay(8),applyRuntimeGeneratedModelsForSpace:async()=>{},update3DStatusText(){}};
 const t=performance.now();await vm.runInNewContext(source.slice(start,end)+';applyCurrent3DSpaceToScene',s)();
 return Math.round(performance.now()-t);
}
async function studioRun(dir){
 const Studio=require(path.join(dir,'3D_scenes_edit/index'));
 const Document=require(path.join(dir,'3D_scenes_edit/domain/scene-document'));
 const document=Document.create({projectId:'p',villageId:'v',groupId:'g',spaceId:'s',baselineRevision:0,
 selectionBoundary:{type:'Polygon',coordinates:[[[110,20],[110.001,20],[110.001,20.001],[110,20]]]}});
 const root={innerHTML:'',dataset:{},setAttribute(){},focus(){},addEventListener(){},removeEventListener(){}};
 const t=performance.now();
 const studio=await Studio.create({root,context:{userId:'u',teachingProjectId:'tp',courseId:'c',villageId:'v',groupId:'g',spaceId:'s',baselineRevision:0,baselineFeatures:[],projectId:'p',seedAssets:[]},
 services:{client:{loadProject:async()=>({ok:true,data:document}),listAssets:async()=>{await delay(40);return {ok:true,data:[]};},listVersions:async()=>{await delay(40);return {ok:true,data:[]};},saveDraft:async()=>({ok:true,data:{revision:1}})},
 localStore:{read(){return null;},write(){},remove(){}},adapter:{mount(){},render(){},dispose(){}},
 interactions:{activate(){},dispose(){}},preview:{render:async()=>{},select(){},flyToBoundary(){},dispose(){}}}});
 if(!studio.ok)throw Error('studio failed');studio.dispose();return Math.round(performance.now()-t);
}
(async()=>{
 const result={kind:'controlled',conditions:{models:100,modelTaskDelayMs:8,eachStudioListDelayMs:40,rounds:3},models:[],studio:[]};
 for(let r=1;r<=3;r++){
  result.models.push({round:r,beforeMs:await modelRun(beforeSource),afterMs:await modelRun(afterSource)});
  result.studio.push({round:r,beforeMs:await studioRun(beforeRoot),afterMs:await studioRun(root)});
 }
 fs.writeFileSync(path.join(__dirname,'controlled-results.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
