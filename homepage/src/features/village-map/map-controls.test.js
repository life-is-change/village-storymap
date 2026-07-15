import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAP_CONTROL_LAYOUT,
  returnToHomeRegion,
  toggleMapFullscreen,
  zoomMap,
} from './map-controls.js';

test('keeps fullscreen separate from the lower-right navigation controls', () => {
  assert.match(MAP_CONTROL_LAYOUT.fullscreen, /top-4/);
  assert.match(MAP_CONTROL_LAYOUT.navigation, /bottom-4/);
  assert.match(MAP_CONTROL_LAYOUT.navigation, /flex-col/);
  assert.match(MAP_CONTROL_LAYOUT.fullscreen, /z-\[1000\]/);
});

test('zooms an available map in the requested direction', () => {
  const calls = [];
  const map = { zoomIn: () => calls.push('in'), zoomOut: () => calls.push('out') };

  zoomMap(map, 'in');
  zoomMap(map, 'out');

  assert.deepEqual(calls, ['in', 'out']);
});

test('returns an available map to the supplied home region', () => {
  const calls = [];
  const map = { centerAndZoom: (point, zoom) => calls.push([point, zoom]) };
  const homeRegion = { longitude: 113.397, latitude: 23.055, zoom: 15 };
  const createPoint = (longitude, latitude) => ({ longitude, latitude });

  returnToHomeRegion(map, homeRegion, createPoint);

  assert.deepEqual(calls, [[{ longitude: 113.397, latitude: 23.055 }, 15]]);
});

test('requests fullscreen when the map host is not fullscreen', async () => {
  let requested = false;
  const originalDocument = globalThis.document;
  globalThis.document = { fullscreenElement: null };

  await toggleMapFullscreen({ requestFullscreen: async () => { requested = true; } });

  globalThis.document = originalDocument;
  assert.equal(requested, true);
});
