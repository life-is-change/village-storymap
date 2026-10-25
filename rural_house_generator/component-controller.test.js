const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
const code=source.slice(source.indexOf('function restoreGenerationMode('),source.indexOf('function changeGenerationMode('));

test('polling the same awaiting task does not erase edited design dimensions or floor choices',()=>{
 const s={state:{},GenerationMode:require('./generation-mode.js'),renderGenerationMode(){},els:Object.fromEntries(
  ['generationMethod','modelPurpose','lengthInput','widthInput','componentFloors','componentRoofs'].map(k=>[k,{value:''}]))};
 const restore=vm.runInNewContext(code+';restoreGenerationMode',s);
 const run={id:'first',generation_revision:0,generation_method:'components',model_purpose:'design',building_width:12,building_depth:8};
 restore(run);s.els.lengthInput.value='16';s.els.widthInput.value='9';s.els.componentFloors.value='2';
 restore(run);assert.equal(s.els.lengthInput.value,'16');assert.equal(s.els.widthInput.value,'9');assert.equal(s.els.componentFloors.value,'2');
 restore({...run,id:'second',building_width:14});assert.equal(s.els.lengthInput.value,14);
});
