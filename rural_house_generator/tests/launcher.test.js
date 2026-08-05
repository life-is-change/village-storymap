const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('facade launcher starts both services and verifies backend health', () => {
  const root = path.resolve(__dirname, '..', '..');
  const ps1 = fs.readFileSync(path.join(root, 'start_facade_generator.ps1'), 'utf8');
  const bat = fs.readFileSync(path.join(root, 'start_facade_generator.bat'), 'utf8');
  assert.match(ps1, /building_facade_pilot[\\/]python\.exe/i);
  assert.match(ps1, /--port['"],\s*['"]8011/);
  assert.match(ps1, /http\.server['"],\s*['"]8000/);
  assert.match(ps1, /127\.0\.0\.1:8011\/health/);
  assert.match(ps1, /WindowStyle\s+Hidden/i);
  assert.match(ps1, /RURAL_FACADE_RUNTIME_ROOT/);
  assert.match(ps1, /LOCALAPPDATA/);
  assert.match(ps1, /health\.runtime_root/);
  assert.match(bat, /start_facade_generator\.ps1/i);
});
