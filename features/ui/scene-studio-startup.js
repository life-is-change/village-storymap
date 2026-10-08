(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneStudioStartupModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Lifetime is one studio opening, never a cross-village/cloud-data cache.
  function create3DReadiness({ load, preparedApi = null } = {}) {
    let ready = preparedApi ? Promise.resolve(preparedApi) : null;
    return function ensureReady() {
      if (!ready) {
        ready = Promise.resolve().then(load).then(async (api) => {
          await api?.enter?.();
          return api;
        }).catch((error) => { ready = null; throw error; });
      }
      return ready;
    };
  }
  async function prepareSceneStudio(deps = {}) {
    const baselineReady = Promise.resolve()
      .then(() => deps.ensurePlanMap?.())
      .then(() => deps.ensureSelectedLayersLoaded?.())
      .then(() => deps.refresh2DOverlay?.());
    const threeDReady = Promise.resolve()
      .then(() => deps.ensureVillage3DLoaded?.())
      .then(async (api) => {
        await api?.enter?.();
        return api;
      });
    const [, api] = await Promise.all([baselineReady, threeDReady]);
    return api;
  }

  return { prepareSceneStudio, create3DReadiness };
});
