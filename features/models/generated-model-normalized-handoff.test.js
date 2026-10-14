const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../app-3d.js'), 'utf8');
const group = require('./group-model-library');
const { runBoundedTasks } = require('../data/effective-building-features');
const handler = source.slice(source.indexOf('  async function handleHouseGeneratorModelMessage('), source.indexOf('  async function fetchHouseGeneratorPhotoMaterials('));
const restore = source.slice(source.indexOf('  async function applyCurrent3DSpaceToScene('), source.indexOf('  const loadBuildings =', source.indexOf('  async function applyCurrent3DSpaceToScene(')));

test('normalized facade warm render and a fresh group viewer restore share anchor, actual dimensions and low storage path', async () => {
  const metadata = { normalized: true, size: [18, 9, 12], lowStoragePath: 'shared/S/generated-low.glb' };
  const asset = { id: 'generated', name: 'facade', storage_path: 'shared/S/generated-high.glb', normalization: metadata };
  const bindings = [], warm = [], cold = [];
  const scope = { kind: 'shared', ownerId: 'group', spaceId: 'S' };
  const library = {
    uploadAsset: async () => asset,
    createSignedUrl: async (item) => `https://storage.test/${item.storage_path}?fresh`,
    placeAsset: async ({ assetId, spaceId, objectCode, transform }) => bindings.push({ asset_id: assetId, space_id: spaceId, object_code: objectCode, transform, group_model_assets: asset }),
    listBindings: async () => bindings,
  };
  const entity = { __sourceCode: '52' };
  const replies = [];
  const context = {
    window: { location: { origin: 'http://localhost' }, GroupModelLibraryModule: group, EffectiveBuildingFeaturesModule: { runBoundedTasks } },
    HOUSE_GENERATOR_MESSAGE_TYPE: 'village-house-generator:model-ready', HOUSE_GENERATOR_DEFAULT_SCALE: 10,
    ArrayBuffer, File, console, activeEntity: null, currentSelectedEntityCode: '52', entityInfoRevision: 0,
    entityMap: new Map([['52', entity]]), getActualLinkedSpaceIdFor3D: () => 'S',
    get3DEditPolicy: () => ({ canEditModel: true }), getCurrentModelLibraryScope: () => scope,
    getGroupModelLibrary: () => library, normalizeCode: value => String(value || ''),
    clampNumber: (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback,
    toBooleanFlag: (value, fallback) => value === undefined ? fallback : value === true || value === '1',
    setRuntimeGeneratedModelState: (_, __, state) => warm.push(state), applyModelStateToEntity: async () => {},
    viewer: { scene: { requestRender() {} } }, resetSceneToBaseHeights() {},
    fetchCurrentSpaceAllEdits: async () => [], applyRuntimeGeneratedModelsForSpace: async () => {}, update3DStatusText() {},
  };
  const event = { origin: 'http://localhost', source: { postMessage: response => replies.push(response) }, data: {
    type: context.HOUSE_GENERATOR_MESSAGE_TYPE, payload: { sourceCode: '52', spaceId: 'S', glbBuffer: new ArrayBuffer(24), modelScale: 20,
      modelSnapToBase: false, modelMetrics: { length: 16.7, totalHeight: 8, width: 11 } },
  } };
  await vm.runInNewContext(handler + ';handleHouseGeneratorModelMessage', context)(event);
  assert.equal(replies[0].payload.saved, true);
  assert.equal(warm[0].modelNormalized, true);
  assert.equal(warm[0].modelLowStoragePath, metadata.lowStoragePath);
  assert.equal(warm[0].modelSnapToBase, '1');
  assert.equal(Number(warm[0].modelScale), 20, 'Explicit generated scale remains part of the placement');
  assert.deepEqual([warm[0].modelExpectedLength, warm[0].modelExpectedHeight, warm[0].modelExpectedWidth].map(Number), metadata.size);
  // A different viewer has no runtime state: restoration uses only the durable group binding.
  const groupViewer = { ...context, setRuntimeGeneratedModelState: () => assert.fail('No generated runtime state exists in the other viewer'),
    applyModelStateToEntity: async (_, state) => cold.push(state) };
  await vm.runInNewContext(restore + ';applyCurrent3DSpaceToScene', groupViewer)();
  assert.equal(cold.length, 1);
  for (const key of ['modelNormalized', 'modelLowStoragePath', 'modelSnapToBase']) assert.equal(cold[0][key], warm[0][key]);
  for (const key of ['modelScale', 'modelExpectedLength', 'modelExpectedHeight', 'modelExpectedWidth']) assert.equal(Number(cold[0][key]), Number(warm[0][key]));
});
