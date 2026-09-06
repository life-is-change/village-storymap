(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.VillageModelModule = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SPACE_TYPES = Object.freeze({
    PRACTICE_PERSONAL: "practice_personal",
    PRACTICE_SHARED: "practice_shared",
    FORMAL_PERSONAL: "formal_personal",
    FORMAL_SHARED: "formal_shared",
    GROUP_PLAN: "group_plan"
  });

  const VILLAGE_STATUSES = Object.freeze({
    DRAFT: "draft",
    DATA_PREPARING: "data_preparing",
    DATA_READY: "data_ready",
    PUBLISHED: "published",
    ARCHIVED: "archived"
  });

  const VALID_VILLAGE_STATUSES = new Set(Object.values(VILLAGE_STATUSES));
  const PRACTICE_SPACE_TYPES = new Set([
    SPACE_TYPES.PRACTICE_PERSONAL,
    SPACE_TYPES.PRACTICE_SHARED
  ]);
  const FORMAL_SPACE_TYPES = new Set([
    SPACE_TYPES.FORMAL_PERSONAL,
    SPACE_TYPES.FORMAL_SHARED,
    SPACE_TYPES.GROUP_PLAN
  ]);
  const PERSONAL_SPACE_TYPES = new Set([
    SPACE_TYPES.PRACTICE_PERSONAL,
    SPACE_TYPES.FORMAL_PERSONAL
  ]);

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function normalizeBoolean(value, fallback = false) {
    if (value === true || value === false) return value;
    if (value === "true" || value === 1 || value === "1") return true;
    if (value === "false" || value === 0 || value === "0") return false;
    return fallback;
  }

  function normalizeVillage(raw = {}) {
    const requestedStatus = cleanText(raw.status);
    return {
      id: cleanText(raw.id),
      name: cleanText(raw.name),
      isPractice: normalizeBoolean(raw.isPractice ?? raw.is_practice),
      defaultCrs: cleanText(raw.defaultCrs ?? raw.default_crs) || "EPSG:4326",
      status: VALID_VILLAGE_STATUSES.has(requestedStatus)
        ? requestedStatus
        : VILLAGE_STATUSES.DRAFT,
      boundary: raw.boundary ?? null
    };
  }

  function normalizeTeachingProject(raw = {}) {
    return {
      id: cleanText(raw.id),
      name: cleanText(raw.name),
      courseId: cleanText(raw.courseId ?? raw.course_id),
      practiceVillageId: cleanText(raw.practiceVillageId ?? raw.practice_village_id),
      formalVillageId: cleanText(raw.formalVillageId ?? raw.formal_village_id) || null,
      formalProjectOpen: normalizeBoolean(raw.formalProjectOpen ?? raw.formal_project_open),
      status: cleanText(raw.status) || "active",
      stage: cleanText(raw.stage) || "preparing"
    };
  }

  function buildProjectEntries({ project, villages } = {}) {
    const normalizedProject = normalizeTeachingProject(project);
    const villageById = new Map(
      (Array.isArray(villages) ? villages : [])
        .map(normalizeVillage)
        .filter((village) => village.id)
        .map((village) => [village.id, village])
    );
    const entries = [];

    const formalVillage = villageById.get(normalizedProject.formalVillageId);
    if (
      normalizedProject.formalProjectOpen
      && formalVillage
      && formalVillage.status === VILLAGE_STATUSES.PUBLISHED
    ) {
      entries.push(buildProjectEntry(normalizedProject, formalVillage, "formal"));
    }

    const practiceVillage = villageById.get(normalizedProject.practiceVillageId);
    if (practiceVillage && practiceVillage.status === VILLAGE_STATUSES.PUBLISHED) {
      entries.push(buildProjectEntry(normalizedProject, practiceVillage, "practice"));
    }

    return entries;
  }

  function buildProjectEntry(project, village, role) {
    return {
      teachingProjectId: project.id,
      villageId: village.id,
      villageName: village.name,
      role,
      isPractice: role === "practice",
      status: village.status
    };
  }

  function filterSpacesForContext({ spaces, context, actor } = {}) {
    const projectId = cleanText(context?.teachingProjectId ?? context?.teaching_project_id);
    const villageId = cleanText(context?.villageId ?? context?.village_id);
    const villageRole = cleanText(context?.villageRole ?? context?.village_role);
    const userId = cleanText(actor?.userId ?? actor?.user_id);
    const groupId = cleanText(actor?.groupId ?? actor?.group_id);
    const isStaff = normalizeBoolean(actor?.isStaff ?? actor?.is_staff);
    const allowedTypes = villageRole === "practice" ? PRACTICE_SPACE_TYPES : FORMAL_SPACE_TYPES;

    return (Array.isArray(spaces) ? spaces : []).filter((space) => {
      const spaceProjectId = cleanText(space.teachingProjectId ?? space.teaching_project_id);
      const spaceVillageId = cleanText(space.villageId ?? space.village_id);
      const spaceType = cleanText(space.spaceType ?? space.space_type);
      if (spaceProjectId !== projectId || spaceVillageId !== villageId || !allowedTypes.has(spaceType)) {
        return false;
      }
      if (PERSONAL_SPACE_TYPES.has(spaceType)) {
        return cleanText(space.ownerId ?? space.owner_id) === userId;
      }
      if (spaceType === SPACE_TYPES.GROUP_PLAN) {
        return Boolean(groupId) && cleanText(space.groupId ?? space.group_id) === groupId;
      }
      // Staff enter other groups through an explicit, server-verified admin
      // context. Their ordinary workspace follows the same visibility rules
      // as everyone else's so the selector never becomes a roster dump.
      if (isStaff) return true;
      return true;
    });
  }

  function buildContextKey({ teachingProjectId, villageId, spaceId = "" } = {}) {
    return [teachingProjectId, villageId, spaceId]
      .map((value) => cleanText(value))
      .join("::");
  }

  function canBindFormalVillage({ project, village, hasStudentData } = {}) {
    const normalizedProject = normalizeTeachingProject(project);
    const normalizedVillage = normalizeVillage(village);

    if (!normalizedVillage.id || normalizedVillage.isPractice) {
      return { ok: false, code: "FORMAL_VILLAGE_REQUIRED" };
    }
    if (normalizedVillage.status !== VILLAGE_STATUSES.PUBLISHED) {
      return { ok: false, code: "PUBLISHED_DATASET_REQUIRED" };
    }
    if (
      normalizedProject.formalVillageId
      && normalizedProject.formalVillageId !== normalizedVillage.id
      && normalizeBoolean(hasStudentData)
    ) {
      return { ok: false, code: "FORMAL_VILLAGE_LOCKED" };
    }
    return { ok: true, code: "FORMAL_VILLAGE_BINDABLE" };
  }

  function getBoundaryCenter(boundary) {
    const geometry = boundary?.type === "Feature" ? boundary.geometry : boundary;
    const points = [];
    function visit(value) {
      if (!Array.isArray(value)) return;
      if (
        value.length >= 2 &&
        Number.isFinite(Number(value[0])) &&
        Number.isFinite(Number(value[1]))
      ) {
        points.push([Number(value[0]), Number(value[1])]);
        return;
      }
      value.forEach(visit);
    }
    visit(geometry?.coordinates);
    if (!points.length) return null;
    const longitudeValues = points.map((point) => point[0]);
    const latitudeValues = points.map((point) => point[1]);
    return {
      longitude: (Math.min(...longitudeValues) + Math.max(...longitudeValues)) / 2,
      latitude: (Math.min(...latitudeValues) + Math.max(...latitudeValues)) / 2
    };
  }

  function buildHomepageProjectVillages({ project, villages } = {}) {
    const normalizedProject = normalizeTeachingProject(project);
    const villageById = new Map(
      (Array.isArray(villages) ? villages : [])
        .map((raw) => ({ raw, normalized: normalizeVillage(raw) }))
        .filter(({ normalized }) => normalized.id)
        .map((item) => [item.normalized.id, item])
    );
    const requested = [
      { id: normalizedProject.practiceVillageId, role: "practice" },
      ...(normalizedProject.formalProjectOpen && normalizedProject.formalVillageId
        ? [{ id: normalizedProject.formalVillageId, role: "formal" }]
        : [])
    ];

    return requested.flatMap(({ id, role }) => {
      const item = villageById.get(id);
      if (!item || item.normalized.status !== VILLAGE_STATUSES.PUBLISHED) return [];
      const center = getBoundaryCenter(item.normalized.boundary);
      return [{
        id: item.normalized.id,
        name: item.normalized.name,
        isPractice: role === "practice",
        role,
        status: item.normalized.status,
        location: role === "practice" ? "课程练习村庄" : "本学期正式规划村庄",
        tagline: role === "practice" ? "熟悉平台与现状调查流程" : "全班共同开展现状调查与规划",
        description: role === "practice"
          ? "用于熟悉平台工具、图底生产和现状调查流程。"
          : "该村庄已完成基础数据发布并绑定到当前学期，供全班共同开展规划实践。",
        longitude: center?.longitude,
        latitude: center?.latitude,
        zoom: 14
      }];
    });
  }

  function resolveHomepageCommand(message, { isAdmin = false, allowedVillageIds = [] } = {}) {
    if (message?.type === "village-open-admin") {
      return isAdmin === true ? { type: "open_admin" } : null;
    }
    if (message?.type !== "village-home-enter") return null;
    const villageId = cleanText(message?.payload?.villageId);
    const allowed = new Set((Array.isArray(allowedVillageIds) ? allowedVillageIds : []).map(cleanText));
    return villageId && allowed.has(villageId)
      ? { type: "enter_village", villageId }
      : null;
  }

  return {
    SPACE_TYPES,
    VILLAGE_STATUSES,
    normalizeVillage,
    normalizeTeachingProject,
    buildProjectEntries,
    filterSpacesForContext,
    buildContextKey,
    canBindFormalVillage,
    buildHomepageProjectVillages,
    resolveHomepageCommand
  };
});
