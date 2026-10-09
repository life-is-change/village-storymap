const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Startup=require('./scene-studio-startup');
const source=fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8');
const body=source.slice(source.indexOf('async function openSceneStudioWorkspace()'),source.indexOf('\nfunction buildViewSwitcherDeps()'));
test('cold scene project reads begin after baseline but before Cesium loading completes',async()=>{
 let release;const gate=new Promise(r=>release=r),events=[];
 const api={enter:async()=>{events.push('3d:enter');await gate;}};
 const s={sceneStudioMapHome:null,sceneStudioCesiumHome:null,map2dEl:null,cesiumContainerEl:null,sceneStudioMount:null,
 ensureSceneStudioFocusMode:()=>({enter(){},exit(){}}),switchMainView(){},window:{SceneStudioStartupModule:Startup},
 ensurePlanMap:async()=>{},ensureSelectedLayersLoaded:async()=>{},refresh2DOverlay:async()=>{events.push('baseline');},
 ensureVillage3DLoaded:async()=>api,showToast(){},restoreSceneStudioViewportTargets(){},
 ensureSceneStudioPlatformBridge:()=>({open:async(state,opts)=>{events.push('project');await opts.prepared3D;return {ok:true};}})
 };
 const open=vm.runInNewContext(body+';openSceneStudioWorkspace',s),pending=open();
 await new Promise(r=>setImmediate(r));const before=[...events];release();await pending;
 assert.ok(before.includes('baseline'));assert.ok(before.includes('project'),'project must not wait for all 3D work');
 assert.ok(before.indexOf('project')>before.indexOf('baseline'));
});
