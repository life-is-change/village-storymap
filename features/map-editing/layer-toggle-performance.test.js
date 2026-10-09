const test = require('node:test');
const assert = require('node:assert/strict');
const { createLayerSnapshotCache } = require('./overlay-renderer');
test('layer snapshots retain hidden and initialized empty layers only in the captured space', () => {
 const cache = createLayerSnapshotCache();
 const building = { id:'b' };
 cache.commit('a', new Map([['building',[building]],['road',[]]]));
 assert.deepEqual(cache.read('a',['road','building']), new Map([['road',[]],['building',[building]]]));
 assert.equal(cache.read('b',['building']).size,0);
 cache.commit('b',new Map([['water',[]]]));
 assert.equal(cache.read('a',['building']).size,0);
});
test('force invalidation drops retained geometry and empty-layer knowledge', () => {
 const cache=createLayerSnapshotCache();
 cache.commit('a',new Map([['road',[]]]));
 cache.clear();
 assert.equal(cache.read('a',['road']).size,0);
});
