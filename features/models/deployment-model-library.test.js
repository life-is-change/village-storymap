const test=require('node:test'),assert=require('node:assert/strict');const {createGroupModelLibrary}=require('./group-model-library.js');
test('local model library routes normalization, variants, placement and restoration through injected services',async()=>{
 const calls=[];const library=createGroupModelLibrary({services:{models:{async execute(a,p){calls.push([a,p]);return []; }},files:{async resolvePathUrl(bucket,path){calls.push([bucket,path]);return 'blob:local';},async uploadModel(input){calls.push(['upload',input]);return {id:'model',storage_path:'private.glb'};}}},getContext:()=>({teachingProjectId:'p',villageId:'v',spaceId:'s'}),uuid:()=> 'request',client:{from(){throw Error('SOURCE_TOUCHED');},storage:{from(){throw Error('SOURCE_STORAGE_TOUCHED');}}}});
 await library.listAssets({kind:'group',groupId:'g'});await library.placeAsset({assetId:'a',spaceId:'s',objectCode:'B1',transform:{rotation:1}});await library.restoreWhiteModel({spaceId:'s',objectCode:'B1'});await library.createSignedUrlForPath('private.glb');
 assert.equal(calls[0][0],'models.list');assert.equal(calls[1][0],'models.place');assert.equal(calls[1][1].transform.rotation,1);assert.equal(calls[2][0],'models.restoreWhiteModel');assert.equal(calls[3][0],'group-models');
});
test('local uploads retain the original bytes and produce aligned normalized display and low variants',async()=>{
 const normalization=require('./glb-normalization.js'),positions=new Float32Array([-2,-3,-1,2,7,1,2,-3,-1]);
 const bytes=normalization.writeGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-2,-3,-1],max:[2,7,1]}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],buffers:[{byteLength:positions.byteLength}]},positions);
 let uploaded;const library=createGroupModelLibrary({services:{models:{},files:{async uploadModel(input){uploaded=input;return {id:'a',normalization:input.metadata};}}},getContext:()=>({teachingProjectId:'p',villageId:'v',spaceId:'s'})});
 const original=new File([bytes],'house.glb',{type:'model/gltf-binary'}),asset=await library.uploadAsset({file:original,name:'House',metersPerUnit:0.01});
 assert.equal(uploaded.files.original,original);assert.equal(asset.normalization.normalized,true);assert.equal(asset.normalization.anchor,'bottom-center');
 const display=await normalization.inspectGlbAsync(await uploaded.files.display.arrayBuffer()),low=await normalization.inspectGlbAsync(await uploaded.files.low.arrayBuffer());assert.deepEqual(low.bounds.size,display.bounds.size);assert.ok(display.bounds.size[1]<0.101);
 assert.equal(JSON.stringify(uploaded.metadata).includes('StoragePath'),false);
});
