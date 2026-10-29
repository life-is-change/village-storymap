const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('building zoom reuses styles within a survey badge visibility tier',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(__dirname+'/map-style.js','utf8'),{window});
 const api=window.MapStyleModule,ol={};let builds=0;
 api.buildOlFeatureStyle=()=>({build:++builds});
 const feature={get:k=>k==='layerKey'?'building':null,getRevision:()=>1};
 const deps={getOL:()=>ol,isActiveFeature:()=>false,isHoveredFeature:()=>false,getSelectedLayersForCurrentSpace:()=>[]};
 const a=api.getOlFeatureStyle(deps,feature,0.00002);
 assert.equal(api.getOlFeatureStyle(deps,feature,0.00003),a);
 assert.notEqual(api.getOlFeatureStyle(deps,feature,0.0002),a);
});
