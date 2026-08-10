(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ObjectInfoDepsModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function createObjectCommentDeps({ getClient, commentsTable, editsTable } = {}) {
    if (typeof getClient !== "function") throw new Error("OBJECT_INFO_CLIENT_GETTER_REQUIRED");
    return { getClient, commentsTable, editsTable };
  }

  return { createObjectCommentDeps };
});
