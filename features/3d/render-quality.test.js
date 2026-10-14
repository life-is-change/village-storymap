const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(stored, blocked = false) {
  const filename = path.join(__dirname, 'render-quality.js');
  assert.ok(fs.existsSync(filename), 'render quality policy must be available');
  const values = new Map(stored === undefined ? [] : [['village:render-quality', stored]]);
  const listeners = new Map();
  const root = { devicePixelRatio: 3, localStorage: {
    getItem(key) { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('blocked'); values.set(key, value); }
  }, addEventListener: (type, callback) => listeners.set(type, callback) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { window: root });
  return { api: root.RenderQualityModule, values, listeners };
}

test('profiles bound GPU pixels and simultaneous detail work for each device tier', () => {
  const { api } = fixture();
  for (const [mode, scale, budget, pixels] of [
    ['low', 0.75, 12, 140], ['balanced', 1, 24, 100], ['high', 1.5, 48, 70]
  ]) {
    const profile = api.getProfile(mode);
    assert.equal(profile.resolutionScale, scale);
    assert.equal(profile.modelBudget, budget);
    assert.equal(profile.detailPixels, pixels);
    const viewer = { scene: { requestRender() {} }, shadows: true };
    api.applyViewer(viewer, mode);
    assert.equal(viewer.resolutionScale, scale);
    assert.equal(viewer.shadows, mode === 'high');
  }
  assert.equal(api.getProfile('unrecognized').mode, 'balanced');
  assert.ok(Object.isFrozen(api.getProfile('low')));
});

test('local selection persists and callbacks stop after unsubscribe', () => {
  const { api, values, listeners } = fixture('low');
  assert.equal(api.getMode(), 'low');
  assert.equal(api.getProfile().mode, 'low');
  const changes = [];
  const unsubscribe = api.subscribe((mode, profile) => changes.push([mode, profile.modelBudget]));
  api.setMode('high');
  api.setMode('high');
  assert.equal(values.get('village:render-quality'), 'high');
  assert.deepEqual(changes, [['high', 48]]);
  listeners.get('storage')({ key: 'village:render-quality', newValue: 'balanced' });
  assert.equal(api.getMode(), 'balanced');
  unsubscribe();
  api.setMode('low');
  assert.deepEqual(changes, [['high', 48], ['balanced', 24]]);
});

test('blocked storage and stale values preserve usable balanced defaults', () => {
  assert.equal(fixture('obsolete').api.getMode(), 'balanced');
  const { api } = fixture(undefined, true);
  assert.equal(api.getMode(), 'balanced');
  api.setMode('low');
  assert.equal(api.getMode(), 'low');
  let draws = 0;
  const viewer = { scene: { requestRender: () => draws++ } };
  api.applyViewer(viewer);
  assert.equal(viewer.resolutionScale, 0.75);
  assert.equal(draws, 1);
  api.applyViewer({ isDestroyed: () => true });
});
