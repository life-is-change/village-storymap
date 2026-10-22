const test = require("node:test");
const assert = require("node:assert/strict");

const { createObjectCommentDeps } = require("./object-info-deps.js");

test("object panel routes comments through local services without touching the source client", async () => {
  const comments = require('./object-comments.js');
  const calls = [];
  const services = { survey: { execute: async (action, input) => {
    calls.push({ action, input }); return [];
  } } };
  const deps = createObjectCommentDeps({
    services,
    getClient: () => { throw new Error('SOURCE_BUSINESS_DISABLED'); },
    getContext: () => ({ teachingProjectId: 'p1', villageId: 'v1', spaceId: 's1' })
  });
  deps.uuid = () => 'request';
  await comments.list(deps, 'H001', 'building');
  await comments.create(deps, { objectCode: 'H001', objectType: 'building', layerKey: 'building', content: 'test' });
  await comments.like(deps, 1, 'actor');
  await comments.reply(deps, 1, 'actor', 'reply');
  assert.deepEqual(calls.map(c => c.action), ['survey.listComments', 'survey.addComment', 'survey.likeComment', 'survey.replyComment']);
  assert.equal(calls[1].input.surveyLayerKey, 'building');
  assert.equal(calls[1].input.requestId, 'request');
  assert.equal(calls[3].input.spaceId, 's1');
});

test("the actual object panel supplies its local comment services", () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync('app.js', 'utf8');
  const start = source.indexOf('  const objectCommentDeps = ');
  const end = source.indexOf('\n  });', start) + '\n  });'.length;
  const services = { survey: {} };
  const deps = vm.runInNewContext(source.slice(start, end) + ';objectCommentDeps;', {
    window: { ObjectInfoDepsModule: { createObjectCommentDeps }, VillageBusinessServices: services },
    OBJECT_COMMENTS_TABLE: 'object_comments', OBJECT_EDITS_TABLE: 'object_attribute_edits',
    assertSurveyDownstreamReady() {}
  });
  assert.equal(deps.services, services);
});

test("object info supplies the active Supabase client lazily", () => {
  const firstClient = { id: "first" };
  const secondClient = { id: "second" };
  let activeClient = firstClient;

  const deps = createObjectCommentDeps({
    getClient: () => activeClient,
    getContext: () => ({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1" }),
    commentsTable: "object_comments",
    editsTable: "object_edits"
  });

  assert.equal(deps.getClient(), firstClient);
  activeClient = secondClient;
  assert.equal(deps.getClient(), secondClient);
  assert.equal(deps.commentsTable, "object_comments");
  assert.equal(deps.editsTable, "object_edits");
});
