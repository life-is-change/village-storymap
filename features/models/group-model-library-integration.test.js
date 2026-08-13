const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('3D integration loads the group model library and no longer exposes preset or assembler actions', () => {
  const app3d = fs.readFileSync(path.join(root, 'app-3d.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(app, /features\/models\/group-model-library\.js/);
  assert.match(app3d, /GroupModelLibraryModule/);
  assert.match(app3d, /groupModelUploadInput/);
  assert.match(app3d, /应用模型/);
  assert.match(app3d, /删除模型/);
  assert.doesNotMatch(app3d, /MODEL_PRESETS/);
  assert.doesNotMatch(app3d, /openBuildingAssemblerForEntity/);
  assert.doesNotMatch(app3d, /openBuildingAssemblerBtn/);
  assert.doesNotMatch(app3d, /组装模型/);
});

test('legacy assembler artifacts are absent while the photo generator remains available', () => {
  assert.equal(fs.existsSync(path.join(root, 'building-assembler')), false);
  assert.equal(fs.existsSync(path.join(root, 'building-assembler.zip')), false);
  assert.equal(fs.existsSync(path.join(root, 'rural_house_generator', 'index.html')), true);
});

test('model library uses a compact file picker that fits a narrow information panel', () => {
  const app3d = fs.readFileSync(path.join(root, 'app-3d.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(app3d, /class="group-model-file-picker"/);
  assert.match(app3d, /for="groupModelUploadInput"/);
  assert.match(app3d, /id="groupModelSelectedFileName"/);
  assert.match(app3d, /id="groupModelUploadStatus"/);
  assert.match(app3d, /class="model-library-toolbar"/);
  assert.match(css, /\.group-model-file-input\s*\{[^}]*position:\s*absolute/i);
  assert.match(css, /\.group-model-upload-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/i);
  assert.match(css, /\.model-action-grid\s*\{[^}]*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\)/i);
  assert.match(css, /\.upload-btn:disabled\s*\{[^}]*cursor:\s*not-allowed/i);
  assert.doesNotMatch(css, /\.group-model-upload-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto/i);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.model-action-grid\s*,[\s\S]*?grid-template-columns:\s*1fr/i);
});

test('model cards stay readable without horizontal scrolling in the narrow information panel', () => {
  const app3d = fs.readFileSync(path.join(root, 'app-3d.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(app3d, /class="group-model-card-status"[^>]*>使用中</);
  assert.match(app3d, /class="group-model-card-size"/);
  assert.match(app3d, /aria-label="删除模型/);
  assert.match(css, /\.group-model-library-list\s*\{[^}]*overflow-x:\s*hidden/i);
  assert.match(css, /\.group-model-card-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/i);
  assert.match(css, /\.group-model-card-copy strong\s*\{[^}]*overflow-wrap:\s*anywhere/i);
  assert.match(css, /\.group-model-card-copy strong\s*\{[^}]*-webkit-line-clamp:\s*2/i);
});
