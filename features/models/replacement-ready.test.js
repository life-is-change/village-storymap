const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function event(){const handlers=new Set();return {addEventListener(fn){handlers.add(fn);return ()=>handlers.delete(fn);},fire(value){for(const fn of [...handlers])fn(value);},size(){return handlers.size;}};}
function ready(){const s=fs.readFileSync('app-3d.js','utf8'),start=s.indexOf('  function waitForReplacementModelReady('),end=s.indexOf('  async function addOrUpdateReplacementModel(',start);assert.ok(start>=0,'main renderer needs a GPU-ready gate');return vm.runInNewContext(s.slice(start,end)+';waitForReplacementModelReady',{Promise,Error,setTimeout,clearTimeout});}
test('parsed GLB stays pending until Cesium GPU ready event, then removes listeners',async()=>{const wait=ready(),p={ready:false,readyEvent:event(),errorEvent:event()};let settled=false,renders=0;const promise=wait(p,()=>renders++).then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);assert.equal(renders,1);p.readyEvent.fire();await promise;assert.equal(settled,true);assert.equal(p.readyEvent.size(),0);assert.equal(p.errorEvent.size(),0);});
test('GPU error and bounded timeout reject readiness and clean event handlers',async()=>{const wait=ready(),p={ready:false,readyEvent:event(),errorEvent:event()};const promise=wait(p,()=>{});p.errorEvent.fire(Error('GPU failed'));await assert.rejects(promise,/GPU failed/);assert.equal(p.readyEvent.size(),0);await assert.rejects(wait(p,()=>{},5),/MODEL_READY_TIMEOUT/);assert.equal(p.errorEvent.size(),0);});

function renderer(previous){
 const s=fs.readFileSync('app-3d.js','utf8'),start=s.indexOf('  function waitForReplacementModelReady('),end=s.indexOf('  function getReplacementModelIdentity(',start);
 const primitive={ready:false,readyEvent:event(),errorEvent:event(),isDestroyed:()=>false},removed=[],map=new Map(previous?[['52',previous]]:[]);let refreshes=0;
 const viewer={scene:{requestRender(){},primitives:{add(){},remove(p){removed.push(p);}}},entities:{add:()=>({}),remove(){}}};
 const ctx={Promise,Error,Symbol,Date,Number,Math,setTimeout,clearTimeout,console:{log(){},error(){}},viewer,replacementModelMap:map,replacementRequestTokenMap:new Map(),normalizeCode:x=>x,
 getModelEntityPosition:()=>({}),toFiniteNumber:(v,f)=>Number.isFinite(Number(v))?Number(v):f,normalizeStretch:()=>1,toBooleanFlag:(_v,f)=>f,getDesiredModelBaseHeight:()=>0,getEntityAutoHeading:()=>0,
 applyLocalOffsetToMatrix:m=>m,applyLocalScaleToMatrix:m=>m,resolveExpectedModelHeightMeters:()=>9,MODEL_SCALE_BASE:.1,showReplacementAnchor:false,activeEntity:null,
 Cesium:{Model:{fromGltfAsync:async()=>primitive},Math:{toRadians:x=>x},HeadingPitchRoll:class{},Transforms:{headingPitchRollToFixedFrame:()=>({})},Color:{RED:0,WHITE:0,YELLOW:0},Matrix4:{getTranslation:()=>({})},Cartesian3:class{}},
 getAutoFitScaleXY:()=>({x:1,y:1}),setEntityReplacementVisual(){},refreshAllEntityVisualStates(){refreshes++;},refreshReplacementAnchorVisibility(){},removeReplacementModel(){throw Error('must not remove displayed model before ready');}};
 const load=vm.runInNewContext(s.slice(start,end)+';addOrUpdateReplacementModel',ctx);
 return {load,primitive,removed,map,refreshes:()=>refreshes};
}
test('actual renderer retains old primitive for thirty frames and commits only after GPU ready',async()=>{
 const old={primitive:{isDestroyed:()=>false},pointEntity:{}},h=renderer(old);const task=h.load({__sourceCode:'52'},{modelUrl:'low',modelNormalized:true});
 for(let i=0;i<30;i++){await Promise.resolve();assert.equal(h.map.get('52'),old);assert.equal(h.removed.length,0);assert.equal(h.refreshes(),0);}
 h.primitive.ready=true;h.primitive.readyEvent.fire();assert.equal(await task,true);assert.equal(h.map.get('52').primitive,h.primitive);assert.deepEqual(h.removed,[old.primitive]);
});
test('initial replacement does not hide the white model while GPU resources are pending',async()=>{
 const h=renderer();const task=h.load({__sourceCode:'52'},{modelUrl:'high',modelNormalized:true});
 await new Promise(setImmediate);assert.equal(h.map.size,0);assert.equal(h.refreshes(),0);
 h.primitive.ready=true;h.primitive.readyEvent.fire();assert.equal(await task,true);
 assert.equal(h.map.get('52').primitive,h.primitive);assert.equal(h.refreshes(),1);
});
test('actual renderer preserves old model on GPU failure and discards a superseded ready model',async()=>{
 const old={primitive:{isDestroyed:()=>false}},h=renderer(old);const task=h.load({__sourceCode:'52'},{modelUrl:'low',modelNormalized:true});await new Promise(setImmediate);
 h.primitive.errorEvent.fire(Error('GPU failed'));assert.equal(await task,false);assert.equal(h.map.get('52'),old);assert.ok(!h.removed.includes(old.primitive));
 const stale=renderer(old);let current=true;const next=stale.load({__sourceCode:'52'},{modelUrl:'low',modelNormalized:true},{isCurrent:()=>current});await new Promise(setImmediate);current=false;stale.primitive.readyEvent.fire();assert.equal(await next,false);assert.equal(stale.map.get('52'),old);
});
