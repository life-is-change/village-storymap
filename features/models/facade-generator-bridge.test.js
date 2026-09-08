const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'app-3d.js'), 'utf8');
const photoBridge = require(path.join(root, 'rural_house_generator', 'photo-material-bridge.js'));

test('3d bridge sends authenticated facade context without privileged credentials', () => {
  assert.match(source, /id:\s*String\(item\?\.id/);
  assert.match(source, /village-house-generator:facade-context/);
  assert.doesNotMatch(source, /service.role|SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY/i);
  assert.match(source, /event\.origin[\s\S]*window\.location\.origin/);
  assert.match(source, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(source, /access_token|refresh_token/);
});

test('photo identity survives newest-first bridge normalization', () => {
  const photos = photoBridge.normalizePhotoMaterials([
    { id: 7, photo_url: 'https://example.test/old.jpg', uploaded_at: '2026-01-01T00:00:00Z' },
    { id: 42, photo_url: 'https://example.test/new.jpg', uploaded_at: '2026-02-01T00:00:00Z' }
  ]);
  assert.deepEqual(photos.map((item) => item.id), ['42', '7']);
});

test('bridge returns photo path availability while queue submission stays id based', () => {
  assert.match(source, /hasPhotoPath:\s*Boolean\(item\?\.photo_path\)/);
  const generator = fs.readFileSync(path.join(root, 'rural_house_generator', 'app.js'), 'utf8');
  assert.match(generator, /photoId:\s*Number\(photo\.id\)/);
  assert.doesNotMatch(generator, /photoUrl:\s*photo\.url/);
});
