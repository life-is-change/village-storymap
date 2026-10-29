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
test('water and road redraws reuse styles but edits, contour labels and road zoom invalidate them',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(__dirname+'/map-style.js','utf8'),{window});
 const api=window.MapStyleModule,ol={};let revision=1,labels=false;
 api.buildOlFeatureStyle=()=>({});
 const deps={getOL:()=>ol,isActiveFeature:()=>false,isHoveredFeature:()=>false,getSelectedLayersForCurrentSpace:()=>[],getContourLabelsVisible:()=>labels};
 for(const layerKey of ['water','road','contours']){
  const feature={get:k=>k==='layerKey'?layerKey:null,getRevision:()=>revision};
  const a=api.getOlFeatureStyle(deps,feature,0.00002);
  for(let i=0;i<100;i++)assert.equal(api.getOlFeatureStyle(deps,feature,0.00002),a);
  revision++;assert.notEqual(api.getOlFeatureStyle(deps,feature,0.00002),a);
  if(layerKey==='road')assert.notEqual(api.getOlFeatureStyle(deps,feature,0.00003),api.getOlFeatureStyle(deps,feature,0.00002));
  if(layerKey==='contours'){const b=api.getOlFeatureStyle(deps,feature,0.00002);labels=true;assert.notEqual(api.getOlFeatureStyle(deps,feature,0.00002),b);}
 }
});
