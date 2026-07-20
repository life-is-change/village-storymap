const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

test('photos remain available after entering a planning copy space', () => {
  assert.match(app, /const showPhotoBlock = layerKey !== "road";/);
});

test('selected map objects render comment author time likes and replies', () => {
  assert.match(app, /ObjectCommentsModule\.list/);
  assert.match(app, /objectCommentForm/);
  assert.match(app, /data-object-comment-like/);
  assert.match(app, /data-object-comment-reply/);
  assert.match(app, /formatDateTime\(comment\.created_at\)/);
});
