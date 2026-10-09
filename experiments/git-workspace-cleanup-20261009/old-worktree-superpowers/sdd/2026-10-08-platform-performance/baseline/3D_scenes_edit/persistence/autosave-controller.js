(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneAutosaveControllerModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function copy(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function createAutosaveController(options) {
    const clock = options?.clock || globalThis;
    const localDraftStore = options?.localDraftStore;
    const onSaved = typeof options?.onSaved === "function" ? options.onSaved : function () {};
    const onStateChange = typeof options?.onStateChange === "function" ? options.onStateChange : function () {};
    const delayMs = Math.max(0, Number(options?.delayMs) || 1000);
    let save = options?.save;
    let document = null;
    let identity = null;
    let timer = null;
    let generation = 0;
    let activePromise = null;
    let needsSave = false;
    let disposed = false;
    let state = { status: "clean", remoteRevision: null, error: null };

    function persistLocal() {
      if (!document || !identity || !localDraftStore?.write) return;
      localDraftStore.write(identity, {
        revision: document.revision,
        document: copy(document),
        savedAt: new Date().toISOString()
      });
    }

    function schedule() {
      if (timer !== null) clock.clearTimeout(timer);
      timer = clock.setTimeout(() => {
        timer = null;
        return flush();
      }, delayMs);
    }

    function markDirty(nextDocument, nextIdentity) {
      if (disposed) return;
      document = copy(nextDocument);
      identity = { ...nextIdentity };
      generation += 1;
      needsSave = true;
      state = { status: "dirty", remoteRevision: null, error: null };
      onStateChange({ ...state });
      persistLocal();
      schedule();
    }

    function flush() {
      if (disposed || !document || !needsSave) return activePromise || Promise.resolve({ ok: true, skipped: true });
      if (activePromise) {
        needsSave = true;
        return activePromise;
      }
      if (timer !== null) {
        clock.clearTimeout(timer);
        timer = null;
      }
      const snapshot = copy(document);
      const snapshotIdentity = { ...identity };
      const snapshotGeneration = generation;
      needsSave = false;
      state = { status: "saving", remoteRevision: null, error: null };
      onStateChange({ ...state });
      activePromise = Promise.resolve()
        .then(() => save(snapshot))
        .then((result) => {
          if (result?.ok) {
            localDraftStore?.remove?.(snapshotIdentity, snapshot.revision);
            state = {
              status: generation === snapshotGeneration ? "saved" : "dirty",
              remoteRevision: null,
              savedRevision: result.data?.revision ?? null,
              error: null
            };
            onStateChange({ ...state });
            onSaved(result, snapshot);
          } else if (result?.code === "REVISION_CONFLICT") {
            needsSave = true;
            state = { status: "conflict", remoteRevision: result.remoteRevision ?? null, error: result };
            onStateChange({ ...state });
          } else {
            needsSave = true;
            state = { status: "offline", remoteRevision: null, error: result || { code: "SAVE_FAILED" } };
            onStateChange({ ...state });
          }
          return result;
        })
        .catch((error) => {
          needsSave = true;
          state = { status: "offline", remoteRevision: null, error };
          onStateChange({ ...state });
          return { ok: false, code: "NETWORK_ERROR", message: error.message };
        })
        .finally(() => {
          activePromise = null;
          if (needsSave && state.status === "dirty") void flush();
        });
      return activePromise;
    }

    function dispose() {
      disposed = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    }

    return {
      markDirty,
      flush,
      dispose,
      getState: () => ({ ...state }),
      resolve(status) {
        needsSave = false;
        state = { status: status === "offline" ? "offline" : "saved", remoteRevision: null, error: null };
        onStateChange({ ...state });
      },
      setSave(nextSave) { save = nextSave; }
    };
  }

  return { createAutosaveController };
});
