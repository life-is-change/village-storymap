(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GeoprocessingContextModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const LEGACY_MIBU_ID = "00000000-0000-4000-8000-000000000001";

  function resolveGeoprocessingContext(context = {}) {
    const dataset = context.village?.publishedDataset;
    const imagery = dataset?.imagery_config || dataset?.imageryConfig;
    const isLegacyMibu = context.villageId === LEGACY_MIBU_ID
      && imagery?.kind === "legacy_mibu_imagery";
    if (isLegacyMibu) {
      return {
        villageId: context.villageId,
        personalVillageId: context.villageId,
        previewVillageId: "mibu",
        previewResources: null,
        teachingProjectId: context.teachingProjectId || null,
        datasetId: null,
        maxAreaSqKm: 2
      };
    }
    return {
      villageId: context.villageId,
      personalVillageId: context.villageId,
      previewVillageId: context.villageId,
      previewResources: context.datasetResources || null,
      teachingProjectId: context.teachingProjectId || null,
      datasetId: context.datasetId || null,
      maxAreaSqKm: null
    };
  }

  async function enterPersonalGeoprocessingSpace({
    personalSpace, spaces = [], villageId, teachingProjectId, getSpaceById, getCurrentSpaceId, selectSpace
  }) {
    const planningSpace = spaces.find((space) =>
      ["practice_personal", "formal_personal"].includes(space?.spaceType)
      && String(space.villageId) === String(villageId)
      && String(space.teachingProjectId) === String(teachingProjectId)
    );
    const legacyId = personalSpace?.id && String(personalSpace.id);
    const id = planningSpace?.id || (legacyId && getSpaceById?.(legacyId) ? legacyId : null);
    if (!id) throw new Error("PERSONAL_SPACE_UNAVAILABLE");
    if (String(getCurrentSpaceId()) !== id) await selectSpace(id);
    return id;
  }

  return { LEGACY_MIBU_ID, resolveGeoprocessingContext, enterPersonalGeoprocessingSpace };
});
