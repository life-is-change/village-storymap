const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
const choose = app.slice(app.indexOf('function chooseSceneStudioFile('), app.indexOf('let sceneStudioTopViewThumbnailer', app.indexOf('function chooseSceneStudioFile(')));
const upload = app.slice(app.indexOf('async function uploadSceneStudioAsset('), app.indexOf('async function captureSceneStudioPreview(', app.indexOf('async function uploadSceneStudioAsset(')));
const app3d = fs.readFileSync(path.join(__dirname, '../../app-3d.js'), 'utf8');

test('scene studio requests one GLB and passes that file to automatic variant preparation', async () => {
  const file = { name: 'student-house.glb', size: 100 };
  let input, uploadOptions;
  const messages = [], callbacks = {};
  const context = { console, document: { createElement: () => (input = { multiple: false, files: [file],
    addEventListener: (name, callback) => callbacks[name] = callback, click: () => callbacks.change() }) },
    supabaseClient: { storage: { from: () => ({}) } },
    customPrompt: async (_, value) => value,
    generateSceneStudioTopView: async () => ({ ok: false, message: 'test fallback' }),
    showToast: (message) => messages.push(message),
  };
  vm.createContext(context);
  vm.runInContext(choose + upload + ';this.upload=uploadSceneStudioAsset;', context);
  const assetLibrary = { createAssetLibrary: () => ({ upload: async (selected, options) => {
    assert.equal(selected, file); uploadOptions = options; return { ok: true, data: { id: 'asset' } };
  } }), toCatalogAsset: data => data };
  const result = await context.upload({ assetLibrary, client: {}, context: { scopeKind: 'group', groupId: 'g', courseId: 'c', userId: 'u' } });
  assert.equal(result.ok, true);
  assert.equal(input.multiple, false, 'Students select one source model');
  assert.equal(Object.hasOwn(uploadOptions, 'lowFile'), false, 'A second low GLB is not required by the UI');
  assert.ok(messages.some(message => /自动.*轻量|轻量.*自动/.test(message)), 'The UI explains automatic preparation');
});

test('ordinary building uploader sends a single source file and displays automatic preparation', async () => {
  const file = { name: 'house.glb' }, uploadStatus = {}, uploadBtn = {}, uploadInput = { files: [file] };
  let received, saved;
  const metadata = { normalized: true, size: [18, 9, 12], lowStoragePath: 'models/house-low.glb' };
  const first = app3d.indexOf('    if (uploadBtn) {', app3d.indexOf('    const uploadInput = byId("groupModelUploadInput");'));
  const body = app3d.slice(first, app3d.indexOf('    const refreshLibraryBtn =', first));
  const context = { uploadBtn, uploadInput, uploadStatus, console, statusEl: {}, entity: { __sourceCode: '52' },
    window: { GroupModelLibraryModule: { uploadAndPlaceModel: async (options) => {
      received = options;
      assert.match(uploadStatus.textContent, /自动.*轻量/);
      return { asset: { id: 'new', name: 'house', storage_path: 'models/house-high.glb', normalization: metadata }, signedUrl: 'signed-high' };
    } } },
    getCurrentMergedRow: async () => ({ linkedSpaceId: 'S', mergedRow: {} }),
    readModelTransformInputs: () => ({}), getGroupModelLibrary: () => ({}),
    getCurrentModelLibraryScope: () => ({ spaceId: 'S' }), getActualLinkedSpaceIdFor3D: () => 'S',
    byId: (id) => id === 'groupModelUnitSelect' ? { value: '1' } : { files: [{ name: 'unused-manual-low.glb' }] },
    buildModelPayloadPatchFromPreset: (id, row, values) => ({ ...row, ...values, modelAssetId: id }),
    clearRuntimeGeneratedModelState() {}, saveSingle3DEdit: async (_, payload) => { saved = payload; },
    applyModelStateToEntity: async () => {}, showEntityInfo: async () => {},
  };
  vm.runInNewContext(body, context);
  await uploadBtn.onclick();
  assert.equal(received.file, file);
  assert.equal(Object.hasOwn(received, 'lowFile'), false);
  assert.equal(saved.modelNormalized, true);
  assert.equal(saved.modelLowStoragePath, metadata.lowStoragePath);
  assert.deepEqual([saved.modelExpectedLength, saved.modelExpectedHeight, saved.modelExpectedWidth], metadata.size);
  assert.match(uploadStatus.textContent, /轻量版本已自动/);
  const cardFirst = app3d.indexOf('  function buildModelReplaceCardHtmlV3(');
  const cardSource = app3d.slice(cardFirst, app3d.indexOf('  function collect3DFormData(', cardFirst));
  const render = vm.runInNewContext(cardSource + ';buildModelReplaceCardHtmlV3', {
    getModelStateFromRow: row => row, currentLibraryAssets: [], currentLibraryBinding: null,
    escapeHtml: value => value, showReplacementBase: false, showReplacementAnchor: false,
  });
  const html = render({}, true);
  assert.equal((html.match(/type="file"/g) || []).length, 1);
  assert.match(html, /自动准备轻量版本/);
});
