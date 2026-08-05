const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

test('2D bootstrap uses the pinned local OpenLayers build', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /assets\/vendor\/openlayers-10\.8\.0\/ol\.js/);
  assert.match(html, /assets\/vendor\/openlayers-10\.8\.0\/ol\.css/);
  assert.doesNotMatch(html, /esm\.sh\/ol@/);
});

test('fixed basemap bounds do not decode the orthophoto during map startup', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const resolver = source.match(/async function resolveBasemapGeoref\(\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(resolver, /BASEMAP_GEOREF/);
  assert.doesNotMatch(resolver, /tryResolveBasemapGeorefFromWorldFile|loadImageSize/);
});

test('2D switch displays an immediate loading state without a duplicate layer wait', () => {
  const source = fs.readFileSync(path.join(__dirname, 'view-switcher.js'), 'utf8');
  const switcher = source.match(/async switchTo2DView\(deps\)[\s\S]*?\n    },\n\n    async switchTo3DView/)?.[0] || '';
  assert.match(switcher, /setPlanMapLoadingState\?\.\(true/);
  assert.match(switcher, /setPlanMapLoadingState\?\.\(false/);
  assert.doesNotMatch(switcher, /await deps\.ensureSelectedLayersLoaded\(\)/);
});

