const test=require('node:test'),assert=require('node:assert/strict');
const {createDatasetAssetCache,datasetAssetKey}=require('./village-dataset-resolver');
test('version and actor scoped resource identities ignore only expiring storage tokens',()=>{
 const key=extra=>datasetAssetKey({userId:'u',villageId:'v',datasetId:'d',baseUrl:'http://localhost/',url:'https://x/storage/v1/object/sign/b/a?token=1',...extra});
 assert.equal(key({}),key({url:'https://x/storage/v1/object/sign/b/a?token=2'}));
 assert.notEqual(key({}),key({userId:'other'}));assert.notEqual(key({}),key({datasetId:'d2'}));
 assert.notEqual(key({url:'file.geojson?v=1'}),key({url:'file.geojson?v=2'}));
});
test('resource cache deduplicates, retries failures, expires and evicts by memory budget',async()=>{
 let now=0,calls=0;const cache=createDatasetAssetCache({maxEntries:2,maxBytes:12,ttlMs:10,now:()=>now});
 const load=async()=>{calls++;return 'abc';};
 const [a,b]=await Promise.all([cache.read('a',load),cache.read('a',load)]);
 assert.equal(a,b);assert.equal(calls,1);
 await cache.read('b',load);await cache.read('c',load);await cache.read('a',load);assert.equal(calls,4);
 now=11;await cache.read('a',load);assert.equal(calls,5);
 await assert.rejects(cache.read('fail',()=>{throw Error('offline');}),/offline/);
 assert.equal(await cache.read('fail',load),'abc');
 cache.clear();await cache.read('a',load);assert.equal(calls,7);
});
