const test = require('node:test');
const assert = require('node:assert/strict');
const mode = require('./facade-source-mode.js');

test('normalizes the three facade sources and falls back to the workstation', () => {
  assert.equal(mode.normalizeSource('local_worker'), 'local_worker');
  assert.equal(mode.normalizeSource('external_prompt'), 'external_prompt');
  assert.equal(mode.normalizeSource('cloud_api'), 'cloud_api');
  assert.equal(mode.normalizeSource('preset'), 'local_worker');
});

test('cloud source is disabled until the server reports availability', () => {
  assert.equal(mode.canSubmit('cloud_api', { available: false }), false);
  assert.equal(mode.canSubmit('cloud_api', { available: true }), true);
  assert.match(mode.cloudUnavailableMessage({ available: false }), /管理员尚未配置/);
});
