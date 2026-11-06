const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Types=require('./problem-types');
function setup(){
 const source=fs.readFileSync('app.js','utf8'),start=source.indexOf('function showCommunityTaskReportDialog('),end=source.indexOf('function ensureCommunityBuildPanel(',start);
 const make=()=>({value:'',style:{},hidden:false,classList:{add(){},remove(){}},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},focus(){this.focused=true;},setAttribute(n,v){this[n]=v;},removeAttribute(n){delete this[n];}});
 const fields=Object.fromEntries(['reportOtherTypeField','reportOtherTypeInput','reportOtherTypeError','reportPhotoInput','reportPhotoBtn','reportPhotoName','reportDescInput','reportCancelBtn','reportDescError','reportSubmitBtn'].map(id=>['#'+id,make()]));fields['#reportOtherTypeField'].hidden=true;
 const options=Object.keys(Types.types).map(type=>({...make(),dataset:{type},querySelector:()=>({})}));
 const overlay={...make(),querySelector:key=>fields[key],querySelectorAll:()=>options};
 const body={appendChild(x){x.parentNode=this;},removeChild(x){x.parentNode=null;}};
 const show=vm.runInNewContext(source.slice(start,end)+';showCommunityTaskReportDialog',{document:{createElement:()=>overlay,body},window:{CommunityProblemTypes:Types},COMMUNITY_TASK_TYPE_META:Types.types,escapeHtml:s=>s,showToast(){}});
 const sent=[];show({requireLocation:true,onSubmit:async payload=>sent.push(payload)});
 return {fields,options,overlay,sent};
}
test('Other requires its own type name before advancing to the map, then submits it independently',async()=>{
 const h=setup();h.fields['#reportDescInput'].value='具体问题说明';h.options.find(x=>x.dataset.type==='other').listeners.click();assert.equal(h.fields['#reportOtherTypeField'].hidden,false);
 await h.fields['#reportSubmitBtn'].listeners.click();assert.equal(h.sent.length,0);assert.equal(h.fields['#reportOtherTypeInput']['aria-invalid'],'true');
 h.fields['#reportOtherTypeInput'].value='噪声扰民';await h.fields['#reportSubmitBtn'].listeners.click();assert.equal(h.sent[0].category,'other:噪声扰民');assert.equal(h.sent[0].description,'具体问题说明');assert.equal(h.overlay.parentNode,null);
});
test('switching from Other to a preset ignores its draft and hides the custom input',async()=>{
 const h=setup();h.options.find(x=>x.dataset.type==='other').listeners.click();h.fields['#reportOtherTypeInput'].value='噪声';h.options.find(x=>x.dataset.type==='housing_disrepair').listeners.click();assert.equal(h.fields['#reportOtherTypeField'].hidden,true);
 h.fields['#reportDescInput'].value='屋顶破损';await h.fields['#reportSubmitBtn'].listeners.click();assert.equal(h.sent[0].category,'housing_disrepair');
});
