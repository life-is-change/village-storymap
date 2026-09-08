const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;

test('photo material bridge exports the generator message contract', () => {
  const bridge = require('./photo-material-bridge.js');
  assert.equal(bridge.REQUEST_TYPE, 'village-house-generator:request-photo-materials');
  assert.equal(bridge.RESPONSE_TYPE, 'village-house-generator:photo-materials');
  assert.equal(bridge.CONTEXT_TYPE, 'village-house-generator:facade-context');
  assert.equal(bridge.UPLOAD_REQUEST_TYPE, 'village-house-generator:upload-photo');
  assert.equal(bridge.UPLOAD_RESPONSE_TYPE, 'village-house-generator:photo-uploaded');
});

test('normalizes and deduplicates existing building photos newest first', () => {
  const bridge = require('./photo-material-bridge.js');
  const photos = bridge.normalizePhotoMaterials([
    { id: 4, photo_url: ' https://example.test/older.jpg ', uploaded_at: '2026-08-10T08:00:00Z' },
    { id: 7, photo_url: 'https://example.test/newer.png', uploaded_at: '2026-08-11T08:00:00Z', uploaded_by: '管理员' },
    { id: 4, photo_url: 'https://example.test/older.jpg', uploaded_at: '2026-08-10T08:00:00Z' },
    { id: 9, photo_url: '', uploaded_at: '2026-08-12T08:00:00Z' }
  ]);

  assert.deepEqual(photos, [
    {
      id: '7',
      url: 'https://example.test/newer.png',
      hasPhotoPath: false,
      uploadedAt: '2026-08-11T08:00:00Z',
      uploadedBy: '管理员'
    },
    {
      id: '4',
      url: 'https://example.test/older.jpg',
      hasPhotoPath: false,
      uploadedAt: '2026-08-10T08:00:00Z',
      uploadedBy: ''
    }
  ]);
});

test('derives safe supported file metadata from a stored photo', () => {
  const bridge = require('./photo-material-bridge.js');
  assert.deepEqual(
    bridge.getPhotoFileMetadata({ id: '7', url: 'https://example.test/folder/front-view.PNG?token=abc' }, 'image/png'),
    { name: 'front-view.PNG', type: 'image/png' }
  );
  assert.deepEqual(
    bridge.getPhotoFileMetadata({ id: '8', url: 'https://example.test/no-extension' }, ''),
    { name: 'building-photo-8.jpg', type: 'image/jpeg' }
  );
});

test('generator page includes an existing-photo selector before local upload', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const existing = html.indexOf('id="existingPhotoMaterials"');
  const upload = html.indexOf('id="photoInput"');

  assert.ok(existing >= 0, 'existing photo materials container should exist');
  assert.ok(upload > existing, 'existing materials should appear before local upload');
  assert.match(html, /photo-material-bridge\.js\?v=20260812-existing-photos/);
  assert.match(html, /app\.js\?v=20260812-existing-photos/);
});

test('generator requests materials and submits a selected stable photo id', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(source, /requestExistingPhotoMaterials\s*\(/);
  assert.match(source, /PhotoMaterialBridge\.REQUEST_TYPE/);
  assert.match(source, /PhotoMaterialBridge\.RESPONSE_TYPE/);
  assert.match(source, /await\s+submitFacadePhoto\(photo\)/);
});

test('historical photo messages retain stable database ids for queued work', () => {
  const bridge = require('./photo-material-bridge.js');
  const [photo] = bridge.normalizePhotoMaterials([
    { id: 42, photo_url: 'https://example.test/front.jpg', created_at: '2026-08-11T08:00:00Z' }
  ]);

  assert.equal(photo.id, '42');
  assert.equal(bridge.isQueueablePhoto(photo), true);
  assert.equal(bridge.isQueueablePhoto({ id: '', url: 'blob:test' }), false);
});
