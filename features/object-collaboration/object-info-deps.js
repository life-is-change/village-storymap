(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ObjectInfoDepsModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function createObjectCommentDeps({ getClient, getContext, commentsTable, editsTable } = {}) {
    if (typeof getClient !== "function") throw new Error("OBJECT_INFO_CLIENT_GETTER_REQUIRED");
    if (typeof getContext !== "function") throw new Error("OBJECT_INFO_CONTEXT_GETTER_REQUIRED");
    return { getClient, getContext, commentsTable, editsTable };
  }

  return { createObjectCommentDeps };
});
