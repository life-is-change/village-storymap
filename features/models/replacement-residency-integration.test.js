const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=()=>fs.readFileSync(path.join(__dirname,'../../app-3d.js'),'utf8');
function extract(name){const s=source(),start=s.indexOf(`  function ${name}(`);assert.ok(start>=0,`${name} must be integrated`);let count=0,end=start+s.slice(start).indexOf('{');for(let i=end;i<s.length;i++){if(s[i]==='{')count++;if(s[i]==='}'&&--count===0)return s.slice(start,i+1);}}
test('high LOD reload uses durable storage path instead of an expired initial signed URL',async()=>{
 const renders=[],signed=[],map=new Map(),entity={__sourceCode:'52'},state={modelUrl:'expired-high',modelStoragePath:'group/house.glb'};
 const ctx={window:{ModelResidencyModule:require('./model-residency'),RenderQualityModule:{getProfile:()=>({modelBudget:1,detailPixels:100})}},viewer:{scene:{requestRender(){}}},replacementResidencyManager:null,replacementModelMap:map,replacementModelDescriptors:new Map([['52',{entity,modelState:state,revision:'same'}]]),getActualLinkedSpaceIdFor3D:()=> 's',
 getGroupModelLibrary:()=>({createSignedUrlForPath:async path=>{signed.push(path);return `fresh-${signed.length}`;}}),addOrUpdateReplacementModel:async(e,s)=>{renders.push(s.modelUrl);map.set('52',{primitive:{show:true}});return true;},removeReplacementModel:()=>map.delete('52'),setEntityReplacementVisual(){}};
 vm.createContext(ctx);vm.runInContext(extract('getReplacementResidencyManager')+';this.make=getReplacementResidencyManager;',ctx);
 const manager=ctx.make();manager.register('52',{url:state.modelUrl,lowUrl:'storage:group/house.low.glb',entity,modelState:state,revision:'same',spaceId:'s'});
 for(const pixels of [200,20,200]){manager.update([{key:'52',pixels,inView:true}]);await new Promise(r=>setImmediate(r));}
 assert.deepEqual(signed,['group/house.glb','group/house.low.glb','group/house.glb']);assert.deepEqual(renders,['fresh-1','fresh-2','fresh-3']);
});
test('main viewer manager loads selected buildings and actually releases them on clear',async()=>{
 const map=new Map(),entities=new Map([['52',{__sourceCode:'52'}]]),calls=[];
 const state={modelUrl:'high.glb'};
 const ctx={window:{ModelResidencyModule:require('./model-residency'),RenderQualityModule:{getProfile:()=>({modelBudget:1,detailPixels:100})}},viewer:{scene:{requestRender(){}}},replacementResidencyManager:null,replacementModelMap:map,replacementModelDescriptors:new Map([['52',{modelState:state}]]),getActualLinkedSpaceIdFor3D:()=> 's',entityMap:entities,getGroupModelLibrary:()=>({createSignedUrlForPath:async p=>p}),
 addOrUpdateReplacementModel:async(entity,state)=>{calls.push(state.modelUrl);map.set(entity.__sourceCode,{primitive:{show:true}});return true;},
 removeReplacementModel:(key,keep)=>{assert.equal(keep,true);map.delete(key);},setEntityReplacementVisual(){}};
 vm.createContext(ctx);vm.runInContext(extract('getReplacementResidencyManager')+';this.make=getReplacementResidencyManager;',ctx);
 const manager=ctx.make();manager.register('52',{url:'high.glb',entity:entities.get('52'),modelState:state,spaceId:'s'});
 manager.update([{key:'52',selected:false,pixels:1,inView:true}]);await new Promise(r=>setImmediate(r));assert.equal(calls.length,0);
 manager.update([{key:'52',selected:true,pixels:1,inView:true}]);await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['high.glb']);assert.equal(manager.getStats().resident,1);
 manager.clear();assert.equal(map.size,0);assert.equal(manager.getStats().resident,0);
});
test('equal placement re-registration during low signing remains current by revision, not object identity',async()=>{
 let signResolve;const renders=[],descriptors=new Map(),map=new Map(),entity={__sourceCode:'52'},first={modelUrl:'h'};
 descriptors.set('52',{entity,modelState:first,revision:'same'});
 const ctx={window:{ModelResidencyModule:require('./model-residency'),RenderQualityModule:{getProfile:()=>({modelBudget:1,detailPixels:100})}},viewer:{scene:{requestRender(){}}},replacementResidencyManager:null,replacementModelMap:map,replacementModelDescriptors:descriptors,getActualLinkedSpaceIdFor3D:()=> 's',
 getGroupModelLibrary:()=>({createSignedUrlForPath:()=>new Promise(r=>{signResolve=r;})}),addOrUpdateReplacementModel:async(e,s)=>{renders.push(s.modelUrl);map.set('52',{primitive:{show:true}});return true;},removeReplacementModel(){},setEntityReplacementVisual(){}};
 vm.createContext(ctx);vm.runInContext(extract('getReplacementResidencyManager')+';this.make=getReplacementResidencyManager;',ctx);
 const manager=ctx.make();manager.register('52',{url:'h',lowUrl:'storage:low',entity,modelState:first,revision:'same',spaceId:'s'});manager.update([{key:'52',pixels:1,inView:true}]);
 const second={modelUrl:'h'};descriptors.set('52',{entity,modelState:second,revision:'same'});manager.register('52',{url:'h',lowUrl:'storage:low',entity,modelState:second,revision:'same',spaceId:'s'});
 signResolve('signed-low');await new Promise(r=>setImmediate(r));assert.deepEqual(renders,['signed-low']);assert.equal(manager.getStats().resident,1);
});
test('chosen library state clears previous LOD metadata and preserves new normalized metadata',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(extract('getLibraryAssetModelState')+';this.build=getLibraryAssetModelState;',ctx);
 const legacy=ctx.build({id:'old',name:'old',storage_path:'old.glb'},null,{modelScale:1,modelLowStoragePath:'other.low',modelNormalized:true},'signed');
 assert.equal(legacy.modelNormalized,false);assert.equal(legacy.modelLowStoragePath,'');assert.equal(legacy.modelExpectedHeight,'');
 const next=ctx.build({id:'new',name:'new',storage_path:'new.glb'},{normalized:true,size:[20,10,8],lowStoragePath:'new.low'}, {}, 'signed');
 assert.equal(next.modelScale,10);assert.equal(next.modelLowStoragePath,'new.low');assert.equal(next.modelExpectedHeight,10);assert.equal(next.modelExpectedWidth,8);
});
test('viewport residency uses the actually offset model anchor and height',()=>{
 let captured;const ctx={getModelEntityPosition:(_entity,state)=>{captured=state;return {x:0,y:0,z:state.modelHeightOffset};},getEntityAutoHeading:()=>0,Cesium:{Math:{toRadians:n=>n},HeadingPitchRoll:class{},Transforms:{headingPitchRollToFixedFrame:()=>({x:0,y:0,z:5})},Matrix4:{getTranslation:m=>m},Cartesian3:class{}},applyLocalOffsetToMatrix:(m,x,y)=>({...m,x,y})};
 vm.createContext(ctx);vm.runInContext(extract('getReplacementViewPosition')+';this.position=getReplacementViewPosition;',ctx);
 const state={modelHeightOffset:5,modelOffsetX:100,modelOffsetY:50};const p=ctx.position({},state);
 assert.equal(captured,state);assert.equal(p.x,100);assert.equal(p.y,50);assert.equal(p.z,5);
});
