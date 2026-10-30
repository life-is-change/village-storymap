const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Startup=require('./scene-studio-startup');
const source=fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8');
const body=source.slice(source.indexOf('async function openSceneStudioWorkspace()'),source.indexOf('\nfunction buildViewSwitcherDeps()'));
test('cold scene project reads begin after baseline but before Cesium loading completes',async()=>{
 let release;const gate=new Promise(r=>release=r),events=[];
 const api={enter:async()=>{events.push('3d:enter');await gate;}};
 const s={sceneStudioMapHome:null,sceneStudioCesiumHome:null,map2dEl:null,cesiumContainerEl:null,sceneStudioMount:null,
 ensureSceneStudioFocusMode:()=>({enter(){},exit(){}}),switchMainView(){},getSceneStudioActiveView:()=> 'plan2d',getCurrentSpace:()=>({viewMode:'2d'}),renderSpaceList(){},window:{SceneStudioStartupModule:Startup},
 ensurePlanMap:async()=>{},ensureSelectedLayersLoaded:async()=>{},refresh2DOverlay:async()=>{events.push('baseline');},
 ensureVillage3DLoaded:async()=>api,showToast(){},restoreSceneStudioViewportTargets(){},
 ensureSceneStudioPlatformBridge:()=>({open:async(state,opts)=>{events.push('project');await opts.prepared3D;return {ok:true};}})
 };
 const helper=source.slice(source.indexOf('function syncSceneStudioPlatformView('),source.indexOf('\nfunction closeSceneStudioWorkspace()'));
 const open=vm.runInNewContext(helper+'\n'+body+';openSceneStudioWorkspace',s),pending=open();
 await new Promise(r=>setImmediate(r));const before=[...events];release();await pending;
 assert.ok(before.includes('baseline'));assert.ok(before.includes('project'),'project must not wait for all 3D work');
 assert.ok(before.indexOf('project')>before.indexOf('baseline'));
});

for(const initialView of ['plan2d','model3d'])for(const failure of ['rejected-project','thrown-startup','missing-module'])test(`studio ${failure} restores ${initialView} and its view controls`,async()=>{
 let activeView=initialView,focused=false;const space={viewMode:initialView==='model3d'?'3d':'2d'},mount={hidden:true,innerHTML:''};
 const s={sceneStudioMapHome:null,sceneStudioCesiumHome:null,map2dEl:null,cesiumContainerEl:null,sceneStudioMount:mount,
 ensureSceneStudioFocusMode:()=>({enter(){focused=true;},exit(){focused=false;}}),
 getSceneStudioActiveView:()=>activeView,getCurrentSpace:()=>space,renderSpaceList(){},
 switchMainView(view){activeView=view;return true;},window:{SceneStudioStartupModule:Startup},
 ensurePlanMap:async()=>{},ensureSelectedLayersLoaded:async()=>{},refresh2DOverlay:async()=>{},ensureVillage3DLoaded:async()=>({enter:async()=>{}}),showToast(){},restoreSceneStudioViewportTargets(){},
 ensureSceneStudioPlatformBridge:()=>failure==='missing-module'?null:{open:async()=>{if(failure==='thrown-startup')throw Error('project unavailable');return {ok:false,code:'INVALID_INPUT'};}}
 };
 const helperStart=source.indexOf('function syncSceneStudioPlatformView('),helper=helperStart<0?'':source.slice(helperStart,source.indexOf('\nfunction closeSceneStudioWorkspace()',helperStart));
 const open=vm.runInNewContext(helper+'\n'+body+';openSceneStudioWorkspace',s);
 if(failure==='thrown-startup')await assert.rejects(open(),/project unavailable/);else await open();
 assert.equal(activeView,initialView);assert.equal(space.viewMode,initialView==='model3d'?'3d':'2d');assert.equal(mount.hidden,true);assert.equal(focused,false);
});
