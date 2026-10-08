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

test('reality render quality favors sharp tiles without exceeding 2x DPR', () => {
  assert.deepEqual(getRealityRenderQuality(2.5), {
    resolutionScale: 2,
    tilesetOptions: {
      maximumScreenSpaceError: 4,
      dynamicScreenSpaceError: false,
      cacheBytes: 256 * 1024 * 1024,
      preloadFlightDestinations: true
    }
  });
  assert.equal(getRealityRenderQuality(1.25).resolutionScale, 1.25);
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
