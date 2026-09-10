(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PlatformEntryControllerModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createPlatformEntryController(deps = {}) {
    let inFlight = null;
    let inFlightKey = "";
    let queuedRequest = null;
    let queuedPromise = null;

    function requestKey(request = {}) {
      const entry = request.entry || {};
      return String(request.villageId || entry.villageId || entry.id || "default");
    }

    function enter(request = {}) {
      const key = requestKey(request);
      if (inFlight) {
        if (key === inFlightKey) return inFlight;
        queuedRequest = request;
        if (!queuedPromise) {
          queuedPromise = inFlight.catch(() => null).then(() => {
            const nextRequest = queuedRequest;
            queuedRequest = null;
            queuedPromise = null;
            return enter(nextRequest || {});
          });
        }
        return queuedPromise;
      }

      deps.showShell?.(request);
      deps.setLoading?.(true, "正在进入平台并加载 2D 地图…");
      inFlightKey = key;

      inFlight = (async () => {
        const context = await deps.prepare?.(request);
        await deps.openWorkspace?.("2d", context?.group || null);
        try {
          Promise.resolve(deps.recordActivity?.(request)).catch((error) => {
            deps.onActivityError?.(error);
          });
        } catch (error) {
          deps.onActivityError?.(error);
        }
        deps.onEntered?.(context, request);
        return context;
      })().finally(() => {
        deps.setLoading?.(false);
        inFlight = null;
        inFlightKey = "";
      });

      return inFlight;
    }

    return {
      enter,
      isEntering: () => !!inFlight
    };
  }

  return { createPlatformEntryController };
});
