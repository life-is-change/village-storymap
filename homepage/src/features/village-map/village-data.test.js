import assert from 'node:assert/strict';
import test from 'node:test';

import * as villageData from './village-data.js';

const {
  DEFAULT_VILLAGE_ID,
  HOME_REGION,
  VILLAGES,
  getVillageById,
  mergeRuntimeVillages,
} = villageData;

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

test('runtime project villages replace the static practice record and add the formal village', () => {
  const runtime = mergeRuntimeVillages([
    {
      id: 'practice-uuid', name: '米埗村', isPractice: true,
      location: '广州市从化区良口镇', longitude: 113.7, latitude: 23.7, zoom: 14,
    },
    {
      id: 'formal-uuid', name: '南溪村', role: 'formal',
      location: '本学期正式规划村庄', longitude: 111, latitude: 21, zoom: 14,
    },
  ]);

  assert.deepEqual(runtime.map((village) => village.id), ['practice-uuid', 'formal-uuid']);
  assert.equal(getVillageById('formal-uuid', runtime).name, '南溪村');
  assert.ok(getVillageById('formal-uuid', runtime).statusItems.length > 0);
  assert.ok(getVillageById('formal-uuid', runtime).issueItems.length > 0);
});

test('empty runtime payload preserves the built-in 米埗村 fallback', () => {
  assert.equal(mergeRuntimeVillages([])[0].name, '米埗村');
});
