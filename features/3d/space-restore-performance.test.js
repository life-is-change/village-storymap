const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../app-3d.js'), 'utf8');
const body = source.slice(source.indexOf('  async function applyCurrent3DSpaceToScene()'), source.indexOf('\n  async function loadRoads()'));

test('3D space reads edits and model bindings concurrently but applies edits before bindings', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const events = [];
  const entity = {};
  const sandbox = {
    resetSceneToBaseHeights() {}, getActualLinkedSpaceIdFor3D: () => 'space',
    fetchCurrentSpaceAllEdits: async () => { events.push('edits-read'); await blocked; return [{ object_code: 'A', data: { height: 8 } }]; },
    getGroupModelLibrary: () => ({ listBindings: async id => { events.push('bindings-read'); assert.equal(id,'space'); return [{ object_code: 'A', group_model_assets: { storage_path: 'asset' }, transform: {} }]; }, createSignedUrl: async () => 'asset' }),
    normalizeCode: x => x, entityMap: new Map([['A',entity]]),
    applyHeightToEntity: (_, height) => events.push('height:'+height),
    applyModelStateToEntity: async (_, data) => events.push(data.modelUrl ? 'binding-apply' : 'edit-apply'),
    applyRuntimeGeneratedModelsForSpace: async () => {}, update3DStatusText() {}, viewer: null, console
  };
  const run = vm.runInNewContext(`${body}; applyCurrent3DSpaceToScene`, sandbox)();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['edits-read','bindings-read']);
  release(); await run;
  assert.deepEqual(events, ['edits-read','bindings-read','height:8','edit-apply','binding-apply']);
});

test('optional binding failure does not discard edits or stop the scene restore', async () => {
  const events = [];
  const sandbox = {
    resetSceneToBaseHeights() {}, getActualLinkedSpaceIdFor3D: () => 'space',
    fetchCurrentSpaceAllEdits: async () => [{ object_code: 'A', data: { height: 12 } }],
    getGroupModelLibrary: () => ({ listBindings: async () => { throw Error('offline'); } }),
    normalizeCode: x => x, entityMap: new Map([['A', {}]]),
    applyHeightToEntity: (_, height) => events.push(height), applyModelStateToEntity: async () => {},
    applyRuntimeGeneratedModelsForSpace: async () => events.push('runtime'),
    update3DStatusText: () => events.push('render'), viewer: null,
    console: { warn: () => events.push('warning') }
  };
  await vm.runInNewContext(`${body}; applyCurrent3DSpaceToScene`, sandbox)();
  assert.deepEqual(events, [12,'warning','runtime','render']);
});
