const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('roaming runtime is completely removed while core 3D controls remain', () => {
  const app = read('app.js');
  const app3d = read('app-3d.js');
  const html = read('index.html');
  const css = read('style.css');
  const entrypoints = read('ENTRYPOINTS.md');
  const roamingFiles = [
    'features/first-person/first-person-controller.js',
    'features/drone/drone-controller.js',
    'features/drone/assets/animated-drone.glb',
    'features/DJIA.glb'
  ];

  assert.doesNotMatch(app, /first-person-controller|drone-controller/);
  assert.doesNotMatch(
    app3d,
    /VillageFirstPersonModule|VillageDroneModule|toggleFirstPersonMode|toggleDroneMode/
  );
  assert.doesNotMatch(html, /firstPerson3dBtn|drone3dBtn/);
  assert.doesNotMatch(css, /#firstPerson3dBtn|#drone3dBtn|\.map-drone-btn/);
  assert.doesNotMatch(entrypoints, /first-person|drone scripts/i);
  assert.match(app3d, /toggleMeasureMode/);
  assert.match(app3d, /function recenter\(/);

  roamingFiles.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  });
});

test('3D view exposes the configured reality-model inset and its accessible controls', () => {
  const app = read('app.js');
  const app3d = read('app-3d.js');
  const html = read('index.html');
  const css = read('style.css');

  assert.match(html, /window\.VILLAGE_REALITY_MODEL\s*=\s*\{/);
  assert.match(html, /ionAssetId:\s*5133927/);
  assert.match(html, /id="reality3dPanel"/);
  assert.match(html, /id="reality3dTitlebar"/);
  assert.match(html, /id="reality3dContainer"/);
  assert.match(html, /id="reality3dStatus"/);
  assert.match(html, /id="reality3dExpandBtn"[^>]*aria-label="放大实景窗口"/);
  assert.match(html, /id="reality3dResizeHandle"[^>]*aria-label="调整实景窗口大小"/);
  assert.match(html, /id="reality3dFullscreenBtn"[^>]*aria-label="实景模型全屏"/);
  assert.match(html, /id="reality3dResetBtn"[^>]*aria-label="重置实景视角"/);
  assert.match(html, /id="reality3dTerrainBtn"[^>]*aria-label="切换实景地形"/);
  assert.match(html, /id="reality3dCloseBtn"[^>]*aria-label="关闭实景窗口"/);
  assert.match(html, /id="reality3dToggleBtn"[^>]*aria-label="显示实景模型"/);
  assert.match(css, /\.reality-3d-panel\s*\{/);
  assert.match(css, /\.reality-3d-panel\.is-fullscreen/);
  assert.match(css, /\.reality-3d-panel\.is-expanded/);
  assert.match(css, /\.reality-3d-panel\.is-hidden/);
  assert.match(css, /\.reality-3d-resize-handle/);
  assert.match(app, /features\/3d\/reality-inset\.js/);
  assert.match(app3d, /expandButton:\s*byId\("reality3dExpandBtn"\)/);
  assert.match(app3d, /resizeHandle:\s*byId\("reality3dResizeHandle"\)/);
});

test('main and reality viewers synchronize building proxies and selection by code', () => {
  const app3d = read('app-3d.js');

  assert.match(app3d, /VillageRealityInsetModule/);
  assert.match(app3d, /function ensureRealityInsetController\(/);
  assert.match(app3d, /function buildRealityProxyRecords\(/);
  assert.match(app3d, /const center = getEntityCenterCartographic\(entity\)/);
  assert.match(app3d, /longitude:\s*center\.longitude/);
  assert.match(app3d, /latitude:\s*center\.latitude/);
  assert.match(app3d, /horizontalRadius:/);
  assert.match(app3d, /syncBuildingProxies\(buildRealityProxyRecords\(\)\)/);
  assert.match(app3d, /focusBuilding\(entity\.__sourceCode\)/);
  assert.match(app3d, /async function selectMainBuildingFromReality\(sourceCode\)/);
  assert.match(app3d, /realityInsetController\.destroy\(\)/);
});

test('reality inset has terrain fallback and local photogrammetry stays outside Git', () => {
  const app3d = read('app-3d.js');
  const inset = read('features/3d/reality-inset.js');
  const gitignore = read('.gitignore');

  assert.match(gitignore, /^terra_b3dms\.zip$/m);
  assert.match(gitignore, /^terra_b3dms\/$/m);
  assert.match(inset, /EllipsoidTerrainProvider/);
  assert.match(inset, /requestRenderMode\s*=\s*true/);
  assert.match(inset, /createWorldTerrainAsync/);
  assert.match(inset, /function destroy\(\)/);
  assert.match(app3d, /realityInsetController\.destroy\(\)/);
});
