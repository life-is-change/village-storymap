import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_VILLAGE_ID,
  HOME_REGION,
  VILLAGES,
  getVillageById,
} from './village-data.js';

test('uses 米埗村 as the default village', () => {
  assert.equal(getVillageById(DEFAULT_VILLAGE_ID).name, '米埗村');
});

test('keeps the homepage return location separate from village locations', () => {
  assert.match(HOME_REGION.name, /中山大学/);
  assert.notEqual(HOME_REGION.longitude, VILLAGES[0].longitude);
});

test('provides village-specific status and issue content for homepage practice', () => {
  for (const village of VILLAGES) {
    assert.ok(village.statusItems.length > 0, `${village.name} should provide status items`);
    assert.ok(village.issueItems.length > 0, `${village.name} should provide issue items`);
  }
});
