(function exposeFacadeCloudClient(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FacadeCloudClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function facadeCloudClientFactory() {
  function unwrap(result) {
    if (result?.error) throw result.error;
    return result?.data || {};
  }

  function createFacadeCloudClient(supabaseClient) {
    if (!supabaseClient?.functions?.invoke) throw new TypeError('Authenticated Supabase functions client required');
    const invoke = async (action, payload = {}) => unwrap(await supabaseClient.functions.invoke('facade-cloud', {
      body: { action, ...payload }
    }));
    return {
      getCapability: () => invoke('capability'),
      submit: ({ photoId, courseId, spaceId, objectCode }) => invoke('submit', { photoId, courseId, spaceId, objectCode }),
      poll: (runId) => invoke('poll', { runId })
    };
  }

  return { createFacadeCloudClient };
});
