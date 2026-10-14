const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const modulePath = require('node:path').join(__dirname, 'glb-normalization.js');
function api() { assert.ok(fs.existsSync(modulePath), 'shared GLB normalization must exist'); return require(modulePath); }
function fixture(options={}) {
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,translation:options.translation||[100,20,-50],scale:options.scale||[1,1,1]}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2}]}],accessors:[{type:'VEC3',componentType:5126,count:8,min:[-2,-3,-1],max:[2,7,1]},{type:'VEC3',componentType:5126,count:8,min:[-999,-999,-999],max:[999,999,999]},{type:'SCALAR',componentType:5123,count:36,min:[0],max:[7]}]};
  if(options.parent){json.nodes.push({children:[0],translation:[5,0,10],scale:[2,2,2]});json.scenes[0].nodes=[1];}
  const values=[];for(let mask=0;mask<8;mask++)values.push(mask&1?2:-2,mask&2?7:-3,mask&4?1:-1);
  const positions=new Float32Array(values),indices=new Uint16Array(Array.from({length:36},(_,i)=>i%8));
  const bin=new Uint8Array(positions.byteLength+indices.byteLength);bin.set(new Uint8Array(positions.buffer));bin.set(new Uint8Array(indices.buffer),positions.byteLength);
  json.buffers=[{byteLength:bin.length}];json.bufferViews=[{buffer:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}];
  json.accessors[0].bufferView=0;json.accessors[2].bufferView=1;
  return api().writeGlb(json,bin);
}
test('normalizes transformed POSITION bounds to glTF bottom center, ignoring normal accessors',()=>{
 const result=api().normalizeGlb(fixture());
 assert.deepEqual(result.inspection.bounds.min,[-2,0,-1]); assert.deepEqual(result.inspection.bounds.max,[2,10,1]);
 assert.deepEqual(result.inspection.bounds.size,[4,10,2]); assert.equal(result.inspection.triangleCount,12);
 const parsed=api().readGlb(result.buffer); assert.deepEqual(parsed.json.nodes[1].translation,[-100,-17,50]);
 assert.deepEqual(parsed.json.nodes[0].translation,[100,20,-50]);
});
test('includes ancestor transforms and honors an explicit centimeters to meters conversion',()=>{
 const result=api().normalizeGlb(fixture({parent:true}),{metersPerUnit:.01});
 for(let i=0;i<3;i++)assert.ok(Math.abs(result.inspection.bounds.size[i]-[.08,.2,.04][i])<1e-9);
 assert.equal(result.inspection.bounds.min[1],0);
});
test('normalization is idempotent and does not shift an already normalized LOD',()=>{
 const first=api().normalizeGlb(fixture());const again=api().normalizeGlb(first.buffer);
 assert.deepEqual(new Uint8Array(again.buffer),new Uint8Array(first.buffer));
 assert.equal(again.inspection.anchor,'bottom-center');
});
test('preserves binary chunks and rejects invalid or unmeasurable models',()=>{
 const parsed=api().readGlb(fixture());const binary=parsed.binary;
 const result=api().normalizeGlb(api().writeGlb(parsed.json,binary));
 assert.deepEqual(Array.from(api().readGlb(result.buffer).binary),Array.from(binary));
 assert.throws(()=>api().normalizeGlb(new Uint8Array([1,2,3]).buffer),/GLB/);
 const empty={asset:{version:'2.0'},scenes:[{nodes:[]}],nodes:[]};assert.throws(()=>api().normalizeGlb(api().writeGlb(empty)),/边界|bounds/i);
});
test('rejects cyclic and nonfinite transforms rather than saving a broken anchor',()=>{
 const {json,binary}=api().readGlb(fixture());json.nodes[0].children=[0];assert.throws(()=>api().normalizeGlb(api().writeGlb(json,binary)),/循环|cycle/i);
 delete json.nodes[0].children;json.nodes[0].scale=[null,1,1];assert.throws(()=>api().normalizeGlb(api().writeGlb(json,binary)),/transform|变换/i);
});
test('uses rendered indexed vertices for a rotated triangle, not the transformed AABB or unused vertices',()=>{
 const positions=new Float32Array([0,0,0,1,1,0,0,1,0,100,-10,100]);const indexes=new Uint16Array([0,1,2]);const bin=new Uint8Array(positions.byteLength+8);bin.set(new Uint8Array(positions.buffer));bin.set(new Uint8Array(indexes.buffer),positions.byteLength);
 const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,rotation:[0,0,Math.sin(-Math.PI/8),Math.cos(-Math.PI/8)]}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],accessors:[{bufferView:0,type:'VEC3',componentType:5126,count:4,min:[0,-10,0],max:[100,1,100]},{bufferView:1,type:'SCALAR',componentType:5123,count:3}],bufferViews:[{buffer:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:6}],buffers:[{byteLength:bin.length}]};
 const result=api().normalizeGlb(api().writeGlb(json,bin));const meta=api().readGlb(result.buffer).json.extras.villageModel;
 assert.ok(Math.abs(meta.originalBounds.min[1])<1e-8);assert.ok(meta.originalBounds.max[0]<2);
 assert.ok(Math.abs(result.inspection.bounds.min[1])<1e-8);
});
test('deformed poses and compressed positions require CPU preparation instead of a false ground anchor',()=>{
 const {json,binary}=api().readGlb(fixture());json.nodes[0].skin=0;
 assert.throws(()=>api().normalizeGlb(api().writeGlb(json,binary)),/静态|deform|skin/i);
 delete json.nodes[0].skin;json.meshes[0].primitives[0].targets=[{POSITION:0}];
 assert.throws(()=>api().normalizeGlb(api().writeGlb(json,binary)),/静态|deform|morph/i);
 delete json.meshes[0].primitives[0].targets;json.bufferViews[0].extensions={EXT_meshopt_compression:{}};
 assert.throws(()=>api().normalizeGlb(api().writeGlb(json,binary)),/CPU|压缩/);
});
test('async preparation preserves its source bytes and shares the same accurate anchor',async()=>{
 assert.equal(typeof api().normalizeGlbAsync,'function');const source=fixture(),copy=new Uint8Array(source).slice();
 const result=await api().normalizeGlbAsync(source);assert.deepEqual(new Uint8Array(source),copy);
 assert.deepEqual(result.inspection.bounds.size,[4,10,2]);
});
test('browser async preparation dispatches a transferable copy to the model worker and terminates it',async()=>{
 const vm=require('node:vm'),source=fixture(),copy=new Uint8Array(source).slice();let workerUrl,terminated=false;
 class Worker {
  constructor(url){workerUrl=String(url);}
  postMessage(message,transfer){const received=structuredClone(message,{transfer});setImmediate(()=>this.onmessage({data:{result:api().normalizeGlb(received.buffer,received.options)}}));}
  terminate(){terminated=true;}
 }
 const ctx={Worker,URL,ArrayBuffer,Uint8Array,DataView,TextEncoder,TextDecoder,document:{currentScript:{src:'https://example.test/features/models/glb-normalization.js?v=1'}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(modulePath,'utf8'),ctx);
 const result=await ctx.GlbNormalizationModule.normalizeGlbAsync(source);
 assert.equal(workerUrl,'https://example.test/features/models/glb-normalization-worker.js');assert.equal(terminated,true);
 assert.deepEqual(new Uint8Array(source),copy);assert.deepEqual(Array.from(result.inspection.bounds.size),[4,10,2]);
});
