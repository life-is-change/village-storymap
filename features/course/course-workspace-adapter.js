(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CourseWorkspaceAdapterModule = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  function buildGroupPlanningSpace(group, actorName, baseSpace = {}, context = {}) {
    if (context.villageRole === "practice") throw new Error("PRACTICE_GROUP_SPACE_FORBIDDEN");
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
        : ["building", "road", "water"],
      basemapVisible: Boolean(baseSpace.basemapVisible),
      viewMode: "2d",
      courseId: group.courseId || "",
      teachingProjectId: context.teachingProjectId || "",
      villageId: context.villageId || "",
      courseGroupId: group.id,
      spaceType: "course_group"
    };
  }

  function canActorAccessGroupSpace(space, courseContext, isAdmin = false) {
    if (!space?.courseGroupId) return true;
    if (isAdmin) return true;
    return Boolean(courseContext?.group?.id && courseContext.group.id === space.courseGroupId);
  }

  function resolveAccountIdentity(user = {}) {
    return String(user.authUserId || user.id || user.studentId || user.student_id || "anonymous").trim() || "anonymous";
  }

  function buildAccountStorageKey(baseKey, user = {}) {
    return `${String(baseKey)}:${resolveAccountIdentity(user)}`;
  }

  function filterRemotePlanningSpaces(remoteSpaces = [], options = {}) {
    const activeGroupId = String(options.activeGroupId || "").trim();
    return (Array.isArray(remoteSpaces) ? remoteSpaces : []).filter((space) => {
      if (!space || ["course_personal", "practice_personal", "formal_personal"].includes(space.spaceType)) return false;
      return Boolean(
        activeGroupId &&
        space.spaceType === "course_group" &&
        String(space.courseGroupId || "") === activeGroupId
      );
    });
  }

  function mergeWorkspaceSpaces({
    localSpaces = [],
    remoteSpaces = [],
    baseSpaceId = "current",
    ...visibility
  } = {}) {
    const local = Array.isArray(localSpaces) ? localSpaces : [];
    const base = local.find((space) => String(space?.id) === String(baseSpaceId)) || null;
    const personal = local.filter((space) => ["course_personal", "practice_personal", "formal_personal"].includes(space?.spaceType));
    const visibleRemote = filterRemotePlanningSpaces(remoteSpaces, visibility);
    const merged = [base, ...personal, ...visibleRemote].filter(Boolean);
    const seen = new Set();
    return merged.filter((space) => {
      const id = String(space?.id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function buildPersonalPlanningSpace({
    personalSpace,
    user = {},
    existingSpace = null,
    selections = [],
    courseId,
    villageId,
    teachingProjectId,
    spaceType
  }) {
    if (!["practice_personal", "formal_personal"].includes(spaceType)) {
      throw new Error("PERSONAL_SPACE_TYPE_REQUIRED");
    }
    const selectedFromServer = (Array.isArray(selections) ? selections : [])
      .map((item) => String(item?.layer_key || ""))
      .filter((key) => ["building", "road", "water", "contours"].includes(key));
    const selectedLayers = selectedFromServer.length
      ? selectedFromServer
      : Array.from(existingSpace?.selectedLayers || []);
    return {
      id: String(personalSpace.id),
      title: personalSpace.title || `${user.name || "学生"} · 个人图底空间`,
      creatorName: user.name || "",
      createdAt: personalSpace.created_at || new Date().toISOString(),
      readonly: false,
      editEnabled: true,
      expanded: true,
      selectedLayers,
      contourLabelsVisible: existingSpace?.contourLabelsVisible !== false,
      basemapVisible: true,
      viewMode: "2d",
      courseId,
      teachingProjectId,
      villageId,
      spaceType
    };
  }

  return {
    buildGroupPlanningSpace,
    canActorAccessGroupSpace,
    buildAccountStorageKey,
    buildPersonalPlanningSpace,
    filterRemotePlanningSpaces,
    mergeWorkspaceSpaces
  };
});
