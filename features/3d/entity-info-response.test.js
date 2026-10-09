const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../app-3d.js'),'utf8');
const showSource=source.slice(source.indexOf('  async function showEntityInfo('),source.indexOf('  function openHouseGeneratorForEntity('));
function fixture(){
 let release;const gate=new Promise(r=>release=r), reads=[];
 const entity={__sourceCode:'H001'}, panel={innerHTML:'',classList:{remove(){}}};
 const s={entityInfoRevision:0,activeEntity:entity,currentSelectedEntityCode:null,currentLibraryAssets:[],currentLibraryBinding:null,
 getInfoPanel:()=>panel,getActualLinkedSpaceIdFor3D:()=>s.space,get3DEditPolicy:()=>({canEditModel:true}),space:'A',
 buildBase3DRow:e=>({code:e.__sourceCode}),mergeRow:(a,b)=>({...a,...b}),getRuntimeGeneratedModelState:()=>null,
 window:{__fetchObjectEdits:async()=>{reads.push('shared');await gate;return {shared:true};}},
 fetchSingle3DEdit:async()=>{reads.push('3d');await gate;return {height:9};},
 refreshCurrentModelLibrary:async()=>{reads.push('library');await gate;return {assets:[],binding:null};},
 is3DViewActive:()=>s.visible!==false,update3DStatusText(){},escapeHtml:x=>x,DEFAULT_HEIGHT:9,
 buildModelReplaceCardHtmlV3:r=>'READY '+r.code,bindEntityInfoEventsV3(){},console,
 applyModelStateToEntity:async()=>{}
 };
 const show=vm.runInNewContext(showSource+';showEntityInfo',s);
 return {s,entity,panel,reads,release,show};
}
test('building click exposes loading panel and starts all reads before remote data returns',async()=>{
 const f=fixture(),pending=f.show(f.entity);
 await new Promise(r=>setImmediate(r));
 const panelBefore=f.panel.innerHTML, readsBefore=[...f.reads];
 f.release();await pending;
 assert.match(panelBefore,/H001/);assert.match(panelBefore,/正在|加载/);
 assert.deepEqual(readsBefore.sort(),['3d','library','shared']);assert.match(f.panel.innerHTML,/READY H001/);
});
test('old building details cannot replace a newer selection or overwrite library state',async()=>{
 const f=fixture(),pending=f.show(f.entity);
 await new Promise(r=>setImmediate(r));
 f.s.activeEntity={__sourceCode:'H002'}; f.panel.innerHTML='new selection';
 f.release();await pending;
 assert.equal(f.panel.innerHTML,'new selection');assert.equal(f.s.currentLibraryBinding,null);
});
test('leaving 3D while details are pending cannot replace the 2D info panel',async()=>{
 const f=fixture(),pending=f.show(f.entity);
 await new Promise(r=>setImmediate(r));
 f.s.visible=false;f.panel.innerHTML='2D details';f.release();await pending;
 assert.equal(f.panel.innerHTML,'2D details');
});
test('fresh generated model remains the active details model instead of restoring an old library binding',async()=>{
 const f=fixture();let applied=0;
 f.s.getRuntimeGeneratedModelState=()=>({modelUrl:'blob:generated'});
 f.s.refreshCurrentModelLibrary=async()=>({assets:[],binding:{group_model_assets:{name:'old'},transform:{}},library:{createSignedUrl:async()=>'old.glb'}});
 f.s.applyModelStateToEntity=async()=>applied++;
 f.s.buildModelReplaceCardHtmlV3=row=>row.modelUrl;
 const pending=f.show(f.entity);f.release();await pending;
 assert.equal(applied,0);assert.match(f.panel.innerHTML,/blob:generated/);
});

test('generated model arriving during old library signing invalidates the obsolete model apply',async()=>{
 const f=fixture();let signRelease;const signed=new Promise(r=>signRelease=r),applied=[];
 let runtime=null;f.s.getRuntimeGeneratedModelState=()=>runtime;
 f.s.refreshCurrentModelLibrary=async()=>({assets:[],binding:{group_model_assets:{name:'old'},transform:{}},library:{createSignedUrl:async()=>{await signed;return 'old.glb';}}});
 f.s.applyModelStateToEntity=async(e,row)=>applied.push(row.modelUrl);
 f.s.buildModelReplaceCardHtmlV3=row=>row.modelUrl;
 const pending=f.show(f.entity);f.release();
 await new Promise(r=>setImmediate(r));runtime={modelUrl:'blob:new'};signRelease();await pending;
 assert.deepEqual(applied,[]);assert.match(f.panel.innerHTML,/blob:new/);
});

test('click scheduling adds no fixed camera settling delay',()=>{
 const part=source.slice(source.indexOf('  function scheduleEntityInfoAfterRealityFocus('),source.indexOf('  function normalizeCode(',source.indexOf('  function scheduleEntityInfoAfterRealityFocus(')));
 let delay;const s={deferredEntityInfoTimer:0,normalizeCode:x=>x,window:{clearTimeout(){},setTimeout(fn,ms){delay=ms;return 1;}},REALITY_FOCUS_SETTLE_MS:850};
 vm.runInNewContext(part+';scheduleEntityInfoAfterRealityFocus({__sourceCode:"H001"})',s);
 assert.equal(delay,0);
});
