const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(sandbox = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const start = source.indexOf('function createPreviewRenderLoop(');
  assert.ok(start >= 0, 'preview must support rendering until controls settle');
  return vm.runInNewContext(source.slice(start, source.indexOf('function downloadGlb(', start)) +
    ';({createPreviewRenderLoop, disposeModelResources, applyPreviewQuality, replaceModel})', sandbox);
}

function loopFixture() {
  const frames = new Map(), listeners = new Map();
  let sequence = 0, renders = 0, updates = 0, remainingChanges = 0;
  const controls = {
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: event => listeners.delete(event),
    update() {
      updates++;
      if (!remainingChanges) return false;
      remainingChanges--;
      listeners.get('change')?.();
      return true;
    }
  };
  const loop = load().createPreviewRenderLoop({ controls,
    render: () => renders++, requestFrame(callback) { frames.set(++sequence, callback); return sequence; },
    cancelFrame: id => frames.delete(id)
  });
  return { loop, frames, listeners, get renders() { return renders; }, get updates() { return updates; },
    move(count) { remainingChanges = count; listeners.get('change')(); },
    flush() {
      for (let limit = 0; frames.size && limit < 100; limit++) {
        const [id, callback] = frames.entries().next().value;
        frames.delete(id); callback();
      }
    }
  };
}

test('preview coalesces invalidations and becomes idle once OrbitControls damping settles', () => {
  const f = loopFixture();
  f.loop.invalidate(); f.loop.invalidate();
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.renders, 1);
  assert.equal(f.frames.size, 0);
  f.move(4); f.flush();
  assert.equal(f.renders, 6);
  assert.equal(f.frames.size, 0, 'change events inside update must not leave an endless frame chain');
});

test('hidden preview cancels pending work and resumes once visible', () => {
  const f = loopFixture();
  f.move(3); f.loop.setVisible(false); f.flush();
  assert.equal(f.renders, 0); assert.equal(f.updates, 0);
  f.loop.invalidate(); assert.equal(f.frames.size, 0);
  f.loop.setVisible(true); f.flush();
  assert.equal(f.renders, 4); assert.equal(f.frames.size, 0);
  f.loop.dispose(); f.loop.invalidate();
  assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
});

test('low preview disables shadow drawing and caps retina pixels while high restores quality', () => {
  let ratio = null, requests = 0, mapDisposed = 0;
  const renderer = { setPixelRatio: value => ratio = value, shadowMap: { enabled: true, needsUpdate: false } };
  const sun = { castShadow: true, shadow: { map: { dispose: () => mapDisposed++ },
    mapSize: { x: 2048, y: 2048, set(x, y) { this.x = x; this.y = y; } } } };
  const { applyPreviewQuality } = load({ state: { renderer, sun, previewLoop: { invalidate: () => requests++ } },
    window: { devicePixelRatio: 3 } });
  applyPreviewQuality({ thumbnail: { pixelRatio: 0.75, shadows: false, shadowMapSize: 512 } });
  assert.equal(ratio, 0.75); assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(sun.castShadow, false); assert.equal(sun.shadow.mapSize.x, 512);
  assert.equal(mapDisposed, 1);
  applyPreviewQuality({ thumbnail: { pixelRatio: 1.5, shadows: true, shadowMapSize: 2048 } });
  assert.equal(ratio, 1.5); assert.equal(renderer.shadowMap.enabled, true);
  assert.equal(sun.castShadow, true); assert.equal(sun.shadow.mapSize.x, 2048);
  assert.equal(requests, 2);
});

test('model replacement releases every GPU resource once and preserves resources shared by the new model', () => {
  const counts = { geometry: 0, material: 0, diffuse: 0, normal: 0, reused: 0 };
  const geometry = { dispose: () => counts.geometry++ };
  const diffuse = { isTexture: true, dispose: () => counts.diffuse++ };
  const normal = { isTexture: true, dispose: () => counts.normal++ };
  const reused = { isTexture: true, dispose: () => counts.reused++ };
  const material = { map: diffuse, normalMap: normal, aoMap: reused, dispose: () => counts.material++ };
  const old = { traverse: visit => { visit({ geometry, material: [material, material] }); visit({ geometry, material }); } };
  const next = { traverse: visit => visit({ material: { map: reused, dispose() {} } }) };
  const added = [], removed = [];
  const state = { currentGroup: old, scene: { add: item => added.push(item), remove: item => removed.push(item) },
    previewLoop: { invalidate() {} } };
  load({ state }).replaceModel(next);
  assert.deepEqual(counts, { geometry: 1, material: 1, diffuse: 1, normal: 1, reused: 0 });
  assert.equal(state.currentGroup, next); assert.deepEqual(removed, [old]); assert.deepEqual(added, [next]);
});
