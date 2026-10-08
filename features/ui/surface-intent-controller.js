(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SurfaceIntentControllerModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createSurfaceIntentController() {
    let intent = "overview";

    return {
      requestOverview() {
        intent = "overview";
      },
      requestWorkspace() {
        intent = "workspace";
      },
      getIntent() {
        return intent;
      },
      canShow(viewKey) {
        return viewKey === "overview" || intent === "workspace";
      }
    };
  }

  return { createSurfaceIntentController };
});
