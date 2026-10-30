const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app-3d.js', 'utf8');

test('terrain selection resolves before touching a visible viewer', async () => {
  const start = source.search(/  async function (?:resolvePreferredTerrainProvider|loadPreferredTerrainProviderInBackground)\(/);
  const end = source.indexOf('\n  async function createOpenStreetMapImageryProvider(', start);
  const provider = {}, oldProvider = {}, viewer = { terrainProvider: oldProvider };
  const name = source.slice(start, end).match(/async function (\w+)/)[1];
  const context = { viewer, withTimeout: p => p, ONLINE_RESOURCE_TIMEOUT_MS: 6000,
    createArcGisTerrainProvider: async () => provider, console: { log() {}, warn() {} },
    Cesium: { EllipsoidTerrainProvider: class {} } };
  const result = await vm.runInNewContext(source.slice(start, end) + `;${name}(false)`, context);
  assert.equal(result, provider, 'the chosen provider must be returned for initial Viewer construction');
  assert.equal(viewer.terrainProvider, oldProvider, 'loading must not reset a live globe');
});

test('first building load never pulls an already adjusted camera back to the overview', () => {
  const start = source.indexOf('    if (entities.length', source.indexOf('  async function loadBuildingsNow()'));
  const end = source.indexOf('    await applyTerrainHeights(entities);', start);
  const calls = [], viewer = { flyTo: () => calls.push('fly') };
  const context = { entities: [{}], viewer, buildingsDataSource: {}, isStartupCamera: true,
    startupCameraPending: false, startupCameraCancelled: false, startupCameraFocus: null,
    isCurrentLoad: () => true, is3DViewActive: () => true, getOverviewCameraOffset: () => ({}) };
  vm.runInNewContext(source.slice(start, end), context);
  assert.deepEqual(calls, []);
  context.isStartupCamera = false;
  vm.runInNewContext(source.slice(start, end), context);
  assert.deepEqual(calls, ['fly'], 'an explicit later reload still frames its new village');
});

test('startup cover stays until imagery is attached and the initial globe tiles are rendered', async () => {
  const start = source.indexOf('  function coverInitial3DSurface(');
  assert.ok(start >= 0, 'startup must cover the unready globe rather than show stars');
  const end = source.indexOf('\n  function positionVillageCamera(', start);
  let check, release, removed = 0, detached = 0;
  const imagery = new Promise(resolve => { release = resolve; });
  let surface;
  const scene = { canvas: { clientWidth: 800, clientHeight: 600 },
    globe: { tilesLoaded: true, pick: () => surface }, requestRender() {},
    postRender: { addEventListener(fn) { check = fn; return () => detached++; } } };
  const cover = { remove() { removed++; }, textContent: '' };
  const context = { window: { setTimeout: () => 1, clearTimeout() {} },
    Cesium: { Cartesian2: class {} } };
  const watch = vm.runInNewContext(source.slice(start, end) + ';coverInitial3DSurface', context);
  const cleanup = watch({ scene, camera: { getPickRay: () => ({}) } }, cover, imagery);
  check(); assert.equal(removed, 0, 'an empty initial globe is not readiness');
  scene.globe.tilesLoaded = false; release(); await new Promise(r => setImmediate(r));
  check(); assert.equal(removed, 0, 'terrain tiles must finish after imagery is attached');
  surface = {};
  check(); assert.equal(removed, 1, 'a rendered surface is enough; distant tile requests must not block entry');
  cleanup(); assert.equal(removed, 1); assert.equal(detached, 1);
});

test('concurrent entries resolve terrain once and position the camera before enabling rendering', async () => {
  const start = source.indexOf('  async function initViewer()');
  const end = source.indexOf('\n  async function enter()', start);
  let release, terrainCalls = 0, creations = 0;
  const terrainTask = new Promise(resolve => { release = resolve; });
  const events = [], provider = {};
  const cover = { dataset: {}, style: {}, setAttribute() {}, remove() {} };
  const context = { initialized: false, viewer: null, viewerInitializationTask: null,
    byId: () => ({ querySelector: () => null, appendChild() {} }),
    document: { createElement: () => cover }, hasUsableCesiumIonToken: () => false,
    ionServicesLikelyBlocked: false, console: { warn() {}, error() {} },
    ensureBasemapGeorefResolved: async () => {},
    resolvePreferredTerrainProvider: () => { terrainCalls++; return terrainTask; },
    Cesium: { Viewer: function (_id, options) {
      creations++; assert.equal(options.terrainProvider, provider);
      assert.equal(options.useDefaultRenderLoop, false);
      this.scene = { requestRender() {}, globe: {}, renderError: { addEventListener() {} },
        screenSpaceCameraController: {}, postProcessStages: {} };
      this.camera = { changed: { addEventListener() {} } };
    }, Color: { fromCssColorString: () => ({}) } },
    get3DLoadKey: () => 'village-A', positionVillageCamera: () => events.push('camera'),
    addViewerImageryLayers: async () => {}, window: {},
    PERF_TERRAIN_MAX_SCREEN_SPACE_ERROR: 6, PERF_RESOLUTION_SCALE_CAP: 1,
    bindClickEvents() {}, ensureRealityInsetController() {},
    coverInitial3DSurface: () => () => {}, setRenderActive: () => events.push('render') };
  const init = vm.runInNewContext(source.slice(start, end) + ';initViewer', context);
  const a = init(), b = init();
  assert.equal(creations, 0); assert.equal(terrainCalls, 1);
  release(provider); await Promise.all([a, b]);
  assert.equal(creations, 1); assert.deepEqual(events, ['camera', 'render']);
});
