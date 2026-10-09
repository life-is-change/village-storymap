const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../app-3d.js'),'utf8');
const body=source.slice(source.indexOf('  async function addViewerImageryLayers('),source.indexOf('\n  function parseCSV',source.indexOf('  async function addViewerImageryLayers(')));
test('late imagery from the previous village cannot cover the new village',async()=>{
 let village='A';const layers=[],pending={};
 const s={imageryLoadGeneration:0,get3DLoadKey:()=>village,
  viewer:{imageryLayers:{removeAll:()=>layers.splice(0),addImageryProvider:provider=>{const l={id:provider};layers.push(l);return l;},raiseToTop(){}},scene:{globe:{}}},
  getMain3DResources:()=>({imageryUrl:village,initialExtent:[110,20,111,21]}),
  getBasemapGeoref:()=>{throw Error('fallback');},
  createNaturalEarthBaseProvider:async()=>'earth',createTianDiTuWorldImageryProvider:()=>'global',
  createSingleTileImageryProvider:url=>new Promise(r=>pending[url]=()=>r(url)),
  ENABLE_ION_WORLD_IMAGERY:false,Cesium:{Rectangle:{fromDegrees:()=>[]}},console:{log(){},warn(){}}
 };
 const run=vm.runInNewContext(body+';addViewerImageryLayers',s);
 const a=run(false);await new Promise(r=>setImmediate(r));
 village='B';const b=run(false);await new Promise(r=>setImmediate(r));
 pending.B();await b;pending.A();await a;
 assert.deepEqual(layers.map(x=>x.id),['earth','global','B']);
});
