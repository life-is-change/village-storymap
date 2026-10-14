import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Document,WebIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {createModelVariants} from '../browser-variants.mjs';
const normalizer=createRequire(import.meta.url)('../../../features/models/glb-normalization.js');

export async function texturedFixture(){
 const d=new Document(),buf=d.createBuffer(),positions=[],uv=[],indices=[],n=24;
 for(let z=0;z<=n;z++)for(let x=0;x<=n;x++){positions.push(10+x/n*8,3+Math.sin(x/n*Math.PI)*2,2+z/n*6);uv.push(x/n,z/n);}
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=z*(n+1)+x,b=a+n+1;indices.push(a,b,a+1,a+1,b,b+1);}
 const pixels=new Uint8Array(2048*1024*4);for(let i=0;i<pixels.length;i+=4){const x=(i/4)%2048,y=Math.floor(i/4/2048);pixels[i]=x%256;pixels[i+1]=y%256;pixels[i+2]=100;pixels[i+3]=x%32<16?255:128;}
 const texture=d.createTexture().setImage(await sharp(pixels,{raw:{width:2048,height:1024,channels:4}}).png().toBuffer()).setMimeType('image/png');
 const primitive=d.createPrimitive().setAttribute('POSITION',d.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buf)).setAttribute('TEXCOORD_0',d.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf)).setIndices(d.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buf)).setMaterial(d.createMaterial().setBaseColorTexture(texture).setAlphaMode('BLEND').setDoubleSided(true));
 d.createScene().addChild(d.createNode().setMesh(d.createMesh().addPrimitive(primitive)));
 return new WebIO().writeBinary(d);
}
async function resizeImage(bytes,mime,maxSize){const resized=await sharp(bytes).resize({width:maxSize,height:maxSize,fit:'inside',withoutEnlargement:true}).png().toBuffer(),info=await sharp(resized).metadata();return {bytes:resized,mimeType:'image/png',width:info.width,height:info.height};}
test('automatic upload keeps detailed texture and alpha but resizes and simplifies shared low variant',async()=>{
 const source=await texturedFixture(),copy=source.slice(),result=await createModelVariants(source,{resizeImage});
 assert.deepEqual(source,copy);
 assert.equal(result.inspection.triangleCount,1152);assert.ok(result.lowInspection.triangleCount<1152);
 const io=new WebIO(),high=await io.readBinary(new Uint8Array(result.buffer)),low=await io.readBinary(new Uint8Array(result.lowBuffer));
 const h=await sharp(high.getRoot().listTextures()[0].getImage()).metadata(),l=await sharp(low.getRoot().listTextures()[0].getImage()).metadata();
 assert.deepEqual([h.width,h.height],[2048,1024]);assert.deepEqual([l.width,l.height],[512,256]);assert.equal(l.hasAlpha,true);
 assert.deepEqual(high.getRoot().listScenes()[0].listChildren()[0].getMatrix(),low.getRoot().listScenes()[0].listChildren()[0].getMatrix());
 assert.deepEqual(normalizer.readGlb(result.buffer).json.extras.villageModel.originalBounds,normalizer.readGlb(result.lowBuffer).json.extras.villageModel.originalBounds);
 assert.equal(result.processing.automatic,true);
});
test('bundled upload worker runs self-contained and preserves complete tiny model parts',async()=>{
 const vm=await import('node:vm'),bench=await readFile(new URL('../../../3D_scenes_edit/assets/models/bench.glb',import.meta.url));
 const bundle=await readFile(new URL('../../../assets/vendor/model-optimizer/automatic-model-worker.js',import.meta.url),'utf8');
 let response,transfers;
 const context={ArrayBuffer,DataView,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,TextEncoder,TextDecoder,Blob,URL,WebAssembly,performance,console,setTimeout,clearTimeout,fetch,self:{postMessage(value,transfer){response=value;transfers=transfer;}}};
 vm.runInNewContext(bundle,context);await context.self.onmessage({data:{buffer:bench.buffer.slice(bench.byteOffset,bench.byteOffset+bench.byteLength)}});
 assert.equal(response.error,undefined);assert.ok(response.result.lowBuffer);assert.equal(transfers.length,2);
 assert.equal(response.result.inspection.triangleCount,48);assert.equal(response.result.lowInspection.triangleCount,48,'tiny parts stay intact');
});
// The same small, embedded fixture is used by the real-browser verification page.
if(process.env.WRITE_BROWSER_FIXTURE==='1')await writeFile(new URL('../../../experiments/student-models-20261013/textured-roof.glb',import.meta.url),await texturedFixture());
