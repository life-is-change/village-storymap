const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('queued hover work does not hit-test while dragging or animating',()=>{
 const window={},handlers={},frames=[];let hits=0,moving=false;
 const view={getAnimating:()=>moving,getInteracting:()=>moving};
 const map={on:(event,fn)=>handlers[event]=fn,getView:()=>view,forEachFeatureAtPixel:()=>hits++,getTargetElement:()=>({style:{}})};
 vm.runInNewContext(fs.readFileSync(__dirname+'/map-hover-handler.js','utf8'),{window,requestAnimationFrame:fn=>(frames.push(fn),frames.length)});
 window.MapHoverHandlerModule.bindPlanMapHover({getPlanMap:()=>map,isNonInteractiveLayerKey:()=>false,getHoverFeature:()=>null,getBuildingEditState:()=>({}),getPlanVectorLayer:()=>null});
 handlers.pointermove({pixel:[1,1]});handlers.pointermove({pixel:[2,2],dragging:true});frames.shift()();assert.equal(hits,0);
 handlers.pointermove({pixel:[1,1]});moving=true;frames.shift()();assert.equal(hits,0);
 moving=false;handlers.pointermove({pixel:[1,1]});frames.shift()();assert.equal(hits,1);
});
