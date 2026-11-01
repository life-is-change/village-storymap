const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const catalog=require('../seed/catalog.json');
test('three detailed original stalls have bounded finite Y-up meshes and complete produce',()=>{
 for(const kind of ['vegetables','fruit','tofu']){
 const file=path.join(__dirname,'../models/market-'+kind+'.glb');assert.ok(fs.existsSync(file),'missing '+kind);
 const b=fs.readFileSync(file);assert.equal(b.toString('utf8',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);
 const gltf=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));let triangles=0;
 assert.deepEqual(gltf.nodes[0].rotation,[0,-Math.SQRT1_2,0,Math.SQRT1_2],"Cesium default forward-axis correction keeps width east-west");
 const names=gltf.materials.map(m=>m.name);for(const n of ['frame','canvas','wood','crate','scale','bag','sign'])assert.ok(names.includes(n),n);
 assert.ok(names.some(n=>n.startsWith('produce-')));assert.ok(gltf.meshes[0].primitives.length<30,'batch by material');
 for(const p of gltf.meshes[0].primitives){const a=gltf.accessors[p.attributes.POSITION];assert.ok(a.min.every(Number.isFinite)&&a.max.every(Number.isFinite));assert.ok(a.min[1]>=-.01&&a.max[1]<=3.3);triangles+=gltf.accessors[p.indices].count/3;}
 assert.ok(triangles>1500&&triangles<20000,kind+': '+triangles);
 const asset=catalog.assets.find(a=>a.id==='seed:stall:morning-'+kind);assert.ok(asset);assert.equal(asset.renderer,'glb');assert.ok(asset.url.includes(kind+'.glb'));
 }
});
