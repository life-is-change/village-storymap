const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8');
const body=source.slice(source.indexOf('async function ensureLayerLoaded('),source.indexOf('\nasync function ensureSelectedLayersLoaded('));
test('departed village resource cannot overwrite new village cache or clear its pending load',async()=>{
 let release;const gate=new Promise(r=>release=r),reads=[];
 const s={
  layerDataCache:{},layerDataLoadPromises:{},layerDataGeneration:0,layerDataActorId:'u',datasetAssetCache:null,
  window:{VillageAuth:{getCurrentUser:()=>({id:'u'})}},
  layerConfigs:{building:{geojsonUrl:'base'}},
  activeVillageContext:{datasetResources:{storageBacked:true,layers:{building:'old'}}},
  loadDatasetText:async url=>{reads.push(url);await gate;return JSON.stringify({features:[{id:url}]});},
  getGeoJSONFeatures:x=>x.features,buildRowIndex:()=>new Map()
 };
 const ensure=vm.runInNewContext(body+';ensureLayerLoaded',s);
 const old=ensure('building');
 s.layerDataGeneration++;delete s.layerDataLoadPromises.building;
 s.activeVillageContext={datasetResources:{storageBacked:true,layers:{building:'new'}}};
 const next=ensure('building');release();
 await Promise.all([old,next]);
 assert.deepEqual(reads,['old','new']);assert.equal(s.layerDataCache.building.features[0].id,'new');
 assert.equal(Object.keys(s.layerDataLoadPromises).length,0);
});

test('changing accounts cannot reuse the previous account layer cache',async()=>{
 const s={
  layerDataCache:{building:{features:[{id:'old'}]}},layerDataLoadPromises:{},
  layerDataGeneration:0,layerDataActorId:'old',datasetAssetCache:null,
  window:{VillageAuth:{getCurrentUser:()=>({id:'new'})}},
  layerConfigs:{building:{geojsonUrl:'base'}},activeVillageContext:null,
  loadDatasetText:async()=>JSON.stringify({features:[{id:'new'}]}),
  getGeoJSONFeatures:x=>x.features,buildRowIndex:()=>new Map()
 };
 const ensure=vm.runInNewContext(body+';ensureLayerLoaded',s);
 assert.equal((await ensure('building')).features[0].id,'new');
});
