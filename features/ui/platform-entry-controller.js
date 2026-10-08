(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PlatformEntryControllerModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createPlatformEntryController(deps = {}) {
    let activeRun = null;
    let queuedRequest = null;
    let queuedPromise = null;
    let lifecycle = 0;

    function requestKey(request = {}) {
      const entry = request.entry || {};
      return String(request.villageId || entry.villageId || entry.id || "default");
    }

    function enter(request = {}) {
      const key = requestKey(request);
      if (activeRun) {
        if (key === activeRun.key) return activeRun.promise;
        queuedRequest = request;
        if (!queuedPromise) {
          const queuedLifecycle = lifecycle;
          queuedPromise = activeRun.promise.catch(() => null).then(() => {
            if (lifecycle !== queuedLifecycle) return null;
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
      try {
        Promise.resolve(deps.prewarm?.(request)).catch((error) => deps.onPrewarmError?.(error));
      } catch (error) {
        deps.onPrewarmError?.(error);
      }
      const runLifecycle = lifecycle;
      const run = { key, promise: null };
      let workspaceStarted = false;
      let cancellationRestored = false;

      function restoreAfterCancelledWorkspace() {
        if (workspaceStarted && !cancellationRestored) {
          cancellationRestored = true;
          deps.onCancelled?.(request);
        }
        return null;
      }

      run.promise = (async () => {
        let context;
        try {
          if (deps.beforePrepare) await deps.beforePrepare(request);
          if (lifecycle !== runLifecycle) return null;
          context = await deps.prepare?.(request, {
            isCurrent: () => lifecycle === runLifecycle
          });
          if (lifecycle !== runLifecycle) return null;
          workspaceStarted = true;
          await deps.openWorkspace?.("2d", context?.group || null);
        } catch (error) {
          if (lifecycle !== runLifecycle) return restoreAfterCancelledWorkspace();
          throw error;
        }
        if (lifecycle !== runLifecycle) return restoreAfterCancelledWorkspace();
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
        if (activeRun !== run) return;
        deps.setLoading?.(false);
        activeRun = null;
      });
      activeRun = run;

      return run.promise;
    }

    function cancel() {
      lifecycle += 1;
      queuedRequest = null;
      queuedPromise = null;
      if (!activeRun) return false;
      activeRun = null;
      deps.setLoading?.(false);
      return true;
    }

    return {
      enter,
      cancel,
      isEntering: () => !!activeRun
    };
  }

  return { createPlatformEntryController };
});
