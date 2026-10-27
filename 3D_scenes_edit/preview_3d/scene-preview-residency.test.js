const test = require('node:test');
const assert = require('node:assert/strict');
const { createScenePreviewAdapter } = require('./scene-preview-adapter');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(resolver, budget = 1, globe) {
  const entities = new Map(), listeners = new Set();
  const viewer = {
    scene: { canvas: { width: 1000, height: 1000 }, globe, requestRender() {} },
    entities: { add(entity) { entities.set(entity.id, entity); return entity; }, remove(entity) { entities.delete(entity.id); } },
    camera: { positionWC: { x: 0, y: 0, z: 10 }, frustum: { fovy: Math.PI / 2 },
      changed: { addEventListener(callback) { listeners.add(callback); return () => listeners.delete(callback); } } }
  };
  const Cesium = {
    Cartesian3: { fromDegrees: (x, y, z = 0) => ({ x, y, z }), fromDegreesArray: value => value,
      distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) },
    HeadingPitchRoll: class {}, Transforms: { headingPitchRollQuaternion: () => ({}) },
    SceneTransforms: { wgs84ToWindowCoordinates: (_scene, position) => ({ x: position.x > 500 ? 2000 : 500, y: 500 }) },
    Color: { WHITE: { withAlpha: () => ({}) }, GRAY: {} }, HeightReference: { RELATIVE_TO_GROUND: 'relative' }
  };
  const adapter = createScenePreviewAdapter({ Cesium, viewer, assetResolver: resolver,
    getModelBudget: () => budget, getDetailPixels: () => 100 });
  return { adapter, viewer, Cesium, entities, listeners, change() { for (const callback of listeners) callback(); } };
}
function scene(points, suffix = '') {
  return { layers: [{ id: 'design', visible: true }], objects: points.map(([id, x]) => ({
    id, kind: 'asset', category: 'bench', layerId: 'design', geometry: { type: 'Point', coordinates: [x, 0] },
    properties: { assetRef: 'bench' + suffix }, transform: { scale: [1, 1, 1] }
  })) };
}
function assets(extra = {}, suffix = '') {
  return new Map([['bench' + suffix, { id: 'bench' + suffix, fileType: 'glb', storagePath: 'full' + suffix,
    footprintM: [2, 2], defaultHeightM: 2, ...extra }]]);
}

test('terrain tile completion makes elevated ground models eligible and removes its listener on dispose', async () => {
  let groundHeight;
  const requests = [], tileListeners = new Set();
  const globe = {
    getHeight: () => groundHeight,
    tileLoadProgressEvent: { addEventListener(callback) { tileListeners.add(callback); return () => tileListeners.delete(callback); } }
  };
  const h = setup(async () => { requests.push('load'); return 'signed:bench'; }, 1, globe);
  h.viewer.camera.positionWC.z = 60;
  h.Cesium.Cartographic = { fromDegrees: (longitude, latitude) => ({ longitude, latitude }) };
  h.Cesium.SceneTransforms.wgs84ToWindowCoordinates = (_scene, position) => ({ x: position.z < 40 ? 2000 : 500, y: 500 });
  await h.adapter.render(scene([['ground', 0]]), assets({ footprintM: [5, 5] }));
  await tick();
  assert.equal(requests.length, 0);
  groundHeight = 45;
  for (const callback of tileListeners) callback(0);
  await tick();
  assert.equal(requests.length, 1, 'visible ground at 45m must not be culled using sea level');
  assert.equal(h.entities.get('scene-edit:ground').model.uri, 'signed:bench');
  h.adapter.dispose();
  assert.equal(tileListeners.size, 0);
});

test('small bundled seed models keep their lightweight geometry at overview distance without remote signing', async () => {
  const h = setup(async () => { throw new Error('bundled models must not need signing'); });
  h.viewer.camera.positionWC.z = 1000;
  const document = scene([['seed', 0]]);
  document.objects[0].properties.assetRef = 'seed:bench:test';
  const url = '3D_scenes_edit/assets/models/bench.glb';
  await h.adapter.render(document, new Map([['seed:bench:test', {
    id: 'seed:bench:test', fileType: 'glb', url, footprintM: [2, 2], defaultHeightM: 1
  }]]));
  await tick();
  assert.equal(h.entities.get('scene-edit:seed').model?.uri, url);
  assert.equal(h.entities.get('scene-edit:seed').box, undefined);
  assert.equal(h.adapter.getModelStats().resident, 1);
  h.adapter.dispose();
});

test('loads only in-view models in budget and prioritizes a selected distant object', async () => {
  const requests = [];
  const h = setup(async (_asset, descriptor) => { requests.push(descriptor.sourceObjectId); return 'signed:' + descriptor.sourceObjectId; });
  await h.adapter.render(scene([['near', 0], ['far', 200], ['offscreen', 1000]]), assets());
  await tick();
  assert.deepEqual(requests, ['near']);
  assert.equal(h.entities.get('scene-edit:near').model.minimumPixelSize, 0);
  assert.equal(h.entities.get('scene-edit:far').model, undefined);
  assert(h.entities.get('scene-edit:far').box);
  h.adapter.select(['far']); await tick();
  assert.deepEqual(requests, ['near', 'far']);
  assert.equal(h.entities.get('scene-edit:near').model, undefined);
  assert(h.entities.get('scene-edit:near').box);
  assert.equal(h.entities.get('scene-edit:far').model.silhouetteSize, 2);
  h.adapter.dispose();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.entities.size, 0);
});

test('camera changes remove the full GLB at distance, use an explicit low variant, and reload detail near', async () => {
  const variants = [];
  const h = setup(async (asset, descriptor) => { variants.push([asset.storagePath, descriptor.variant]); return 'signed:' + asset.storagePath; });
  await h.adapter.render(scene([['one', 0]]), assets({ metadata: { lowStoragePath: 'low' } })); await tick();
  h.viewer.camera.positionWC.z = 1000; h.change(); await tick();
  assert.deepEqual(variants, [['full', 'detail'], ['low', 'low']]);
  assert.equal(h.entities.get('scene-edit:one').model.uri, 'signed:low');
  h.viewer.camera.positionWC.z = 10; h.change(); await tick();
  assert.equal(h.entities.get('scene-edit:one').model.uri, 'signed:full');
  assert.equal(h.entities.get('scene-edit:one').box, undefined);
  h.adapter.dispose();
});

test('disposed or replaced scenes cannot receive late signed model results', async () => {
  let resolve;
  const h = setup(() => new Promise(done => { resolve = done; }));
  const rendering = h.adapter.render(scene([['old', 0]]), assets());
  await tick();
  await h.adapter.render(scene([]), assets());
  assert.equal(h.entities.has('scene-edit:old'), false);
  resolve('signed:old'); await rendering; await tick();
  assert.equal(h.entities.size, 0);
  const next = h.adapter.render(scene([['new', 0]]), assets()); await tick();
  h.adapter.dispose(); resolve('signed:new'); await next; await tick();
  assert.equal(h.entities.size, 0);
});

test('render counts return before delayed model signing and expose a readiness promise', async () => {
  let resolve;
  const h = setup(() => new Promise(done => { resolve = done; }));
  const rendering = h.adapter.render(scene([['one', 0]]), assets());
  const result = await Promise.race([rendering, new Promise(done => setTimeout(() => done(null), 30))]);
  if (!result) { resolve('signed:one'); await rendering; h.adapter.dispose(); }
  assert(result, 'render must return its counts before signing resolves');
  assert.equal(result.counts.models, 1);
  assert.equal(typeof result.ready?.then, 'function');
  assert(h.entities.get('scene-edit:one').box);
  resolve('signed:one'); await result.ready;
  assert.equal(h.entities.get('scene-edit:one').model.uri, 'signed:one');
  h.adapter.dispose();
});

test('changing the same object id into a surface removes its GLB and cannot reinstall a late model', async () => {
  let resolve;
  const h = setup(() => new Promise(done => { resolve = done; }));
  await h.adapter.render(scene([['same', 0]]), assets());
  const surface = { layers: [{ id: 'design', visible: true }], objects: [{
    id: 'same', kind: 'surface', category: 'paving', layerId: 'design',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] }, properties: {}
  }] };
  await h.adapter.render(surface, assets());
  resolve('signed:old'); await tick();
  const entity = h.entities.get('scene-edit:same');
  assert(entity.polygon);
  assert.equal(entity.model, undefined);
  assert.equal(entity.box, undefined);
  assert.equal(h.adapter.getModelStats().registered, 0);
  h.adapter.dispose();
});

test('clear releases model components and cancels pending installations without removing camera hooks', async () => {
  let resolve;
  const h = setup(() => new Promise(done => { resolve = done; }));
  await h.adapter.render(scene([['old', 0]]), assets());
  assert.equal(typeof h.adapter.clear, 'function');
  h.adapter.clear();
  resolve('signed:old'); await tick();
  assert.equal(h.entities.size, 0);
  assert.equal(h.listeners.size, 1);
  assert.equal(h.adapter.getModelStats().resident, 0);
  h.adapter.dispose();
});

function nativeSetup(budget = 3, globe) {
  const h = setup(async asset => 'signed:' + asset.storagePath, budget, globe);
  // Recreate using a Cesium implementation that supports explicitly owned Models.
  h.adapter.dispose();
  const requests = [], primitives = new Set();
  class Cartesian3 {
    constructor(x, y, z) { Object.assign(this, { x, y, z }); }
    static fromDegrees(x, y, z = 0) { return new Cartesian3(x, y, z); }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
    static fromDegreesArray(values) { return values; }
  }
  const Cesium = {
    Cartesian3, HeadingPitchRoll: class { constructor(heading, pitch, roll) { Object.assign(this, { heading, pitch, roll }); } },
    Cartographic: { fromDegrees: (longitude, latitude) => ({ longitude, latitude }) },
    Transforms: { headingPitchRollQuaternion: () => ({}), headingPitchRollToFixedFrame: (position, hpr) => ({ position, hpr }) },
    Matrix4: { multiplyByScale(matrix, scale) { matrix.scale = scale; return matrix; } },
    Model: { fromGltfAsync(options) { return new Promise((resolve, reject) => requests.push({ options, resolve, reject })); } },
    Color: { GRAY: {}, WHITE: { withAlpha: () => ({}) }, YELLOW: 'yellow' }, HeightReference: { RELATIVE_TO_GROUND: 'relative', NONE: 'none' }
  };
  h.viewer.scene.primitives = { add(primitive) { primitives.add(primitive); }, remove(primitive) { primitives.delete(primitive); } };
  h.adapter = createScenePreviewAdapter({ Cesium, viewer: h.viewer, getModelBudget: () => budget, getDetailPixels: () => 100,
    assetResolver: async asset => 'signed:' + asset.storagePath });
  h.requests = requests; h.primitives = primitives;
  h.Cesium = Cesium;
  h.finish = async index => {
    let destroyed = false;
    const errors = new Set();
    const primitive = { destroyCount: 0, destroy() { this.destroyCount++; destroyed = true; }, isDestroyed: () => destroyed,
      errorEvent: { addEventListener(callback) { errors.add(callback); return () => errors.delete(callback); } },
      emitError(error) { for (const callback of [...errors]) callback(error); },
      captureErrors() { return [...errors]; }, errorListeners: errors };
    requests[index].resolve(primitive); await tick(); return primitive;
  };
  return h;
}

test('camera motion reuses stationary model terrain height and tile completion refreshes the matrix', async () => {
  let height = 45, samples = 0;
  const tileListeners = new Set(), providerListeners = new Set();
  const event = listeners => ({ addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); } });
  const h = nativeSetup(1, { getHeight() { samples++; return height; },
    tileLoadProgressEvent: event(tileListeners), terrainProviderChanged: event(providerListeners) });
  h.viewer.camera.positionWC.z = 60;
  const doc = scene([['ground', 0]]);
  doc.objects[0].transform.heightOffsetM = 2;
  await h.adapter.render(doc, assets({ metadata: { groundOffsetM: 1 } })); await tick();
  const primitive = await h.finish(0);
  h.change();
  assert.equal(h.requests[0].options.modelMatrix.position.z, 48);
  const before = samples;
  for (let i = 0; i < 30; i++) h.change();
  assert.equal(samples, before, 'camera changes must not ray-pick terrain for stationary objects');
  height = 52;
  for (const fn of tileListeners) fn(0);
  assert.equal(primitive.modelMatrix.position.z, 55);
  height = 60;
  for (const fn of providerListeners) fn();
  assert.equal(primitive.modelMatrix.position.z, 63);
  doc.objects[0].geometry.coordinates = [2, 0];
  await h.adapter.render(doc, assets({ metadata: { groundOffsetM: 1 } }));
  assert.equal(primitive.modelMatrix.position.x, 2);
  h.adapter.dispose();
  assert.equal(tileListeners.size, 0);
  assert.equal(providerListeners.size, 0);
});

test('native models limit actual GLB loads, preserve pick ids, apply calibrated matrices, and destroy every GPU resource', async () => {
  const h = nativeSetup();
  const document = scene([['a', 0], ['b', 0], ['c', 0]]);
  document.objects[0].transform = { scale: [2, 3, 4], headingDeg: 90, heightOffsetM: 2 };
  await h.adapter.render(document, assets({ metadata: { calibrationScale: [4, 5, 6], groundOffsetM: 1, headingCorrectionDeg: 30 } }));
  await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].options.minimumPixelSize, 0);
  assert.equal(h.requests[0].options.heightReference, 'none');
  assert.equal(h.requests[0].options.scene, h.viewer.scene);
  assert.equal(h.requests[0].options.id, h.entities.get('scene-edit:a'));
  const appliedScale = h.requests[0].options.modelMatrix.scale;
  assert.deepEqual([appliedScale.x, appliedScale.y, appliedScale.z], [8, 15, 24]);
  assert.equal(h.requests[0].options.modelMatrix.position.z, 3);
  assert(Math.abs(h.requests[0].options.modelMatrix.hpr.heading - 2 * Math.PI / 3) < 1e-9);
  const first = await h.finish(0);
  assert.equal(h.requests.length, 3);
  assert(h.primitives.has(first));
  assert.equal(h.entities.get('scene-edit:a').show, false);
  h.adapter.select(['a']);
  assert.equal(first.silhouetteSize, 2);
  h.adapter.dispose();
  const second = await h.finish(1), third = await h.finish(2);
  assert.equal(first.destroyCount, 1);
  assert.equal(second.destroyCount, 1);
  assert.equal(third.destroyCount, 1);
  assert.equal(h.primitives.size, 0);
  assert.equal(h.entities.size, 0);
});

test('native GLB rejection keeps a labeled proxy and frees capacity for the next model', async () => {
  const h = nativeSetup(2);
  const result = await h.adapter.render(scene([['a', 0], ['b', 0]]), assets()); await tick();
  assert.equal(h.requests.length, 2);
  h.requests[0].reject(new Error('invalid model payload')); await tick();
  assert(h.entities.get('scene-edit:a').label.text.includes('模型不可用'));
  await h.finish(1); await result.ready;
  assert.equal(h.adapter.getModelStats().failed, 1);
  h.adapter.dispose();
});

test('screen-size eligibility uses scene width/depth/height scale axes consistently with the model matrix', async () => {
  let loads = 0;
  const h = setup(async () => { loads++; return 'signed:one'; });
  const document = scene([['one', 0]]);
  document.objects[0].transform.scale = [1, 1, .1];
  await h.adapter.render(document, assets({ footprintM: [1, 1], defaultHeightM: 8 })); await tick();
  assert.equal(loads, 0);
  assert(h.entities.get('scene-edit:one').box);
  h.adapter.dispose();
});

test('a rejected native GLB releases an owned blob URL even when no GPU resource was returned', async () => {
  const h = nativeSetup(1);
  const revoked = [];
  const previous = URL.revokeObjectURL;
  URL.revokeObjectURL = uri => revoked.push(uri);
  try {
    const result = await h.adapter.render(scene([['one', 0]]), assets({ url: 'blob:invalid-glb' })); await tick();
    h.requests[0].reject(new Error('bad geometry')); await result.ready;
    assert.deepEqual(revoked, ['blob:invalid-glb']);
  } finally { h.adapter.dispose(); URL.revokeObjectURL = previous; }
});

test('a deferred native GPU error releases the owned model and restores a labeled proxy without immediate retry', async () => {
  const h = nativeSetup(1);
  await h.adapter.render(scene([['one', 0]]), assets()); await tick();
  const primitive = await h.finish(0);
  primitive.emitError(new Error('GPU processing failed'));
  await tick();
  assert.equal(primitive.destroyCount, 1);
  assert.equal(primitive.errorListeners.size, 0);
  assert.equal(h.primitives.size, 0);
  assert.equal(h.entities.get('scene-edit:one').show, true);
  assert(h.entities.get('scene-edit:one').label.text.includes('模型不可用'));
  assert.equal(h.adapter.getModelStats().failed, 1);
  assert.equal(h.requests.length, 1);
  h.adapter.dispose();
});

test('an old GPU error cannot evict a replacement or resurrect a cleared scene', async () => {
  const h = nativeSetup(1);
  await h.adapter.render(scene([['one', 0]]), assets()); await tick();
  const old = await h.finish(0), oldCallbacks = old.captureErrors();
  assert.equal(oldCallbacks.length, 1);
  await h.adapter.render(scene([['one', 0]]), assets({ storagePath: 'replacement' })); await tick();
  const current = await h.finish(1);
  for (const callback of oldCallbacks) callback(new Error('late previous failure'));
  assert(h.primitives.has(current));
  assert.equal(current.destroyCount, 0);
  assert.equal(h.adapter.getModelStats().resident, 1);
  assert.equal(h.adapter.getModelStats().failed, 0);
  const currentCallbacks = current.captureErrors();
  h.adapter.clear();
  for (const callback of currentCallbacks) callback(new Error('error after clear'));
  assert.equal(h.entities.size, 0);
  assert.equal(current.destroyCount, 1);
  h.adapter.dispose();
});
