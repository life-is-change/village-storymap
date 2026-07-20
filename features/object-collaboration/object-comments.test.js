const test = require('node:test');
const assert = require('node:assert/strict');
const comments = require('./object-comments.js');

test('object comment likes toggle without duplicates', () => {
  assert.deepEqual(comments.toggleLike({ likes: ['学生A', '学生A'] }, '学生B').likes, ['学生A', '学生B']);
  assert.deepEqual(comments.toggleLike({ likes: ['学生A'] }, '学生A').likes, []);
});

test('object comment replies preserve author time and content', () => {
  const result = comments.appendReply({}, '学生A', '需要复核建筑边界', '2026-07-20T00:00:00.000Z');
  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].author, '学生A');
  assert.equal(result.replies[0].content, '需要复核建筑边界');
  assert.equal(result.replies[0].created_at, '2026-07-20T00:00:00.000Z');
});
