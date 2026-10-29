const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('two clicks complete measurement and right-click removes interaction and listeners',async()=>{
 const source=fs.readFileSync(__dirname+'/../../app.js','utf8');
 const handlers={},listeners=new Map(),readouts=[];
 class Draw{constructor(options){this.options=options;}on(k,fn){handlers[k]=fn;}}
 const viewport={addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
 const state={active:false,source:{clear(){}},draw:null};let removed=0;
 const ctx={measure2DState:state,document:{getElementById:()=>null,addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)},planMap:{addInteraction(){},removeInteraction(){removed++;},getViewport:()=>viewport},ensure2DMeasureLayer:async()=>true,olReady:Promise.resolve({Draw}),clearBuildingInteractions(){},set2DMeasureReadout:(text)=>readouts.push(text),calcLineLengthMeters:()=>12,formatDistanceText:x=>`${x} m`};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function toggle2DMeasure('),source.indexOf('\nfunction bindMeasureButtons()')),ctx);
 await ctx.toggle2DMeasure(true);
 assert.equal(state.draw.options.maxPoints,2);
 handlers.drawend({feature:{getGeometry:()=>({getCoordinates:()=>[[0,0],[1,1]]})}});
 assert.equal(readouts.at(-1),'总长：12 m');
 let prevented=false;listeners.get('contextmenu')({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(state.active,false);assert.equal(removed,1);assert.equal(listeners.size,0);
});
