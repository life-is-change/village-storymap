(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PageRestoreGuardModule = api;

  if (root?.addEventListener && root?.location?.reload) {
    api.createPageRestoreGuard({
      target: root,
      reload: () => root.location.reload()
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createPageRestoreGuard({ target, reload } = {}) {
    if (!target?.addEventListener || typeof reload !== "function") {
      throw new TypeError("PAGE_RESTORE_GUARD_DEPENDENCIES_REQUIRED");
    }

    let reloadRequested = false;
    const handlePageShow = (event) => {
      if (!event?.persisted || reloadRequested) return;
      reloadRequested = true;
      reload();
    };

    target.addEventListener("pageshow", handlePageShow);
    return {
      dispose() {
        target.removeEventListener?.("pageshow", handlePageShow);
      }
    };
  }

  return { createPageRestoreGuard };
});
