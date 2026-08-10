const test = require("node:test");
const assert = require("node:assert/strict");

const { createObjectCommentDeps } = require("./object-info-deps.js");

test("object info supplies the active Supabase client lazily", () => {
  const firstClient = { id: "first" };
  const secondClient = { id: "second" };
  let activeClient = firstClient;

  const deps = createObjectCommentDeps({
    getClient: () => activeClient,
    commentsTable: "object_comments",
    editsTable: "object_edits"
  });

  assert.equal(deps.getClient(), firstClient);
  activeClient = secondClient;
  assert.equal(deps.getClient(), secondClient);
  assert.equal(deps.commentsTable, "object_comments");
  assert.equal(deps.editsTable, "object_edits");
});
