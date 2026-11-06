const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { writeGlb, readGlb } = require('../../features/models/glb-normalization.js');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function prepareWith(exportGlb) {
  const start = source.indexOf('function hasDracoCompression(');
  const end = source.indexOf('async function replaceOriginalBuilding(', start);
  assert.ok(start >= 0, 'generator must prepare compressed models before platform handoff');
  return vm.runInNewContext(source.slice(start, end) + ';prepareModelForPlatform', {
    ArrayBuffer, DataView, Uint8Array, TextDecoder,
    GLTFExporter: class { parseAsync(group, options) { return exportGlb(group, options); } }
  });
}
function glb(extra = {}) { return writeGlb({ asset: { version: '2.0' }, ...extra }); }

test('Draco model handoff exports decoded preview while retaining source download bytes', async () => {
  const original = glb({ extensionsUsed: ['KHR_draco_mesh_compression'] });
  const snapshot = original.slice(0);
  const ordinary = glb({ meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] });
  const group = { name: 'decoded preview' };
  const prepare = prepareWith(async (input, options) => {
    assert.equal(input, group);
    assert.equal(options.binary, true);
    assert.equal(options.onlyVisible, false);
    return ordinary;
  });
  const result = await prepare(new Blob([original]), group);
  assert.equal(result, ordinary);
  assert.deepEqual(original, snapshot);
  assert.equal(readGlb(result).json.extensionsUsed, undefined);
});

test('ordinary GLB handoff preserves bytes and does not re-export materials', async () => {
  const original = glb();
  const prepare = prepareWith(() => assert.fail('ordinary GLB must not be re-exported'));
  assert.deepEqual(await prepare(new Blob([original]), {}), original);
});

test('primitive Draco extension is decoded even when declarations are absent', async () => {
  const original = glb({ meshes: [{ primitives: [{ extensions: { KHR_draco_mesh_compression: {} } }] }] });
  let exported = false;
  await prepareWith(async () => { exported = true; return glb(); })(new Blob([original]), {});
  assert.equal(exported, true);
});

test('failed export and residual compression stop the handoff', async () => {
  const original = glb({ extensionsRequired: ['KHR_draco_mesh_compression'] });
  await assert.rejects(prepareWith(async () => { throw new Error('texture export failed'); })(new Blob([original]), {}), /texture export failed/);
  await assert.rejects(prepareWith(async () => original)(new Blob([original]), {}), /Draco/);
  await assert.rejects(prepareWith(async () => glb())(new Blob([original]), null), /预览/);
});

test('replacement sends exported bytes through the existing saved-model confirmation contract', async () => {
  const original = glb({ extensionsUsed: ['KHR_draco_mesh_compression'] });
  const ordinary = glb();
  const blob = new Blob([original]);
  const group = {};
  const state = { currentBlob: blob, currentGroup: group, currentModelInfo: { id: 'photo-task', generationMethod: 'texture' }, targetCode: '52' };
  let sent, returned = false;
  const start = source.indexOf('async function replaceOriginalBuilding(');
  const end = source.indexOf('function sendModelAndWaitForSave(', start);
  const replace = vm.runInNewContext(source.slice(start, end) + ';replaceOriginalBuilding', {
    state, els: { sendBtn: {} }, setStatus() {}, console,
    window: { opener: { focus() { returned = true; } }, close() {} },
    crypto: { randomUUID: () => 'save-request' },
    PhotoWorkflow: require('../photo-workflow.js'),
    prepareModelForPlatform: prepareWith(async input => { assert.equal(input, group); return ordinary; }),
    async sendModelAndWaitForSave(message, buffer) { sent = { message, buffer }; }
  });
  await replace();
  assert.equal(sent.buffer, ordinary);
  assert.equal(sent.message.payload.glbBuffer, ordinary);
  assert.equal(sent.message.payload.requestId, 'save-request');
  assert.equal(state.currentBlob, blob);
  assert.deepEqual(await blob.arrayBuffer(), original);
  assert.equal(returned, true);
  assert.equal(state.modelSavePending, false);
});
