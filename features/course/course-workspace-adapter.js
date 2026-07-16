(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CourseWorkspaceAdapterModule = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  function buildGroupPlanningSpace(group, actorName, baseSpace = {}) {
    return {
      id: group.spaceId,
      title: `${group.name} · 规划空间`,
      creatorName: String(actorName || "").trim(),
      createdAt: new Date().toISOString(),
      readonly: false,
      editEnabled: true,
      expanded: true,
      selectedLayers: Array.isArray(baseSpace.selectedLayers)
        ? [...baseSpace.selectedLayers]
        : ["building", "road", "cropland", "openSpace", "water"],
      basemapVisible: Boolean(baseSpace.basemapVisible),
      viewMode: "2d",
      courseId: group.courseId || "",
      courseGroupId: group.id,
      spaceType: "course_group"
    };
  }

  function canActorAccessGroupSpace(space, courseContext, isAdmin = false) {
    if (!space?.courseGroupId) return true;
    if (isAdmin) return true;
    return Boolean(courseContext?.group?.id && courseContext.group.id === space.courseGroupId);
  }

  return {
    buildGroupPlanningSpace,
    canActorAccessGroupSpace
  };
});
