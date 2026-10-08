const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('preset UI and bundled preset resources are removed', () => {
  assert.doesNotMatch(html, /预设样式|presetModeBtn|presetSection|normalization_meta/);
  assert.equal(fs.existsSync(path.join(root, 'building_styles')), false);
  assert.equal(fs.existsSync(path.join(root, 'normalization_meta.json')), false);
  assert.match(html, /data-facade-source="local_worker"/);
  assert.match(html, /data-facade-source="external_prompt"/);
  assert.match(html, /data-facade-source="cloud_api"/);
});
