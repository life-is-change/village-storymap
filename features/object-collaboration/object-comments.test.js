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

test('object comments are gated before table mutation and carry the survey layer', async () => {
  const calls = [];
  const deps = {
    commentsTable: 'object_comments',
    editsTable: 'object_attribute_edits',
    getContext: () => ({ teachingProjectId: 'p1', villageId: 'v1', spaceId: 's1' }),
    assertSurveyDownstreamReady: async (target) => calls.push(['gate', target]),
    getClient: () => ({
      from: () => ({
        insert(payload) {
          calls.push(['insert', payload]);
          return { select: () => ({ single: async () => ({ data: { id: 1 }, error: null }) }) };
        }
      })
    })
  };

  await comments.create(deps, {
    objectCode: 'W1', objectType: 'water__s1', layerKey: 'water',
    authorName: '学生甲', content: '水岸边界已核对'
  });
  assert.deepEqual(calls[0], ['gate', { objectCode: 'W1', layerKey: 'water' }]);
  assert.equal(calls[1][1].survey_layer_key, 'water');
});

test('a rejected object comment gate never reaches Supabase', async () => {
  let touched = false;
  const deps = {
    getContext: () => ({ teachingProjectId: 'p1', villageId: 'v1', spaceId: 's1' }),
    assertSurveyDownstreamReady: async () => { throw new Error('GEOMETRY_REVIEW_REQUIRED'); },
    getClient: () => { touched = true; }
  };
  await assert.rejects(() => comments.create(deps, {
    objectCode: 'B1', objectType: 'building__s1', layerKey: 'building',
    authorName: '学生甲', content: '待讨论'
  }), /GEOMETRY_REVIEW_REQUIRED/);
  assert.equal(touched, false);
});
