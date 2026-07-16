(function (root, factory) {
  const model =
    root?.CourseModelModule ||
    (typeof require === "function" ? require("./course-model.js") : null);
  const api = factory(model, root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CourseServiceModule = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (model, root) {
  const DEFAULT_COURSE = model?.DEFAULT_COURSE;
  const buildStudentKey = model?.buildStudentKey;

  function readJson(storage, key, fallback) {
    try {
      const value = storage?.getItem?.(key);
      if (!value) return fallback;
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    storage?.setItem?.(key, JSON.stringify(value));
  }

  function createServiceError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function normalizeGroupCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createCourseService(deps = {}) {
    if (!DEFAULT_COURSE || typeof buildStudentKey !== "function") {
      throw new Error("CourseModelModule 未加载。");
    }

    const course = deps.course || DEFAULT_COURSE;
    const storage = deps.storage || root?.localStorage;
    const supabaseClient = deps.supabaseClient || null;
    const remoteStore = deps.remoteStore || null;
    const now = deps.now || (() => new Date().toISOString());
    const uuid =
      deps.uuid ||
      (() => root?.crypto?.randomUUID?.() || `course-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    const keys = {
      groups: `village_course_groups_v1:${course.id}`,
      memberships: `village_group_memberships_v1:${course.id}`,
      progress: `village_task_progress_v1:${course.id}`
    };

    function getGroups() {
      const value = readJson(storage, keys.groups, []);
      return Array.isArray(value) ? value : [];
    }

    function saveGroups(groups) {
      writeJson(storage, keys.groups, groups);
    }

    function getMemberships() {
      const value = readJson(storage, keys.memberships, []);
      return Array.isArray(value) ? value : [];
    }

    function saveMemberships(memberships) {
      writeJson(storage, keys.memberships, memberships);
    }

    function getProgressRows() {
      const value = readJson(storage, keys.progress, []);
      return Array.isArray(value) ? value : [];
    }

    function saveProgressRows(rows) {
      writeJson(storage, keys.progress, rows);
    }

    async function mirrorUpsert(table, payload, options) {
      if (!supabaseClient?.from) return { pending: true, reason: "not_configured" };
      try {
        const response = await supabaseClient.from(table).upsert(payload, options);
        if (response?.error) throw response.error;
        return { pending: false };
      } catch (error) {
        return { pending: true, reason: error?.message || "sync_failed" };
      }
    }

    function normalizeRemoteGroup(row) {
      return {
        id: row.id,
        courseId: row.course_id || row.courseId || course.id,
        name: row.name,
        joinCode: row.join_code || row.joinCode,
        locked: Boolean(row.locked),
        spaceId: row.space_id || row.spaceId || `group-space-${row.id}`,
        createdBy: row.created_by || row.createdBy || "",
        createdAt: row.created_at || row.createdAt || now(),
        updatedAt: row.updated_at || row.updatedAt || now(),
        syncPending: false
      };
    }

    async function refreshGroupsFromRemote() {
      let remoteRows = [];
      if (remoteStore?.listGroups) {
        remoteRows = await remoteStore.listGroups(course.id);
      } else if (supabaseClient?.from) {
        try {
          const response = await supabaseClient
            .from("course_groups")
            .select("*")
            .eq("course_id", course.id);
          if (response?.error) throw response.error;
          remoteRows = response?.data || [];
        } catch (_) {
          return getGroups();
        }
      }
      if (!Array.isArray(remoteRows) || !remoteRows.length) return getGroups();
      const merged = new Map(getGroups().map((group) => [group.id, group]));
      remoteRows.map(normalizeRemoteGroup).forEach((group) => merged.set(group.id, group));
      const groups = Array.from(merged.values());
      saveGroups(groups);
      return groups;
    }

    async function listGroups(options = {}) {
      if (options.refresh) await refreshGroupsFromRemote();
      return clone(getGroups());
    }

    async function createGroup(name, requestedCode) {
      const safeName = String(name || "").trim();
      if (!safeName) throw createServiceError("GROUP_NAME_REQUIRED", "请输入小组名称。");

      const groups = getGroups();
      let joinCode = normalizeGroupCode(requestedCode);
      if (!joinCode) {
        const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
        joinCode = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
      }
      if (groups.some((group) => normalizeGroupCode(group.joinCode) === joinCode)) {
        throw createServiceError("GROUP_CODE_EXISTS", "该组码已存在，请更换组码。");
      }

      const id = String(uuid());
      const group = {
        id,
        courseId: course.id,
        name: safeName,
        joinCode,
        locked: false,
        spaceId: `group-space-${id}`,
        createdBy: String(deps.actorName || "").trim(),
        createdAt: now(),
        updatedAt: now(),
        syncPending: false
      };
      groups.push(group);
      saveGroups(groups);

      const sync = await mirrorUpsert(
        "course_groups",
        {
          id: group.id,
          course_id: group.courseId,
          name: group.name,
          join_code: group.joinCode,
          locked: group.locked,
          space_id: group.spaceId,
          created_by: group.createdBy || null,
          created_at: group.createdAt,
          updated_at: group.updatedAt
        },
        { onConflict: "id" }
      );
      group.syncPending = sync.pending;
      saveGroups(groups);
      return clone(group);
    }

    async function joinGroup(code, user) {
      const studentKey = buildStudentKey(user);
      if (!String(user?.name || "").trim()) {
        throw createServiceError("USER_REQUIRED", "请先登录个人账号。");
      }
      let groups = getGroups();
      let group = groups.find((item) => normalizeGroupCode(item.joinCode) === normalizeGroupCode(code));
      if (!group) {
        groups = await refreshGroupsFromRemote();
        group = groups.find((item) => normalizeGroupCode(item.joinCode) === normalizeGroupCode(code));
      }
      if (!group) throw createServiceError("GROUP_NOT_FOUND", "未找到该组码对应的小组。");

      const memberships = getMemberships();
      const currentMembership = memberships.find(
        (membership) => membership.courseId === course.id && membership.studentKey === studentKey
      );
      if (currentMembership && currentMembership.groupId !== group.id) {
        throw createServiceError("COURSE_GROUP_CONFLICT", "你已经加入本课程的其他小组。");
      }
      if (group.locked && !currentMembership) {
        throw createServiceError("GROUP_LOCKED", "该小组已锁定，请联系老师调整成员。");
      }

      let membership = currentMembership;
      if (!membership) {
        membership = {
          id: String(uuid()),
          courseId: course.id,
          groupId: group.id,
          studentKey,
          studentName: String(user.name || "").trim(),
          studentId: String(user.student_id || user.studentId || "").trim(),
          role: "member",
          joinedAt: now(),
          syncPending: false
        };
        memberships.push(membership);
        saveMemberships(memberships);

        const sync = await mirrorUpsert(
          "group_memberships",
          {
            course_id: membership.courseId,
            group_id: membership.groupId,
            student_key: membership.studentKey,
            student_name: membership.studentName,
            student_id: membership.studentId || null,
            role: membership.role,
            joined_at: membership.joinedAt
          },
          { onConflict: "course_id,student_key" }
        );
        membership.syncPending = sync.pending;
        saveMemberships(memberships);
      }

      return loadContext(user);
    }

    async function setGroupLocked(groupId, locked) {
      const groups = getGroups();
      const group = groups.find((item) => item.id === groupId);
      if (!group) throw createServiceError("GROUP_NOT_FOUND", "未找到该小组。");
      group.locked = Boolean(locked);
      group.updatedAt = now();
      saveGroups(groups);
      const sync = await mirrorUpsert(
        "course_groups",
        {
          id: group.id,
          course_id: group.courseId,
          name: group.name,
          join_code: group.joinCode,
          locked: group.locked,
          space_id: group.spaceId,
          created_by: group.createdBy || null,
          created_at: group.createdAt,
          updated_at: group.updatedAt
        },
        { onConflict: "id" }
      );
      group.syncPending = sync.pending;
      saveGroups(groups);
      return clone(group);
    }

    async function setTaskComplete(taskId, complete, user) {
      const studentKey = buildStudentKey(user);
      if (!String(user?.name || "").trim()) {
        throw createServiceError("USER_REQUIRED", "请先登录个人账号。");
      }
      const rows = getProgressRows();
      const existing = rows.find(
        (row) => row.courseId === course.id && row.studentKey === studentKey && row.taskId === taskId
      );
      const completed = Boolean(complete);
      const row = existing || {
        courseId: course.id,
        studentKey,
        taskId: String(taskId || ""),
        groupId: null
      };
      const membership = getMemberships().find(
        (item) => item.courseId === course.id && item.studentKey === studentKey
      );
      row.groupId = membership?.groupId || null;
      row.completed = completed;
      row.completedAt = completed ? now() : null;
      row.updatedAt = now();
      if (!existing) rows.push(row);
      saveProgressRows(rows);

      const sync = await mirrorUpsert(
        "task_progress",
        {
          course_id: row.courseId,
          student_key: row.studentKey,
          group_id: row.groupId,
          task_id: row.taskId,
          completed: row.completed,
          completed_at: row.completedAt,
          updated_at: row.updatedAt
        },
        { onConflict: "course_id,student_key,task_id" }
      );
      return { ...clone(row), syncPending: sync.pending };
    }

    async function getProgress(user) {
      const studentKey = buildStudentKey(user);
      const completedTaskIds = getProgressRows()
        .filter((row) => row.courseId === course.id && row.studentKey === studentKey && row.completed)
        .map((row) => row.taskId);
      return { completedTaskIds: [...new Set(completedTaskIds)] };
    }

    async function refreshStudentContextFromRemote(user) {
      const studentKey = buildStudentKey(user);
      if (!String(user?.name || "").trim()) return;
      let remoteContext = null;
      try {
        if (remoteStore?.loadStudentContext) {
          remoteContext = await remoteStore.loadStudentContext(course.id, studentKey);
        } else if (supabaseClient?.from) {
          const [membershipResponse, progressResponse] = await Promise.all([
            supabaseClient
              .from("group_memberships")
              .select("*")
              .eq("course_id", course.id)
              .eq("student_key", studentKey)
              .maybeSingle(),
            supabaseClient
              .from("task_progress")
              .select("*")
              .eq("course_id", course.id)
              .eq("student_key", studentKey)
          ]);
          if (membershipResponse?.error) throw membershipResponse.error;
          if (progressResponse?.error) throw progressResponse.error;
          remoteContext = {
            membership: membershipResponse?.data || null,
            progress: progressResponse?.data || []
          };
        }
      } catch (_) {
        return;
      }
      if (!remoteContext) return;

      const row = remoteContext.membership;
      if (row) {
        const memberships = getMemberships();
        const normalized = {
          id: String(row.id || `${course.id}:${studentKey}`),
          courseId: row.course_id || row.courseId || course.id,
          groupId: row.group_id || row.groupId,
          studentKey: row.student_key || row.studentKey || studentKey,
          studentName: row.student_name || row.studentName || user.name,
          studentId: row.student_id || row.studentId || user.student_id || user.studentId || "",
          role: row.role || "member",
          joinedAt: row.joined_at || row.joinedAt || now(),
          syncPending: false
        };
        const index = memberships.findIndex(
          (item) => item.courseId === course.id && item.studentKey === normalized.studentKey
        );
        if (index >= 0) memberships[index] = normalized;
        else memberships.push(normalized);
        saveMemberships(memberships);
        await refreshGroupsFromRemote();
      }

      if (Array.isArray(remoteContext.progress)) {
        const rows = getProgressRows();
        remoteContext.progress.forEach((remoteRow) => {
          const normalized = {
            courseId: remoteRow.course_id || remoteRow.courseId || course.id,
            studentKey: remoteRow.student_key || remoteRow.studentKey || studentKey,
            groupId: remoteRow.group_id || remoteRow.groupId || null,
            taskId: remoteRow.task_id || remoteRow.taskId,
            completed: Boolean(remoteRow.completed),
            completedAt: remoteRow.completed_at || remoteRow.completedAt || null,
            updatedAt: remoteRow.updated_at || remoteRow.updatedAt || now()
          };
          const index = rows.findIndex(
            (item) => item.courseId === normalized.courseId &&
              item.studentKey === normalized.studentKey &&
              item.taskId === normalized.taskId
          );
          if (index >= 0) rows[index] = normalized;
          else rows.push(normalized);
        });
        saveProgressRows(rows);
      }
    }

    async function loadContext(user) {
      await refreshStudentContextFromRemote(user);
      const studentKey = buildStudentKey(user);
      const memberships = getMemberships();
      const membership = memberships.find(
        (item) => item.courseId === course.id && item.studentKey === studentKey
      ) || null;
      const group = membership ? getGroups().find((item) => item.id === membership.groupId) || null : null;
      return {
        course: clone(course),
        user: clone(user || {}),
        membership: clone(membership),
        group: clone(group),
        progress: await getProgress(user)
      };
    }

    return {
      loadContext,
      listGroups,
      createGroup,
      joinGroup,
      setGroupLocked,
      setTaskComplete,
      getProgress,
      refreshGroupsFromRemote
    };
  }

  return {
    createCourseService,
    normalizeGroupCode
  };
});
