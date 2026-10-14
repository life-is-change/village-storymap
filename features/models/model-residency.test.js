const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, 'model-residency.js');
const api = fs.existsSync(modulePath) ? require(modulePath) : {};
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(budget = 2) {
  const requests = [], disposed = [], visibility = [], errors = [];
  const manager = api.createModelResidencyManager({
    getBudget: () => budget, getDetailPixels: () => 100,
    load(entry) {
      return new Promise((resolve, reject) => requests.push({ entry, resolve, reject }));
    },
    unload(resource, entry) { disposed.push({ resource, entry }); },
    setVisible(resource, visible, entry) { visibility.push({ resource, visible, entry }); },
    onError(error, entry) { errors.push({ error, entry }); }
  });
  return { manager, requests, disposed, visibility, errors,
    budget(value) { budget = value; },
    async finish(index) { const resource = { id: index }; requests[index].resolve(resource); await tick(); return resource; }
  };
}
const candidate = (key, pixels = 200, extra = {}) => ({ key, pixels, distance: 10, inView: true, ...extra });

test('zoom around the LOD boundary does not destroy and reload the same model repeatedly',async()=>{
 const h=harness(1);h.manager.register('house',{url:'high.glb',lowUrl:'low.glb'});
 h.manager.update([candidate('house',101)]);await h.finish(0);
 for(const pixels of [99,101,96,103])h.manager.update([candidate('house',pixels)]);
 assert.equal(h.requests.length,1);assert.equal(h.disposed.length,0);
 h.manager.update([candidate('house',70)]);await h.finish(1);
 for(const pixels of [99,103,109])h.manager.update([candidate('house',pixels)]);
 assert.equal(h.requests.length,2);assert.equal(h.manager.getState('house').variant,'low');
 h.manager.update([candidate('house',130)]);await h.finish(2);
 assert.equal(h.manager.getState('house').variant,'detail');
});

test('a selected building keeps loading priority but still uses its low model when viewed from far away',async()=>{
 const h=harness(1);h.manager.register('selected',{url:'high.glb',lowUrl:'low.glb'});h.manager.register('other',{url:'other.glb'});
 h.manager.update([candidate('selected',20,{selected:true}),candidate('other',200)]);await h.finish(0);
 assert.equal(h.requests[0].entry.key,'selected');assert.equal(h.requests[0].entry.variant,'low');
 h.manager.update([candidate('selected',200,{selected:true}),candidate('other',200)]);await h.finish(1);
 assert.equal(h.manager.getState('selected').variant,'detail');
});

test('changed placement revision reloads a resource even when its asset URL is unchanged', async () => {
  const h=harness(1);h.manager.register('house',{url:'house.glb',revision:'position-a'});
  h.manager.update([candidate('house')]);await h.finish(0);
  h.manager.register('house',{url:'house.glb',revision:'position-b'});
  assert.equal(h.disposed.length,1);assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].entry.revision,'position-b');
});
test('a late GPU processing failure frees its resident and waits for a new view update to retry',async()=>{
 const h=harness(1);h.manager.register('house',{url:'house.glb'});h.manager.update([candidate('house')]);await h.finish(0);
 assert.equal(typeof h.manager.fail,'function');h.manager.fail('house',new Error('GPU processing failed'));
 assert.equal(h.manager.getStats().resident,0);assert.equal(h.disposed.length,1);assert.equal(h.requests.length,1);
 h.manager.update([candidate('house')]);assert.equal(h.requests.length,2);
});

test('exports a reusable manager', () => {
  assert.equal(typeof api.createModelResidencyManager, 'function');
});

test('selected models take precedence, screen area breaks ties deterministically, and budget caps residents', async () => {
  const h = harness(2);
  for (const key of ['z', 'b', 'a']) h.manager.register(key, { url: key + '.glb' });
  h.manager.update([candidate('z', 1, { selected: true }), candidate('b'), candidate('a')]);
  assert.deepEqual(h.requests.map(r => r.entry.key), ['z', 'a']);
  await h.finish(0); await h.finish(1);
  assert.equal(h.manager.getStats().resident, 2);
  h.budget(1);
  h.manager.update([candidate('z', 1, { selected: true }), candidate('b'), candidate('a')]);
  assert.equal(h.manager.getStats().resident, 1);
  assert.equal(h.disposed[0].entry.key, 'a');
});

test('far models use an explicit low asset or fall back without loading the full GLB', async () => {
  const h = harness(3);
  h.manager.register('low', { url: 'full.glb', lowUrl: 'low.glb', anchor: { x: 1 } });
  h.manager.register('plain', { url: 'plain.glb' });
  h.manager.update([candidate('low', 20), candidate('plain', 20)]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].entry.url, 'low.glb');
  assert.equal(h.requests[0].entry.variant, 'low');
  assert.deepEqual(h.requests[0].entry.anchor, { x: 1 });
  assert(h.visibility.some(v => v.entry.key === 'plain' && !v.visible));
  await h.finish(0);
  h.manager.update([candidate('low', 200), candidate('plain', 20)]);
  assert.equal(h.disposed.length, 1);
  assert.equal(h.requests[1].entry.url, 'full.glb');
  assert.equal(h.manager.getStats().resident, 0);
});

test('budget reserves pending requests and concurrency never exceeds two', async () => {
  const h = harness(4);
  for (const key of ['a', 'b', 'c', 'd']) h.manager.register(key, { url: key });
  h.manager.update(['a', 'b', 'c', 'd'].map(key => candidate(key)));
  assert.equal(h.requests.length, 2);
  assert.equal(h.manager.getStats().inFlight, 2);
  await h.finish(0);
  assert.equal(h.requests.length, 3);
  await h.finish(1);
  assert.equal(h.requests.length, 4);
  await h.finish(2); await h.finish(3);
  assert.equal(h.manager.getStats().resident, 4);
  assert.equal(h.manager.getStats().inFlight, 0);
});

test('a stale request retains its memory reservation until disposed before its replacement starts', async () => {
  const h = harness(1);
  h.manager.register('a', { url: 'a' }); h.manager.register('b', { url: 'b' });
  h.manager.update([candidate('a')]);
  h.manager.update([candidate('b', 300)]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.manager.getStats().inFlight, 1);
  await h.finish(0);
  assert.equal(h.disposed.length, 1);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].entry.key, 'b');
  assert(!h.visibility.some(v => v.entry.key === 'a' && v.visible));
});

test('rapid space clearing disposes old async results and does not show them in the new space', async () => {
  const h = harness(2);
  h.manager.register('a', { url: 'old.glb' }); h.manager.update([candidate('a')]);
  h.manager.clear();
  h.manager.register('a', { url: 'new.glb' }); h.manager.update([candidate('a')]);
  assert.equal(h.requests.length, 2);
  await h.finish(0); await h.finish(1);
  assert.deepEqual(h.disposed.map(v => v.entry.url), ['old.glb']);
  assert.equal(h.manager.getState('a').url, 'new.glb');
  assert.equal(h.manager.getStats().resident, 1);
  assert(!h.visibility.some(v => v.entry.url === 'old.glb' && v.visible));
});

test('changing the wanted variant during loading cannot duplicate the key or install a stale resource', async () => {
  const h = harness(3);
  h.manager.register('a', { url: 'full', lowUrl: 'low' });
  h.manager.update([candidate('a', 20)]);
  h.manager.update([candidate('a', 200)]);
  assert.equal(h.requests.length, 1);
  await h.finish(0);
  assert.equal(h.disposed.length, 1);
  assert.equal(h.requests[1].entry.variant, 'detail');
  await h.finish(1);
  assert.equal(h.manager.getState('a').variant, 'detail');
  assert.equal(h.manager.getStats().resident, 1);
});

test('outside-view residents are hidden and evicted when another visible model needs the budget', async () => {
  const h = harness(1);
  h.manager.register('a', { url: 'a' }); h.manager.register('b', { url: 'b' });
  h.manager.update([candidate('a')]); await h.finish(0);
  h.manager.update([candidate('a', 200, { inView: false })]);
  assert.equal(h.manager.getState('a').visible, false);
  assert.equal(h.manager.getStats().resident, 1);
  h.manager.update([candidate('b')]);
  assert.equal(h.disposed.length, 1);
  assert.equal(h.requests.length, 2);
});

test('a selected model outside the view is eligible but its newly loaded resource stays hidden', async () => {
  const h = harness(1);
  h.manager.register('a', { url: 'detail', lowUrl: 'low' });
  h.manager.update([candidate('a', 1, { selected: true, inView: false })]);
  const resource = await h.finish(0);
  assert.equal(h.requests[0].entry.url, 'low');
  assert(h.visibility.some(v => v.resource === resource && v.visible === false));
  assert.equal(h.manager.getStats().visible, 0);
});

test('unregister and URL replacement dispose resources exactly once', async () => {
  const h = harness(1);
  h.manager.register('a', { url: 'old' }); h.manager.update([candidate('a')]); await h.finish(0);
  h.manager.register('a', { url: 'new' });
  assert.equal(h.disposed.length, 1);
  assert.equal(h.requests.length, 2);
  h.manager.unregister('a'); await h.finish(1);
  assert.equal(h.disposed.length, 2);
  assert.equal(h.manager.getState('a'), null);
  h.manager.clear();
  assert.equal(h.disposed.length, 2);
});

test('destroy disposes pending results and prevents further work', async () => {
  const h = harness(1);
  h.manager.register('a', { url: 'a' }); h.manager.update([candidate('a')]);
  h.manager.destroy(); h.manager.destroy();
  h.manager.register('b', { url: 'b' }); h.manager.update([candidate('b')]);
  await h.finish(0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.disposed.length, 1);
  assert.equal(h.manager.getStats().resident, 0);
  assert.equal(h.manager.getStats().inFlight, 0);
});

test('load failures release capacity, report once, and retry only after a caller update', async () => {
  const h = harness(1);
  h.manager.register('a', { url: 'a' }); h.manager.update([candidate('a')]);
  h.requests[0].reject(new Error('invalid GLB')); await tick();
  assert.equal(h.errors.length, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.manager.getStats().inFlight, 0);
  h.manager.update([candidate('a')]);
  assert.equal(h.requests.length, 2);
});
