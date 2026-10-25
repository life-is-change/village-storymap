const test=require('node:test');
const assert=require('node:assert/strict');
const mode=require('./generation-mode.js');

test('existing reconstruction locks source dimensions while design inherits editable dimensions',()=>{
 const source={length:14.8,depth:8.2};
 assert.deepEqual(mode.dimensions('existing',source,{length:20,depth:10}),source);
 assert.deepEqual(mode.dimensions('design',source,{length:20,depth:10}),{length:20,depth:10});
 assert.throws(()=>mode.dimensions('existing',null,{length:20,depth:10}),/白模/);
});
test('task restoration restores generation method and purpose instead of borrowing current controls',()=>{
 assert.deepEqual(mode.fromRun({generation_method:'components',model_purpose:'design'}),{method:'components',purpose:'design'});
 assert.deepEqual(mode.fromRun({}),{method:'texture',purpose:'existing'});
});
test('component input keeps the roof and skips cleaning only for standard design elevations',()=>{
 assert.deepEqual(mode.stages('components','existing'),{cropRoof:false,preprocess:true});
 assert.deepEqual(mode.stages('components','design'),{cropRoof:false,preprocess:false});
 assert.equal(mode.stages('texture','existing').cropRoof,true);
});
test('component placement restores the footprint center after model-library bottom centering',()=>{
 assert.deepEqual(mode.placement({x:.2,z:-.6},30,30),{heading:-60,offsetX:.2,offsetY:.6});
});
