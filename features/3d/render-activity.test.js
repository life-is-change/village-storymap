const test=require('node:test'),assert=require('node:assert/strict');
const {applyRenderActivity}=require('./reality-inset');
test('hidden viewers stop their render loop, resuming requests a correctly sized frame',()=>{
 const events=[], viewer={useDefaultRenderLoop:true,resize:()=>events.push('resize'),scene:{requestRender:()=>events.push('render')}};
 applyRenderActivity(viewer,false);
 assert.equal(viewer.useDefaultRenderLoop,false);assert.deepEqual(events,[]);
 applyRenderActivity(viewer,true);
 assert.equal(viewer.useDefaultRenderLoop,true);assert.deepEqual(events,['resize','render']);
 applyRenderActivity(null,false);
});
