const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeConfig,
  clampPanelPosition,
  clampPanelSize,
  calculatePanelResize,
  getRealityRenderQuality,
  shouldCreateTerrainProvider,
  resolveImmediateSurfaceHeight,
  resolveRealityTargetHeight,
  getRealityCloseupCamera,
  normalizeBuildingCode,
  createFocusRequestGate,
  findProxyCodeFromPicks,
  createController
} = require('./reality-inset.js');

test('normalizeConfig accepts a village resource and safe defaults', () => {
  assert.deepEqual(normalizeConfig({ ionAssetId: 5133927, revision: 'v0' }), {
    enabled: true,
    ionAssetId: 5133927,
    title: '村庄实景模型',
    terrainEnabled: true,
    heightOffset: 0,
    revision: 'v0'
  });
});

test('normalizeConfig rejects an invalid asset identifier', () => {
  assert.equal(normalizeConfig({ ionAssetId: 'not-a-number' }).enabled, false);
  assert.equal(normalizeConfig({ ionAssetId: 'not-a-number' }).ionAssetId, 0);
});

test('clampPanelPosition keeps a dragged panel inside the host', () => {
  assert.deepEqual(
    clampPanelPosition(
      { x: 900, y: -30 },
      { width: 320, height: 220 },
      { width: 1000, height: 700 }
    ),
    { x: 680, y: 0 }
  );
});

test('clampPanelSize enforces the minimum and host boundary', () => {
  assert.deepEqual(
    clampPanelSize({ width: 200, height: 900 }, { width: 1000, height: 700 }),
    { width: 360, height: 700 }
  );
});

test('calculatePanelResize keeps the top-left anchor while growing to the pointer', () => {
  assert.deepEqual(
    calculatePanelResize(
      {
        pointerX: 700,
        pointerY: 400,
        width: 400,
        height: 300,
        left: 300,
        top: 20,
        hostWidth: 1000,
        hostHeight: 700
      },
      { x: 800, y: 450 }
    ),
    { left: 300, top: 20, width: 500, height: 350 }
  );
});

test('balanced inset quality caps pixels and reduces tile pressure on the main view', () => {
  assert.deepEqual(getRealityRenderQuality(2.5), {
    resolutionScale: 1,
    tilesetOptions: {
      maximumScreenSpaceError: 8,
      dynamicScreenSpaceError: true,
      cacheBytes: 256 * 1024 * 1024,
      preloadFlightDestinations: false
    }
  });
  assert.equal(getRealityRenderQuality(1.25).resolutionScale, 1);
  assert.equal(getRealityRenderQuality(2, 'sharp').resolutionScale, 2);
  assert.equal(getRealityRenderQuality(2, 'sharp').tilesetOptions.maximumScreenSpaceError, 4);
});

test('low inset quality halves the balanced tile cache and reduces pixel work', () => {
  const quality = getRealityRenderQuality(3, 'low');
  assert.equal(quality.resolutionScale, 0.75);
  assert.equal(quality.tilesetOptions.maximumScreenSpaceError, 16);
  assert.equal(quality.tilesetOptions.cacheBytes, 128 * 1024 * 1024);
  assert.equal(quality.tilesetOptions.preloadFlightDestinations, false);
});

test('inset uses the saved local render profile when callers omit a mode', () => {
  const vm = require('node:vm');
  const root = { RenderQualityModule: { getProfile: () => ({ mode: 'low', inset: {
    resolutionScale: 0.75, maximumScreenSpaceError: 16,
    dynamicScreenSpaceError: true, cacheBytes: 128 * 1024 * 1024,
    preloadFlightDestinations: false
  } }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'reality-inset.js'), 'utf8'), { window: root });
  assert.equal(root.VillageRealityInsetModule.getRealityRenderQuality(2).resolutionScale, 0.75);
});

test('building focus uses cached or already-rendered height without waiting for maximum LOD', () => {
  assert.equal(resolveImmediateSurfaceHeight(128, 126), 128);
  assert.equal(resolveImmediateSurfaceHeight(undefined, 126), 126);
  assert.equal(resolveImmediateSurfaceHeight(null, null), undefined);
  assert.equal(resolveImmediateSurfaceHeight(undefined, undefined), undefined);
});

test('world terrain provider is created only when enabled and not already ready', () => {
  assert.equal(shouldCreateTerrainProvider(true, false), true);
  assert.equal(shouldCreateTerrainProvider(true, true), false);
  assert.equal(shouldCreateTerrainProvider(false, false), false);
});

test('sampled roof height produces a target inside the upper building volume', () => {
  assert.deepEqual(
    resolveRealityTargetHeight(128, 100, 12),
    { height: 123.8, sampled: true }
  );
});

test('missing scene height falls back above the building base', () => {
  assert.deepEqual(
    resolveRealityTargetHeight(undefined, 100, 12),
    { height: 107.8, sampled: false }
  );
});

test('closeup camera frames a house from a safe oblique range', () => {
  const camera = getRealityCloseupCamera(
    {
      longitude: 1.9,
      latitude: 0.4,
      baseHeight: 100,
      height: 12,
      horizontalRadius: 8
    },
    128,
    0.75
  );

  assert.equal(camera.targetHeight, 123.8);
  assert.equal(camera.heading, 0.75);
  assert.equal(camera.pitch, -Math.PI / 6);
  assert.equal(camera.range, 36);
  assert.equal(camera.radius, 8);
  assert.equal(camera.sampled, true);
});

test('large closeup camera range is capped to keep the building readable', () => {
  assert.equal(
    getRealityCloseupCamera(
      { longitude: 1.9, latitude: 0.4, height: 30, horizontalRadius: 40 },
      150,
      Number.NaN
    ).range,
    90
  );
});

test('normalizeBuildingCode makes proxy lookup stable', () => {
  assert.equal(normalizeBuildingCode(' h-001 '), 'H001');
  assert.equal(normalizeBuildingCode('\uFEFF R 002 '), 'R002');
});

test('a newer focus request supersedes an older request token', () => {
  const gate = createFocusRequestGate();
  const first = gate.next();
  const second = gate.next();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test('proxy picking searches through tileset hits for the transparent building entity', () => {
  assert.equal(
    findProxyCodeFromPicks([
      { primitive: { id: 'photogrammetry-tile' } },
      { id: { __realityProxyCode: ' h-003 ' } }
    ]),
    'H003'
  );
});

test('building focus flies immediately and only then refreshes maximum-detail height cache', () => {
  const source = fs.readFileSync(path.join(__dirname, 'reality-inset.js'), 'utf8');
  assert.match(source, /sampleHeightMostDetailed/);
  assert.match(source, /scene\.sampleHeight\(/);
  assert.match(source, /surfaceHeightCache/);
  assert.match(source, /camera\.flyToBoundingSphere/);
  assert.match(source, /Array\.from\(proxyMap\.values\(\)\)/);
  assert.doesNotMatch(source, /viewer\.flyTo\(entity/);

  const focusStart = source.indexOf('async function focusBuilding');
  const focusEnd = source.indexOf('\n    async function resetView', focusStart);
  const focusSource = source.slice(focusStart, focusEnd);
  assert.ok(focusSource.indexOf('flyToRealityCloseup') >= 0);
  assert.ok(focusSource.indexOf('sampleRealitySurfaceHeight') >= 0);
  assert.ok(
    focusSource.indexOf('flyToRealityCloseup') < focusSource.indexOf('sampleRealitySurfaceHeight'),
    'camera flight must start before maximum-detail sampling'
  );
  assert.doesNotMatch(focusSource, /await\s+sampleRealitySurfaceHeight/);
});

test('terrain stays enabled while terrain depth occlusion is disabled for the reality mesh', () => {
  const source = fs.readFileSync(path.join(__dirname, 'reality-inset.js'), 'utf8');
  assert.match(source, /depthTestAgainstTerrain\s*=\s*false/);
  assert.match(source, /terrainEnabled\s*=\s*config\.terrainEnabled/);
});

test('createController exposes the complete inset lifecycle API', () => {
  const controller = createController({});
  [
    'enter',
    'show',
    'hide',
    'toggle',
    'toggleExpanded',
    'resetView',
    'setTerrainEnabled',
    'syncBuildingProxies',
    'focusBuilding',
    'resize',
    'destroy'
  ].forEach((name) => assert.equal(typeof controller[name], 'function', name));
});

test('a village without a reality model starts hidden and building clicks never reopen it', async () => {
  let hidden = false;
  const panel = { classList: { toggle(name, value) { if (name === 'is-hidden') hidden = value; } } };
  const controller = createController({ panel, config: {} });
  assert.equal(hidden, true);
  assert.equal(await controller.focusBuilding('building-1'), false);
  assert.equal(hidden, true);
  controller.destroy();
});

test('closing an available reality window keeps later building clicks from reopening it', async () => {
  let hidden;
  const panel = { classList: { toggle(name, value) { if (name === 'is-hidden') hidden = value; } } };
  const controller = createController({ panel, config: { ionAssetId: 42 } });
  assert.equal(hidden, false);
  controller.hide();
  assert.equal(await controller.focusBuilding('building-1'), false);
  assert.equal(hidden, true);
  controller.destroy();
});

test('inset updates a loaded tileset after quality changes and pauses while the tab is hidden', async () => {
  const vm = require('node:vm');
  const listeners = new Map();
  let onQualityChange, unsubscribed = false;
  let current = 'balanced';
  let viewer;
  const document = { hidden: false,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name) };
  const moduleSource = fs.readFileSync(path.join(__dirname, 'render-quality.js'), 'utf8');
  const root = { document, devicePixelRatio: 2 };
  vm.runInNewContext(moduleSource, { window: root });
  const getProfile = root.RenderQualityModule.getProfile;
  root.RenderQualityModule = {
    getProfile: () => getProfile(current),
    subscribe(callback) { onQualityChange = callback; return () => { unsubscribed = true; }; }
  };
  const tileset = {};
  const Cesium = { Viewer: function () {
    viewer = this;
    this.scene = { globe: {}, requestRender() {}, primitives: { add: value => value } };
    this.camera = {};
    this.resize = () => {};
    this.flyTo = async () => {};
    this.destroy = () => {};
  }, EllipsoidTerrainProvider: function () {}, Cesium3DTileset: { fromIonAssetId: async () => tileset } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'reality-inset.js'), 'utf8'), { window: root, setTimeout });
  const controller = root.VillageRealityInsetModule.createController({ Cesium, document,
    container: {}, config: { ionAssetId: 42, terrainEnabled: false } });
  await controller.enter();
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(typeof onQualityChange, 'function', 'an open inset must react to mode changes');
  current = 'low'; onQualityChange('low', getProfile('low'));
  assert.equal(viewer.resolutionScale, 0.75);
  assert.equal(tileset.maximumScreenSpaceError, 16);
  assert.equal(tileset.cacheBytes, 128 * 1024 * 1024);
  document.hidden = true; listeners.get('visibilitychange')();
  assert.equal(viewer.useDefaultRenderLoop, false);
  controller.show(); assert.equal(viewer.useDefaultRenderLoop, false);
  document.hidden = false; listeners.get('visibilitychange')();
  assert.equal(viewer.useDefaultRenderLoop, true);
  controller.setHostActive(false); listeners.get('visibilitychange')();
  assert.equal(viewer.useDefaultRenderLoop, false);
  controller.destroy(); assert.equal(unsubscribed, true);
});
