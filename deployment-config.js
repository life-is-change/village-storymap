/* Source deployment default. Aliyun release builds replace the artifact copy only. */
(function (root) {
  root.VILLAGE_DEPLOYMENT = Object.freeze({
    mode: 'source', stage: 'live', instanceId: 'supabase-rzmbmwauomzwiyenafha',
    apiBase: null, releaseId: 'source'
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
