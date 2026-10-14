const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Normalizer=require('./glb-normalization');
function mesh(){
 const n=32,positions=[],uv=[],indices=[];
 for(let z=0;z<=n;z++)for(let x=0;x<=n;x++){positions.push(10+x/n*2,3,2+z/n);uv.push(x/n,z/n);}
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=z*(n+1)+x,b=a+n+1;indices.push(a,b,a+1,a+1,b,b+1);}
 const arrays=[new Float32Array(positions),new Float32Array(uv),new Uint16Array(indices)],binary=new Uint8Array(arrays.reduce((s,a)=>s+a.byteLength,0));let offset=0;
 const views=arrays.map(a=>{const v={buffer:0,byteOffset:offset,byteLength:a.byteLength};binary.set(new Uint8Array(a.buffer),offset);offset+=a.byteLength;return v;});
 return Normalizer.writeGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2}]}],buffers:[{byteLength:binary.length}],bufferViews:views,accessors:[{bufferView:0,type:'VEC3',componentType:5126,count:positions.length/3,min:[10,3,2],max:[12,3,3]},{bufferView:1,type:'VEC2',componentType:5126,count:uv.length/2},{bufferView:2,type:'SCALAR',componentType:5123,count:indices.length}]},binary);
}
test('single GLB automatically produces readable detailed and simplified variants with one anchor',async()=>{
 assert.equal(typeof Normalizer.createModelVariantsAsync,'function','automatic preparation API must be connected');
 const source=mesh(),copy=new Uint8Array(source).slice();const result=await Normalizer.createModelVariantsAsync(source,{metersPerUnit:.01});
 assert.deepEqual(new Uint8Array(source),copy);
 assert.ok(result.lowBuffer.byteLength<result.buffer.byteLength);
 assert.equal(result.inspection.triangleCount,2048);
 assert.ok(result.lowInspection.triangleCount<2048);
 const high=Normalizer.readGlb(result.buffer).json,low=Normalizer.readGlb(result.lowBuffer).json;
 assert.deepEqual(high.nodes[high.scenes[0].nodes[0]],low.nodes[low.scenes[0].nodes[0]]);
 assert.deepEqual(high.extras.villageModel.originalCenter,low.extras.villageModel.originalCenter);
 assert.equal(low.extras.villageModel.metersPerUnit,.01);
 assert.equal(result.processing.engine,'browser-cpu');
});
test('automatic preparation keeps an already normalized model anchored and rejects invalid input',async()=>{
 assert.equal(typeof Normalizer.createModelVariantsAsync,'function');
 const source=Normalizer.normalizeGlb(mesh()).buffer,result=await Normalizer.createModelVariantsAsync(source);
 assert.deepEqual(result.inspection.bounds,Normalizer.inspectGlb(source).bounds);
 await assert.rejects(Normalizer.createModelVariantsAsync(new Uint8Array([1,2,3]).buffer),/GLB/i);
});
test('automatic variants run in a worker using source copy and return both transfers',async()=>{
 const vm=require('node:vm'),source=mesh(),copy=new Uint8Array(source).slice();let url,terminated=false;
 class Worker{constructor(u){url=String(u);}postMessage(message,transfers){const data=structuredClone(message,{transfer:transfers});setImmediate(async()=>{const result=await Normalizer.createModelVariantsAsync(data.buffer,data.options);this.onmessage({data:{result}});});}terminate(){terminated=true;}}
 const ctx={Worker,URL,ArrayBuffer,Uint8Array,DataView,TextEncoder,TextDecoder,setTimeout,clearTimeout,document:{currentScript:{src:'https://example.test/features/models/glb-normalization.js?v=2'}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'glb-normalization.js'),'utf8'),ctx);
 assert.equal(typeof ctx.GlbNormalizationModule.createModelVariantsAsync,'function');
 const result=await ctx.GlbNormalizationModule.createModelVariantsAsync(source);
 assert.match(url,/automatic-model-worker\.js/);assert.equal(terminated,true);assert.ok(result.lowBuffer);assert.deepEqual(new Uint8Array(source),copy);
});
