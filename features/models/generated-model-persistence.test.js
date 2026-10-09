const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../app-3d.js'), 'utf8');
const group = require('./group-model-library');
const { runBoundedTasks } = require('../data/effective-building-features');
const handlerSource = source.slice(source.indexOf('  async function handleHouseGeneratorModelMessage('), source.indexOf('  async function fetchHouseGeneratorPhotoMaterials('));
const restoreSource = source.slice(source.indexOf('  async function applyCurrent3DSpaceToScene('), source.indexOf('  const loadBuildings =', source.indexOf('  async function applyCurrent3DSpaceToScene(')));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ failPlacement = false, gate = Promise.resolve() } = {}) {
  const assets = new Map(), bindings = new Map(), acknowledgements = [], renders = [], runtime = new Map();
  const scope = { kind: 'shared', ownerId: 'owner', spaceId: 'S', courseId: 'C' };
  const library = {
    async uploadAsset({ file, name }) {
      assert.equal(file.type, 'model/gltf-binary');
      assert.ok(file.size > 0); assert.match(file.name, /\.glb$/);
      const asset = { id: 'asset', name, storage_path: 'shared/S/asset.glb', file };
      assets.set(asset.id, asset); return asset;
    },
    async createSignedUrl(asset) { return 'https://storage.test/' + asset.storage_path + '?fresh-signature'; },
    async placeAsset({ assetId, spaceId, objectCode, transform }) {
      await gate;
      if (failPlacement) throw new Error('binding denied');
      bindings.set(objectCode, { asset_id: assetId, space_id: spaceId, object_code: objectCode, transform,
        group_model_assets: assets.get(assetId) });
    },
    async listBindings(spaceId) { return [...bindings.values()].filter(row => row.space_id === spaceId); }
  };
  const entity = { __sourceCode: '52' };
  const sandbox = {
    window: { location: { origin: 'http://localhost' }, GroupModelLibraryModule: group,
      EffectiveBuildingFeaturesModule: { runBoundedTasks } },
    HOUSE_GENERATOR_MESSAGE_TYPE: 'village-house-generator:model-ready', HOUSE_GENERATOR_DEFAULT_SCALE: 10,
    activeEntity: null, currentSelectedEntityCode: '52', entityMap: new Map([['52', entity]]),
    entityInfoRevision: 0, ArrayBuffer, Blob, File, URL, console,
    getActualLinkedSpaceIdFor3D: () => sandbox.space, space: 'S',
    get3DEditPolicy: () => ({ canEditModel: true }), getCurrentModelLibraryScope: () => scope,
    getGroupModelLibrary: () => library, normalizeCode: value => String(value || ''),
    clampNumber: (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback,
    toBooleanFlag: (value, fallback) => value === undefined ? fallback : value === true || value === '1',
    setRuntimeGeneratedModelState: (space, code, state) => runtime.set(space + ':' + code, state),
    applyModelStateToEntity: async (_, row) => renders.push(row), showEntityInfo: async () => {}, byId: () => null,
    viewer: { scene: { requestRender() {} } }, resetSceneToBaseHeights() {},
    fetchCurrentSpaceAllEdits: async () => [], applyRuntimeGeneratedModelsForSpace: async () => {}, update3DStatusText() {},
    saveSingle3DEdit: async (_, row) => { assert.ok(!String(row.modelUrl).startsWith('blob:')); }
  };
  const event = { origin: 'http://localhost', source: { postMessage: reply => acknowledgements.push(reply) },
    data: { type: sandbox.HOUSE_GENERATOR_MESSAGE_TYPE, payload: { requestId: 'request', sourceCode: '52',
      spaceId: 'S', presetId: 'photo-run', glbBuffer: new ArrayBuffer(24), modelScale: 10,
      modelMetrics: { totalHeight: 8, length: 16.7, width: 11 } } } };
  const handle = vm.runInNewContext(handlerSource + ';handleHouseGeneratorModelMessage', sandbox);
  return { sandbox, event, handle, assets, bindings, acknowledgements, renders, runtime, library };
}
test('generated GLB and building binding survive discarding all in-memory generated states', async () => {
  const f = fixture(); await f.handle(f.event);
  assert.equal(f.assets.size, 1);
  assert.equal(f.bindings.size, 1);
  assert.equal(f.acknowledgements[0].payload.saved, true);
  f.runtime.clear(); f.renders.length = 0;
  // Fresh restoration reads only durable bindings and signs the storage path again.
  await vm.runInNewContext(restoreSource + ';applyCurrent3DSpaceToScene', f.sandbox)();
  assert.equal(f.renders.length, 1);
  assert.equal(f.renders[0].modelAssetId, 'asset');
  assert.match(f.renders[0].modelUrl, /fresh-signature/);
  assert.equal(Number(f.renders[0].modelExpectedHeight), 8);
  assert.equal(Number(f.renders[0].modelExpectedLength), 16.7);
});
test('save acknowledgement waits for building binding rather than acknowledging a memory preview', async () => {
  let release; const gate = new Promise(resolve => release = resolve);
  const f = fixture({ gate }); const pending = f.handle(f.event); await tick();
  assert.equal(f.acknowledgements.length, 0);
  assert.equal(f.renders.length, 0);
  release(); await pending;
  assert.equal(f.acknowledgements[0].payload.saved, true);
});
test('binding failure is returned to the generator without claiming the model was saved', async () => {
  const f = fixture({ failPlacement: true }); await f.handle(f.event);
  assert.equal(f.bindings.size, 0);
  assert.equal(f.acknowledgements[0].payload.saved, false);
  assert.match(f.acknowledgements[0].payload.error, /binding denied/);
  assert.equal(f.renders.length, 0);
});
test('a generator for another space cannot silently place its model in the active space', async () => {
  const f = fixture(); f.event.data.payload.spaceId = 'old-space'; await f.handle(f.event);
  assert.equal(f.assets.size, 0);
  assert.equal(f.acknowledgements[0].payload.saved, false);
});

test('after a cold reload the transform editor resolves the saved binding without a legacy edit row', async () => {
  const f = fixture(); await f.handle(f.event); f.runtime.clear();
  f.sandbox.currentLibraryBinding = f.bindings.get('52');
  f.sandbox.entity = { __sourceCode: '52' }; f.sandbox.baseRow = {};
  f.sandbox.fetchSingle3DEdit = async () => null;
  f.sandbox.getRuntimeGeneratedModelState = () => null;
  f.sandbox.mergeRow = (a,b) => ({ ...a, ...b });
  const first = source.indexOf('    const getCurrentMergedRow = async () => {');
  const read = vm.runInNewContext(source.slice(first, source.indexOf('    const pushCurrentTransform =', first)) + ';getCurrentMergedRow', f.sandbox);
  const { mergedRow } = await read();
  assert.equal(mergedRow.modelAssetId, 'asset');
  assert.match(mergedRow.modelUrl, /fresh-signature/);
  assert.equal(Number(mergedRow.modelExpectedLength), 16.7);
});

test('editing a saved generated model updates its warm preview state as well as the durable transform', async () => {
  const f = fixture(); await f.handle(f.event);
  const runtimeState = f.runtime.get('S:52');
  Object.assign(f.sandbox, { entity: { __sourceCode: '52' }, currentLibraryBinding: f.bindings.get('52'),
    applyTimer: 0, statusEl: {}, getCurrentMergedRow: async () => ({ linkedSpaceId: 'S', runtimeState, mergedRow: runtimeState }),
    getModelStateFromRow: row => row,
    buildModelPayloadPatchFromExistingState: (row, values) => ({ ...row, ...values }),
    readModelTransformInputs: () => ({ modelHeading: '90' }), clearTimeout });
  const first = source.indexOf('    const pushCurrentTransform = async (options = {}) => {');
  const adjust = vm.runInNewContext(source.slice(first, source.indexOf('    const autoFitStretchAndRotationSafe =', first)) + ';pushCurrentTransform', f.sandbox);
  await adjust({ immediate: true });
  assert.equal(f.bindings.get('52').transform.heading, '90');
  assert.equal(f.runtime.get('S:52').modelHeading, '90');
  assert.equal(f.bindings.get('52').transform.expectedHeight, 8);
});
