const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
const code=source.slice(source.indexOf('function restoreGenerationMode('),source.indexOf('function changeGenerationMode('));

test('completed model exposes a proportional-height warning without reporting generation failure',()=>{
 const start=source.indexOf('function buildGenerateCompleteMessage('),end=source.indexOf('function createPreviewRenderLoop(',start);
 const message=vm.runInNewContext(source.slice(start,end)+';buildGenerateCompleteMessage',{state:{targetCode:'52'},window:{opener:{}}});
 const result=message('本地构件模型','平均层高 5.72 m，已保留照片比例');
 assert.match(result,/生成完成/);assert.match(result,/5\.72 m/);assert.match(result,/已保留照片比例/);
});

test('polling the same awaiting task does not erase edited design dimensions or floor choices',()=>{
 const s={state:{},GenerationMode:require('./generation-mode.js'),renderGenerationMode(){},els:Object.fromEntries(
  ['generationMethod','modelPurpose','lengthInput','widthInput','componentFloors','componentRoofs'].map(k=>[k,{value:''}]))};
 const restore=vm.runInNewContext(code+';restoreGenerationMode',s);
 const run={id:'first',generation_revision:0,generation_method:'components',model_purpose:'design',building_width:12,building_depth:8};
 restore(run);s.els.lengthInput.value='16';s.els.widthInput.value='9';s.els.componentFloors.value='2';
 restore(run);assert.equal(s.els.lengthInput.value,'16');assert.equal(s.els.widthInput.value,'9');assert.equal(s.els.componentFloors.value,'2');
 restore({...run,id:'second',building_width:14});assert.equal(s.els.lengthInput.value,14);
});

test('component parameter guidance distinguishes inherited dimensions and default floors from photo inference',()=>{
 const elements=new Map();
 const element=()=>({value:'',hidden:false,querySelectorAll:()=>[]});
 const s={state:{generationMethod:'components',modelPurpose:'design',footprintRectangularity:1},
  GenerationMode:require('./generation-mode.js'),renderRoofAnalysis(){},document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}},
  els:Object.fromEntries(['componentParameters','generateBtn','lengthInput','widthInput','generationModeHint','photoPipelineHint','cropHint','photoInput','roofAdvanced','roofCropShade','roofCropHandle','photoGenerateBtn','configHint','photoSteps'].map(k=>[k,element()]))};
 s.els.sourceButtons=[];s.els.sourcePanels=[];
 const start=source.indexOf('function renderGenerationMode('),end=source.indexOf('function requestExistingPhotoMaterials(',start);
 const render=vm.runInNewContext(source.slice(start,end)+';renderGenerationMode',s);
 render();
 assert.match(s.els.configHint.textContent,/地图白模/);
 assert.match(s.els.configHint.textContent,/层数.*默认.*3/);
 assert.match(s.els.configHint.textContent,/未.*自动识别/);
 assert.match(s.els.configHint.textContent,/墙.*高度.*比例/);
 assert.equal(s.els.lengthInput.readOnly,false);
});
