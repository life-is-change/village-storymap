(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HomepageContextModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function confirmedHomepageContext(context, model, preferredVillageId = "") {
    if (!context?.project || !Array.isArray(context.villages) || !model?.buildHomepageProjectVillages) {
      return null;
    }
    const villages = model.buildHomepageProjectVillages(context);
    if (!villages.length) return null;
    const selectedVillageId = [context.villageId, preferredVillageId]
      .find((id) => villages.some((village) => village.id === id)) || villages[0].id;
    return {
      villages,
      selectedVillageId
    };
  }
  return { confirmedHomepageContext };
});
