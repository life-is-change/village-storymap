(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneStudioFocusModeModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createSceneStudioFocusMode(options) {
    let active = false;
    let previousRealityVisible = true;
    let chromeState = [];

    function enter() {
      if (!active) {
        previousRealityVisible = options.getRealityVisible?.() !== false;
        chromeState = (options.chromeElements || []).filter(Boolean).map((element) => ({ element, hidden: !!element.hidden }));
      }
      active = true;
      options.body?.classList?.add?.("scene-studio-active");
      chromeState.forEach(({ element }) => { element.hidden = true; });
      options.setRealityVisible?.(false);
      return { active, previousRealityVisible };
    }

    function exit() {
      options.body?.classList?.remove?.("scene-studio-active");
      if (active) {
        chromeState.forEach(({ element, hidden }) => { element.hidden = hidden; });
        options.setRealityVisible?.(previousRealityVisible);
      }
      chromeState = [];
      active = false;
      return { active, previousRealityVisible };
    }

    return { enter, exit, isActive: () => active };
  }

  return { createSceneStudioFocusMode };
});
